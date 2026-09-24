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

def create_qemu_wrapper(qemu_target_dir):
    orig_qemu = os.path.join(qemu_target_dir, "qemu-system-x86_64.exe")
    real_qemu = os.path.join(qemu_target_dir, "qemu-system-x86_64.real.exe")
    if not os.path.exists(orig_qemu) and not os.path.exists(real_qemu):
        return

    if os.path.exists(orig_qemu) and not os.path.exists(real_qemu):
        os.rename(orig_qemu, real_qemu)

    c_source = r'''#include <windows.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

int main() {
    char exePath[MAX_PATH];
    GetModuleFileNameA(NULL, exePath, MAX_PATH);
    char *lastSlash = strrchr(exePath, '\\');
    if (lastSlash) *(lastSlash + 1) = '\0';
    else strcpy(exePath, ".\\");

    char realExe[MAX_PATH];
    snprintf(realExe, sizeof(realExe), "%sqemu-system-x86_64.real.exe", exePath);

    char *cmdLine = GetCommandLineA();
    char *args = cmdLine;
    if (*args == '"') {
        args++;
        while (*args && *args != '"') args++;
        if (*args == '"') args++;
    } else {
        while (*args && *args != ' ' && *args != '\t') args++;
    }
    while (*args == ' ' || *args == '\t') args++;

    size_t newCmdLen = strlen(realExe) + strlen(args) + 256;
    char *newCmd = (char *)malloc(newCmdLen);
    if (!newCmd) return 1;

    char *whpxPos = strstr(args, "accel=whpx");
    if (whpxPos && !strstr(args, "kernel-irqchip=off")) {
        size_t prefixLen = whpxPos - args;
        snprintf(newCmd, newCmdLen, "\"%s\" %.*saccel=whpx,kernel-irqchip=off%s",
                 realExe, (int)prefixLen, args, whpxPos + strlen("accel=whpx"));
    } else {
        snprintf(newCmd, newCmdLen, "\"%s\" %s", realExe, args);
    }

    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    if (!CreateProcessA(NULL, newCmd, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
        free(newCmd);
        return (int)GetLastError();
    }

    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD exitCode = 0;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    free(newCmd);

    return (int)exitCode;
}
'''
    c_file = os.path.join(TMP_DIR, "qemu_wrapper.c")
    with open(c_file, "w", encoding="utf-8") as f:
        f.write(c_source)

    compiled = False
    compilers = [
        shutil.which("gcc"),
        shutil.which("clang"),
        shutil.which("x86_64-w64-mingw32-gcc"),
        r"C:\Program Files\Git\mingw64\bin\gcc.exe",
        r"C:\Program Files\Git\usr\bin\gcc.exe",
        r"C:\msys64\mingw64\bin\gcc.exe",
        r"C:\msys64\ucrt64\bin\gcc.exe",
    ]
    for cc in compilers:
        if cc and os.path.exists(cc):
            try:
                subprocess.run([cc, "-O2", "-s", c_file, "-o", orig_qemu], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                compiled = True
                print("   [OK] Compiled native QEMU argument wrapper (qemu-system-x86_64.exe)")
                break
            except Exception:
                pass

    if not compiled:
        cl = shutil.which("cl")
        if cl:
            try:
                subprocess.run([cl, "/O2", c_file, f"/Fe:{orig_qemu}", "/link", "/SUBSYSTEM:CONSOLE"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                compiled = True
                print("   [OK] Compiled native QEMU argument wrapper via MSVC (qemu-system-x86_64.exe)")
            except Exception:
                pass

    if not compiled:
        wrapper_cmd = os.path.join(qemu_target_dir, "qemu-system-x86_64.cmd")
        wrapper_bat = os.path.join(qemu_target_dir, "qemu-system-x86_64.bat")
        cmd_content = (
            '@echo off\r\n'
            'setlocal enabledelayedexpansion\r\n'
            'set "CMD_ARGS=%*"\r\n'
            'set "CMD_ARGS=!CMD_ARGS:accel=whpx=accel=whpx,kernel-irqchip=off!"\r\n'
            '"%~dp0qemu-system-x86_64.real.exe" !CMD_ARGS!\r\n'
        )
        with open(wrapper_cmd, "w", encoding="utf-8") as f:
            f.write(cmd_content)
        with open(wrapper_bat, "w", encoding="utf-8") as f:
            f.write(cmd_content)
        print("   [OK] Staged QEMU argument wrapper scripts (.cmd / .bat)")


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

        create_qemu_wrapper(qemu_target_dir)

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
