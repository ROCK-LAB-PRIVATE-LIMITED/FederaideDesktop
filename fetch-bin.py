#!/usr/bin/env python3
"""
fetch-bin.py
Universal all-in-one dependency fetcher for FEDERaiDE.
"""

import os
import sys
import shutil
import tarfile
import zipfile
import subprocess
import urllib.request

LIMA_VERSION = "2.2.0"
QEMU_INSTALLER_URL = "https://qemu.weilnetz.de/w64/2026/qemu-w64-setup-20260811.exe"

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
TMP_DIR = os.path.join(ROOT_DIR, ".tmp_fetch_bin")
BIN_RESOURCES_DIR = os.path.join(ROOT_DIR, "resources", "bin")

TARGETS = [
    {
        "dir": "darwin-arm64",
        "url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-{LIMA_VERSION}-Darwin-arm64.tar.gz",
        "agent_url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-additional-guestagents-{LIMA_VERSION}-Darwin-arm64.tar.gz",
    },
    {
        "dir": "darwin-x64",
        "url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-{LIMA_VERSION}-Darwin-x86_64.tar.gz",
        "agent_url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-additional-guestagents-{LIMA_VERSION}-Darwin-x86_64.tar.gz",
    },
    {
        "dir": "linux-x64",
        "url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-{LIMA_VERSION}-Linux-x86_64.tar.gz",
        "agent_url": None,
    },
    {
        "dir": "win32-x64",
        "url": f"https://github.com/lima-vm/lima/releases/download/v{LIMA_VERSION}/lima-{LIMA_VERSION}-Windows-AMD64.zip",
        "agent_url": None,
    },
]


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


def fetch_lima():
    print("\n=======================================================")
    print("  [1/2] Fetching Lima Binaries & Guest Agents")
    print("=======================================================")

    for target in TARGETS:
        dest_dir = os.path.join(BIN_RESOURCES_DIR, target["dir"])
        extract_dir = os.path.join(TMP_DIR, target["dir"])
        archive_name = os.path.basename(target["url"])
        archive_path = os.path.join(TMP_DIR, archive_name)

        if os.path.exists(dest_dir):
            shutil.rmtree(dest_dir, ignore_errors=True)
        os.makedirs(dest_dir, exist_ok=True)
        os.makedirs(extract_dir, exist_ok=True)

        print(f"\n--> Staging {target['dir']}...")
        download_file(target["url"], archive_path)
        extract_archive(archive_path, extract_dir)

        if target["agent_url"]:
            agent_name = os.path.basename(target["agent_url"])
            agent_path = os.path.join(TMP_DIR, agent_name)
            download_file(target["agent_url"], agent_path)
            extract_archive(agent_path, extract_dir)

        shutil.copytree(extract_dir, dest_dir, dirs_exist_ok=True)

        bin_name = "limactl.exe" if target["dir"].startswith("win32") else "limactl"
        bin_path = os.path.join(dest_dir, "bin", bin_name)
        if os.path.exists(bin_path):
            os.chmod(bin_path, 0o755)

        print(f"✓ Staged {target['dir']}")


def fetch_qemu():
    print("\n=======================================================")
    print("  [2/2] Fetching Portable QEMU Suite for Windows")
    print("=======================================================")

    qemu_target_dir = os.path.join(BIN_RESOURCES_DIR, "win32-x64", "bin")
    os.makedirs(qemu_target_dir, exist_ok=True)

    installer_path = os.path.join(TMP_DIR, "qemu-setup.exe")
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
            print("⚠️ 7-Zip not found; skipping Windows QEMU extraction on non-Windows host.")

    uninstaller = os.path.join(qemu_target_dir, "qemu-uninstall.exe")
    if os.path.exists(uninstaller):
        os.remove(uninstaller)
    nsis_plugins = os.path.join(qemu_target_dir, "$PLUGINSDIR")
    if os.path.exists(nsis_plugins):
        shutil.rmtree(nsis_plugins, ignore_errors=True)

    print(f"✓ Windows QEMU suite staged at {qemu_target_dir}")


def main():
    os.makedirs(TMP_DIR, exist_ok=True)
    os.makedirs(BIN_RESOURCES_DIR, exist_ok=True)
    try:
        fetch_lima()
        fetch_qemu()
        print("\n=======================================================")
        print("  ✓ ALL BINARIES SUCCESSFULLY POPULATED!")
        print("=======================================================\n")
    finally:
        shutil.rmtree(TMP_DIR, ignore_errors=True)


if __name__ == "__main__":
    main()
