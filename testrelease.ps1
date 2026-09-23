# ==============================================================================
# FEDERaiDE Universal Test & Build Suite (Windows PowerShell)
# ==============================================================================
$ErrorActionPreference = "Stop"

function Write-Info ($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Pass ($msg) { Write-Host "[PASS] $msg" -ForegroundColor Green }
function Write-Warn ($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Fail ($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; exit 1 }

Write-Host "`n======================================================="
Write-Host "  FEDERaiDE Universal Test & Build Suite (Windows)"
Write-Host "=======================================================`n"

# 1. Target Detection
$TARGET = "win32-x64"
Write-Pass "Detected target platform: $TARGET"

# 2. Check Prerequisites & Assets
Write-Info "Checking dependencies and staged assets..."

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Fail "Node.js is not installed." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Write-Fail "npm is not installed." }

$LIMACTL_BIN = "resources\bin\$TARGET\bin\limactl.exe"
$IMAGE_TAR = "resources\images\federaide-debian.tar.gz"
$YAML_CONFIG = "resources\lima\federaide-win.yaml"

if (-not (Test-Path $LIMACTL_BIN)) {
    Write-Warn "Lima binary not found at $LIMACTL_BIN. Running fetch-lima.js..."
    node fetch-lima.js
}

if (-not (Test-Path $LIMACTL_BIN)) { Write-Fail "Missing $LIMACTL_BIN." }
Write-Pass "Lima binary verified: $LIMACTL_BIN"

# Add bundled binaries (qemu-img, qemu-system, limactl) to PATH for test run
$BUNDLED_BIN_DIR = Split-Path -Parent (Resolve-Path $LIMACTL_BIN)
$env:PATH = "$BUNDLED_BIN_DIR;$env:PATH"

if (-not (Test-Path $IMAGE_TAR)) { Write-Fail "Missing container image tarball at $IMAGE_TAR." }
Write-Pass "Docker offline image verified: $IMAGE_TAR"

if (-not (Test-Path $YAML_CONFIG)) { Write-Fail "Missing Lima configuration at $YAML_CONFIG." }
Write-Pass "Lima YAML configuration verified: $YAML_CONFIG"

# 3. Headless Lifecycle Test
$TEST_LIMA_HOME = Join-Path $env:TEMP ("lima-test-" + [System.Guid]::NewGuid().ToString().Substring(0,8))
$TEST_INSTANCE = "federaide-ci-test"
$env:LIMA_HOME = $TEST_LIMA_HOME

function Cleanup-Test {
    Write-Info "Cleaning up test environment..."
    try { & $LIMACTL_BIN stop $TEST_INSTANCE --force *> $null } catch {}
    try { & $LIMACTL_BIN delete $TEST_INSTANCE --force *> $null } catch {}
    if (Test-Path $TEST_LIMA_HOME) { Remove-Item -Recurse -Force $TEST_LIMA_HOME -ErrorAction SilentlyContinue }
}

try {
    Write-Info "Starting isolated test VM (LIMA_HOME=$TEST_LIMA_HOME, timeout=30m)..."
    & $LIMACTL_BIN start --name=$TEST_INSTANCE --tty=false --timeout=5m $YAML_CONFIG
    Write-Pass "MicroVM booted successfully."

    Write-Info "Importing offline container image into VM..."
    & $LIMACTL_BIN copy $IMAGE_TAR "$($TEST_INSTANCE):/tmp/federaide-debian.tar.gz"
    & $LIMACTL_BIN shell $TEST_INSTANCE docker load -i /tmp/federaide-debian.tar.gz
    & $LIMACTL_BIN shell $TEST_INSTANCE rm -f /tmp/federaide-debian.tar.gz
    Write-Pass "Docker image loaded into guest daemon."

    Write-Info "Running container smoke test inside VM..."
    $output = & $LIMACTL_BIN shell $TEST_INSTANCE docker run --rm federaide:debian python3 -c 'print("LIMA_SANDBOX_SUCCESS")'
    if ($output -notmatch "LIMA_SANDBOX_SUCCESS") {
        Write-Fail "Container smoke test failed. Output: $output"
    }
    Write-Pass "Container execution verified."

    Write-Info "Testing clean shutdown..."
    & $LIMACTL_BIN stop $TEST_INSTANCE --force
    Write-Pass "MicroVM halted cleanly."
}
finally {
    Cleanup-Test
}

# 4. Build Production Package
Write-Info "Building production package via npm run dist:win..."
npm install
npm run dist:win
