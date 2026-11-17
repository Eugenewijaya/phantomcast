#!/usr/bin/env python3
"""
Builds backend/virtual_bridge.py into a standalone Windows executable (backend/dist/virtual_bridge.exe)
using PyInstaller (--onefile --noconsole --name virtual_bridge).
Automatically uses backend/venv/Scripts/python.exe when available.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
DIST_DIR = BACKEND_DIR / "dist"
BUILD_DIR = BACKEND_DIR / "build"
SCRIPT_PATH = BACKEND_DIR / "virtual_bridge.py"
VENV_PYTHON = BACKEND_DIR / "venv" / "Scripts" / "python.exe"


def get_python_executable() -> str:
    if VENV_PYTHON.exists():
        return str(VENV_PYTHON)
    return sys.executable


def main() -> int:
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    py_exe = get_python_executable()

    has_pyinstaller = False
    try:
        res = subprocess.run(
            [py_exe, "-m", "PyInstaller", "--version"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        has_pyinstaller = res.returncode == 0
    except Exception:
        has_pyinstaller = False

    if has_pyinstaller:
        print(f"[build-sidecar] Mengemas backend/virtual_bridge.py dengan PyInstaller ({py_exe})...")
        cmd = [
            py_exe,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--onefile",
            "--noconsole",
            "--clean",
            "--name",
            "virtual_bridge",
            "--distpath",
            str(DIST_DIR),
            "--workpath",
            str(BUILD_DIR),
            "--specpath",
            str(BUILD_DIR),
            str(SCRIPT_PATH),
        ]
        proc = subprocess.run(cmd)
        exe_out = DIST_DIR / "virtual_bridge.exe"
        if proc.returncode == 0 and exe_out.exists():
            size_mb = exe_out.stat().st_size / (1024 * 1024)
            print(f"[build-sidecar] Berhasil membuat executable mandiri: {exe_out} ({size_mb:.2f} MB)")
            return 0
        print("[build-sidecar] PyInstaller gagal membuat virtual_bridge.exe.")
        return 1

    print("[build-sidecar] PyInstaller belum ditemukan. Menyalin virtual_bridge.py ke backend/dist/...")
    shutil.copy2(SCRIPT_PATH, DIST_DIR / "virtual_bridge.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
