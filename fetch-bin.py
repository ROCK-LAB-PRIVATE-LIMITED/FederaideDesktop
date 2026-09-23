#!/usr/bin/env python3
"""
fetch-bin.py
Universal dependency fetcher for FEDERaiDE.
Auto-detects current runner OS or accepts --target <target>.
"""

import os
import sys
import shutil
import tarfile
import zipfile
import subprocess
import urllib.request

# Ensure UTF-8 output encoding across Windows/macOS/Linux
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

LIMA_VERSION = "2.2.0"
QEMU_INSTALLER_URL = "https://qemu.weilnetz.de/w64/2026/qemu-w64-setup-20260811.exe"

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
TMP_DIR = os.path.join(ROOT_DIR, ".tmp_fetch_bin")
BIN_RESOURCES_DIR = os.path.join(ROOT_DIR, "resources", "bin")

TARGET_CONFIGS = {
    "darwin-arm64": {
        "url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-{LIMA_VERSION}-Darwin-arm64.tar.gz",
        "agent_url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-additional-guestagents-{LIMA_VERSION}-Darwin-arm64.tar.gz",
        "has_qemu": False
    },
    "darwin-x64": {
        "url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-{LIMA_VERSION}-Darwin-x86_64.tar.gz",
        "agent_url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-additional-guestagents-{LIMA_VERSION}-Darwin-x86_64.tar.gz",
        "has_qemu": False
    },
    "linux-x64": {
        "url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-{LIMA_VERSION}-Linux-x86_64.tar.gz",
        "agent_url": None,
        "has_qemu": False
    },
    "win32-x64": {
        "url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-{LIMA_VERSION}-Windows-AMD64.zip",
        "agent_url": None,
        "has_qemu": True
    },
}

def detect_current_target():
    if sys.platform == "win32":
        return "win32-x64"
    elif sys.platform == "darwin":
        import platform
        return "darwin-arm64" if platform.machine() in ["arm64", "aarch64"] else "darwin-x64"
    elif sys.platform.startswith("linux"):
        return "linux-x64"
    return "linux-x64"

def download_file(url, dest_path):
    print(f"   Downloading: {url}")
    if shutil.which("curl"):
        subprocess.run(["curl", "-fsSL", "-L", "-o", dest_path, url], check=True)
    else:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp, open(dest_path, "wb") as out:
            shutil.copyfileobj(resp, out)

def extract_archive(archive_path, extract_dir):
    if archive_path.endswith(".tar.gz") or archive_path.endswith(".tgz"):
        with tarfile.open(archive_path, "r:gz") as tar:
            tar.extractall(extract_dir)
    elif archive_path.endswith(".zip"):
        with zipfile.ZipFile(archive_path, "r") as zip_ref:
            zip_ref.extractall(extract_dir)

def fetch_target(target_name):
    cfg = TARGET_CONFIGS[target_name]
    dest_dir = os.path.join(BIN_RESOURCES_DIR, target_name)
    extract_dir = os.path.join(TMP_DIR, target_name)
    archive_name = os.path.basename(cfg["url"])
    archive_path = os.path.join(TMP_DIR, archive_name)

    if os.path.exists(dest_dir):
        shutil.rmtree(dest_dir, ignore_errors=True)
    os.makedirs(dest_dir, exist_ok=True)
    os.makedirs(extract_dir, exist_ok=True)

    print(f"\n[INFO] Fetching Lima for {target_name}...")
    download_file(cfg["url"], archive_path)
    extract_archive(archive_path, extract_dir)

    if cfg["agent_url"]:
        agent_name = os.path.basename(cfg["agent_url"])
        agent_path = os.path.join(TMP_DIR, agent_name)
        download_file(cfg["agent_url"], agent_path)
        extract_archive(agent_path, extract_dir)

    shutil.copytree(extract_dir, dest_dir, dirs_exist_ok=True)

    bin_name = "limactl.exe" if target_name.startswith("win32") else "limactl"
    bin_path = os.path.join(dest_dir, "bin", bin_name)
    if os.path.exists(bin_path):
        os.chmod(bin_path, 0o755)

    print(f"[OK] Staged Lima for {target_name}")

    if cfg["has_qemu"]:
        qemu_target_dir = os.path.join(dest_dir, "bin")
        os.makedirs(qemu_target_dir, exist_ok=True)
        installer_path = os.path.join(TMP_DIR, "qemu-setup.exe")
        print("\n[INFO] Fetching QEMU suite for Windows...")
        download_file(QEMU_INSTALLER_URL, installer_path)

        print(f"   Extracting QEMU binaries to {qemu_target_dir}...")
        if sys.platform == "win32":
            subprocess.run([installer_path, "/S", f"/D={qemu_target_dir}"], check=True)
        else:
            extractor = None
            for cmd in ["7zz", "7z", "7za"]:
                if shutil.which(cmd):
                    extractor = cmd
                    break
            if extractor:
                subprocess.run([extractor, "x", "-y", installer_path, f"-o{qemu_target_dir}"], check=True)
            else:
                print("[WARN] 7-Zip not found; skipping Windows QEMU extraction on non-Windows host.")

        uninstaller = os.path.join(qemu_target_dir, "qemu-uninstall.exe")
        if os.path.exists(uninstaller):
            os.remove(uninstaller)
        nsis_plugins = os.path.join(qemu_target_dir, "$PLUGINSDIR")
        if os.path.exists(nsis_plugins):
            shutil.rmtree(nsis_plugins, ignore_errors=True)

        print(f"[OK] Windows QEMU suite staged at {qemu_target_dir}")

def main():
    os.makedirs(TMP_DIR, exist_ok=True)
    os.makedirs(BIN_RESOURCES_DIR, exist_ok=True)

    if len(sys.argv) > 1 and sys.argv[1] == "--all":
        targets = list(TARGET_CONFIGS.keys())
    elif len(sys.argv) > 1 and sys.argv[1] in TARGET_CONFIGS:
        targets = [sys.argv[1]]
    else:
        targets = [detect_current_target()]

    try:
        for t in targets:
            fetch_target(t)
        print("\n=======================================================")
        print("  [OK] ALL REQUIRED BINARIES STAGED SUCCESSFULLY!")
        print("=======================================================\n")
    finally:
        shutil.rmtree(TMP_DIR, ignore_errors=True)

if __name__ == "__main__":
    main()
