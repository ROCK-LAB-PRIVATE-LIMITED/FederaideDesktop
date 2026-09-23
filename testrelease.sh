#!/usr/bin/env bash
set -eo pipefail

# ==============================================================================
# FEDERaiDE Universal Test & Build Suite
# ==============================================================================

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

echo -e "\n======================================================="
echo -e "  FEDERaiDE Universal Test & Build Suite"
echo -e "=======================================================\n"

# 1. Detect Host OS & Architecture
info "Detecting host environment..."
OS_RAW="$(uname -s)"
ARCH_RAW="$(uname -m)"

case "${OS_RAW}" in
    Darwin)
        PLATFORM="darwin"
        BUILD_CMD="dist:mac"
        ;;
    Linux)
        PLATFORM="linux"
        BUILD_CMD="dist:linux"
        ;;
    *)
        fail "Unsupported OS: ${OS_RAW}."
        ;;
esac

case "${ARCH_RAW}" in
    x86_64|amd64)
        ARCH="x64"
        ;;
    arm64|aarch64)
        ARCH="arm64"
        ;;
    *)
        fail "Unsupported architecture: ${ARCH_RAW}"
        ;;
esac

TARGET="${PLATFORM}-${ARCH}"
pass "Detected target platform: ${TARGET}"

# 2. Check Prerequisites & Assets
info "Checking dependencies and staged assets..."

command -v node >/dev/null 2>&1 || fail "Node.js is not installed."
command -v npm >/dev/null 2>&1 || fail "npm is not installed."

LIMACTL_BIN="resources/bin/${TARGET}/bin/limactl"
if [[ "${ARCH}" == "arm64" && -f "resources/images/federaide-debian-arm.tar.gz" ]]; then
    IMAGE_TAR="resources/images/federaide-debian-arm.tar.gz"
else
    IMAGE_TAR="resources/images/federaide-debian.tar.gz"
fi

if [[ "${PLATFORM}" == "darwin" ]]; then
    YAML_CONFIG="resources/lima/federaide-mac.yaml"
else
    YAML_CONFIG="resources/lima/federaide-linux.yaml"
fi

if [[ ! -f "${LIMACTL_BIN}" ]]; then
    warn "Lima binary for ${TARGET} not found at ${LIMACTL_BIN}."
    if [[ -f "fetch-lima.js" ]]; then
        info "Running fetch-lima.js..."
        node fetch-lima.js
    else
        fail "Missing ${LIMACTL_BIN} and fetch-lima.js not found."
    fi
fi

chmod +x "${LIMACTL_BIN}"
pass "Lima binary verified: ${LIMACTL_BIN}"

[[ -f "${IMAGE_TAR}" ]] || fail "Missing container image tarball at ${IMAGE_TAR}."
pass "Docker offline image verified: ${IMAGE_TAR}"

[[ -f "${YAML_CONFIG}" ]] || fail "Missing Lima configuration at ${YAML_CONFIG}."
pass "Lima YAML configuration verified: ${YAML_CONFIG}"

# 3. Headless Lifecycle Test
TEST_LIMA_HOME="$(mktemp -d /tmp/lima-test-XXXXXX)"
TEST_INSTANCE="federaide-ci-test"

cleanup_test() {
    info "Cleaning up test environment..."
    export LIMA_HOME="${TEST_LIMA_HOME}"
    "${LIMACTL_BIN}" stop "${TEST_INSTANCE}" --force >/dev/null 2>&1 || true
    "${LIMACTL_BIN}" delete "${TEST_INSTANCE}" --force >/dev/null 2>&1 || true
    rm -rf "${TEST_LIMA_HOME}"
}
trap cleanup_test EXIT

info "Starting isolated test VM (LIMA_HOME=${TEST_LIMA_HOME})..."
export LIMA_HOME="${TEST_LIMA_HOME}"

# Create and start VM (visible output for debugging)
"${LIMACTL_BIN}" create --name="${TEST_INSTANCE}" --tty=false "${YAML_CONFIG}"
"${LIMACTL_BIN}" start "${TEST_INSTANCE}" --tty=false
pass "MicroVM booted successfully."

# Copy & Load Docker Image
info "Importing offline container image into VM..."
"${LIMACTL_BIN}" copy "${IMAGE_TAR}" "${TEST_INSTANCE}:/tmp/federaide-debian.tar.gz"
"${LIMACTL_BIN}" shell "${TEST_INSTANCE}" docker load -i /tmp/federaide-debian.tar.gz
"${LIMACTL_BIN}" shell "${TEST_INSTANCE}" rm -f /tmp/federaide-debian.tar.gz
pass "Docker image loaded into guest daemon."

# Test Container Execution
info "Running container smoke test inside VM..."
CONTAINER_OUTPUT="$("${LIMACTL_BIN}" shell "${TEST_INSTANCE}" docker run --rm federaide:debian python3 -c 'print("LIMA_SANDBOX_SUCCESS")')"

if [[ "${CONTAINER_OUTPUT}" != *"LIMA_SANDBOX_SUCCESS"* ]]; then
    fail "Container smoke test failed. Output: ${CONTAINER_OUTPUT}"
fi
pass "Container execution verified."

# Test Teardown (Requirement 3)
info "Testing clean shutdown..."
"${LIMACTL_BIN}" stop "${TEST_INSTANCE}" --force
pass "MicroVM halted cleanly."

# 4. Build Distribution Package
info "Building production package via npm run ${BUILD_CMD}..."
npm install
npm run "${BUILD_CMD}"

# 5. Final Report
echo -e "\n======================================================="
echo -e "${GREEN}  ✓ BUILD & TEST COMPLETE!${NC}"
echo -e "======================================================="
echo -e "Generated distribution artifacts in ./dist/:\n"

ls -lh dist/ | grep -E '\.dmg|\.zip|\.AppImage|\.deb|\.exe' || ls -lh dist/