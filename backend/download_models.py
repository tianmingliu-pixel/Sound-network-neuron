"""
用 curl.exe 下载识别模型（绕过 hf-xet / Python SSL 中断）/ Download AI models with curl.

模型保存到 backend/models/，server.py 会优先使用这里的本地模型。
Models are saved to backend/models/ and server.py uses them first.

用法 / usage（在 backend 目录）:
  python download_models.py            # 从 huggingface.co 下载
  python download_models.py --mirror   # 从 hf-mirror.com 镜像下载（国内更快）
  python download_models.py small      # 改用 Whisper small（更准、更慢）
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
host = "https://hf-mirror.com" if "--mirror" in sys.argv else "https://huggingface.co"
size = next((a for a in sys.argv[1:] if not a.startswith("--")), "base")

# (本地文件夹, 仓库, 需要的文件 — 列表中第一个存在的权重文件即可)
JOBS = [
    (f"faster-whisper-{size}", f"Systran/faster-whisper-{size}",
     ["config.json", "tokenizer.json", "vocabulary.txt", "model.bin"]),
    ("ast-audioset", "MIT/ast-finetuned-audioset-10-10-0.4593",
     ["config.json", "preprocessor_config.json", ["model.safetensors", "pytorch_model.bin"]]),
]

curl = shutil.which("curl.exe") or shutil.which("curl")
if not curl:
    sys.exit("找不到 curl.exe（Windows 10/11 自带）。/ curl.exe not found.")


def fetch(repo: str, fname: str, dst: Path) -> bool:
    url = f"{host}/{repo}/resolve/main/{fname}"
    tmp = dst.with_suffix(dst.suffix + ".part")
    for attempt in range(1, 6):
        r = subprocess.run([curl, "-L", "--fail", "--retry", "20", "--retry-delay", "2",
                            "--retry-all-errors", "-C", "-", "-o", str(tmp), url])
        if r.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
            tmp.replace(dst)
            return True
        if r.returncode == 22:            # 404：仓库里没有这个文件
            tmp.unlink(missing_ok=True)
            return False
        if r.returncode in (33, 36):      # 服务器不支持续传：清掉重来
            tmp.unlink(missing_ok=True)
        print(f"     重试 / retry {attempt} ...")
    return False


ok_all = True
for folder, repo, files in JOBS:
    d = MODELS / folder
    d.mkdir(parents=True, exist_ok=True)
    print(f"\n=== {repo}  →  models/{folder}")
    for f in files:
        choices = f if isinstance(f, list) else [f]
        if any((d / c).exists() and (d / c).stat().st_size > 0 for c in choices):
            print(f"  [已存在 / exists] {choices[0]}")
            continue
        got = False
        for c in choices:
            print(f"  下载 / downloading {c}")
            if fetch(repo, c, d / c):
                got = True
                break
        if not got:
            print(f"  [失败 / FAILED] {choices}")
            ok_all = False

print()
if ok_all:
    print("完成！重启 python server.py，网页右上角应显示 字幕✓ 声音✓。/ done, restart server.py.")
    if size != "base":
        print(f"（启动前设置：set NEUROSENSE_WHISPER={size}）")
else:
    print("有文件下载失败。可以重新运行（会断点续传），或加 --mirror 试试。/ some downloads failed, rerun or try --mirror.")
