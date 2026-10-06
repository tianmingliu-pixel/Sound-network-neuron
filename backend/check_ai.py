"""
NeuroSense 识别功能自检 / AI package self-check

用法 / usage:  python check_ai.py
结果同时打印在屏幕上，并保存到同目录的 ai_check.txt（Claude 可以直接读取这个文件）。
The report is printed and saved to ai_check.txt next to this script.
"""
import importlib
import importlib.metadata as md
import os
import platform
import struct
import subprocess
import sys
import traceback
from pathlib import Path

OUT = Path(__file__).with_name("ai_check.txt")
lines = []


def log(s=""):
    print(s)
    lines.append(str(s))


log("=== NeuroSense AI self-check ===")
log(f"python      : {sys.version.split()[0]}  ({struct.calcsize('P') * 8}-bit)")
log(f"executable  : {sys.executable}")
log(f"platform    : {platform.platform()}")
log(f"venv        : {'yes' if sys.prefix != sys.base_prefix else 'no'}")
log(f"HF_ENDPOINT : {os.environ.get('HF_ENDPOINT', '(not set)')}")
log("")

# (功能, 导入名, 发行包名)
CHECKS = [
    ("captions", "faster_whisper", "faster-whisper"),
    ("captions", "ctranslate2", "ctranslate2"),
    ("sound", "torch", "torch"),
    ("sound", "transformers", "transformers"),
    ("birds", "birdnetlib", "birdnetlib"),
    ("birds", "tensorflow", "tensorflow"),
    ("birds", "librosa", "librosa"),
    ("base", "numpy", "numpy"),
    ("base", "imageio_ffmpeg", "imageio-ffmpeg"),
]

status = {}
log("--- installed packages & import test ---")
for feature, mod, dist in CHECKS:
    try:
        ver = md.version(dist)
    except md.PackageNotFoundError:
        ver = None
    if ver is None:
        log(f"[MISSING] {dist:15s} not installed")
        status.setdefault(feature, []).append(False)
        continue
    try:
        importlib.import_module(mod)
        log(f"[OK]      {dist:15s} {ver}")
        status.setdefault(feature, []).append(True)
    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exception_only(type(e), e)[-1].strip()
        log(f"[BROKEN]  {dist:15s} {ver}  -> import failed: {tb[:300]}")
        status.setdefault(feature, []).append(False)
log("")

# 用 pip 的 dry-run 判断这个 Python 能否安装（不会真的安装）
log("--- can pip find builds for THIS python? (dry run, nothing is installed) ---")
for dist in ["faster-whisper", "torch", "transformers", "birdnetlib", "tensorflow"]:
    try:
        r = subprocess.run([sys.executable, "-m", "pip", "install", "--dry-run", "--no-deps",
                            "--disable-pip-version-check", dist],
                           capture_output=True, text=True, timeout=180)
        text = (r.stdout + r.stderr).strip().splitlines()
        key = [l for l in text if "Would install" in l or "ERROR" in l or "No matching" in l or "Requirement already" in l]
        log(f"{dist:15s}: {(key[-1] if key else (text[-1] if text else 'no output'))[:300]}")
    except Exception as e:  # noqa: BLE001
        log(f"{dist:15s}: dry run failed: {e}")
log("")

log("--- summary ---")
for feature in ["captions", "sound", "birds"]:
    ok = all(status.get(feature, [False]))
    log(f"{feature:9s}: {'READY' if ok else 'NOT READY'}")

OUT.write_text("\n".join(lines), encoding="utf-8")
log("")
log(f"saved to {OUT}")
