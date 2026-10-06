"""
绕过 pip 下载中断（SSL: RECORD_LAYER_FAILURE）的安装助手 / Install helper that avoids pip's broken downloads.

原理 / how it works:
  1. pip 只做“解析”（--dry-run --report），得到需要下载的每个 wheel 文件的网址 —— 只是很小的请求；
  2. 用 Windows 自带的 curl.exe 下载这些文件（Windows 自己的加密协议栈，支持断点续传、自动重试）；
  3. pip 从本地文件夹安装（--no-index），不再联网下载。

用法 / usage（在 backend 目录）:
  python install_ai_curl.py                      # 字幕 + 声音：faster-whisper torch transformers
  python install_ai_curl.py --mirror             # 用清华镜像下载文件（国内更快）
  python install_ai_curl.py faster-whisper       # 只装指定的包
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WHEELS = HERE / "wheels"
REPORT = HERE / "wheels_report.json"
MIRROR = "https://pypi.tuna.tsinghua.edu.cn/packages/"

args = [a for a in sys.argv[1:] if not a.startswith("--")]
use_mirror = "--mirror" in sys.argv
packages = args or ["faster-whisper", "torch", "transformers"]

curl = shutil.which("curl.exe") or shutil.which("curl")
if not curl:
    sys.exit("找不到 curl.exe（Windows 10/11 自带）。/ curl.exe not found.")

print(f"Python {sys.version.split()[0]} · 要安装 / packages: {' '.join(packages)}")
print("\n[1/3] 解析依赖（只下载很小的元数据）/ resolving dependencies ...")
WHEELS.mkdir(exist_ok=True)
r = subprocess.run([sys.executable, "-m", "pip", "install", "--dry-run", "--ignore-installed",
                    "--disable-pip-version-check", "--retries", "10", "--timeout", "60",
                    "--report", str(REPORT), *packages])
if r.returncode != 0 or not REPORT.exists():
    sys.exit("\n解析失败。如果这里也报 SSL 错误，请把这段输出截图发给 Claude。/ resolve failed.")

items = json.loads(REPORT.read_text(encoding="utf-8")).get("install", [])
print(f"\n[2/3] 用 curl 下载 {len(items)} 个文件（可断点续传）/ downloading with curl ...")
failed = []
for i, it in enumerate(items, 1):
    url = it["download_info"]["url"]
    if use_mirror and "files.pythonhosted.org/packages/" in url:
        url = MIRROR + url.split("files.pythonhosted.org/packages/", 1)[1]
    name = url.rsplit("/", 1)[-1].split("#")[0]
    dst = WHEELS / name
    print(f"  ({i}/{len(items)}) {name}")
    ok = False
    for attempt in range(1, 6):   # curl 自身重试 + 外层再试 5 次，每次都从断点继续
        c = subprocess.run([curl, "-L", "--fail", "--retry", "20", "--retry-delay", "2", "--retry-all-errors",
                            "-C", "-", "-o", str(dst), url])
        if c.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
            ok = True
            break
        if c.returncode == 33:   # 服务器不支持续传：删掉重下
            dst.unlink(missing_ok=True)
        print(f"     重试 / retry {attempt} ...")
    if not ok:
        failed.append(name)

if failed:
    print("\n以下文件下载失败 / failed downloads:")
    for f in failed:
        print("  -", f)
    sys.exit("可以重新运行本脚本（已下载的部分会保留），或加 --mirror 试试。")

print("\n[3/3] 从本地文件安装（不再联网）/ installing from local files ...")
r = subprocess.run([sys.executable, "-m", "pip", "install", "--no-index", "--find-links", str(WHEELS),
                    "--disable-pip-version-check", *packages])
if r.returncode == 0:
    print("\n完成！运行 python check_ai.py 检查，然后重启 python server.py。/ done.")
    print(f"（下载的文件在 {WHEELS}，确认能用后可以删除这个文件夹）")
else:
    print("\n本地安装失败，请把上面的输出截图发给 Claude。")
