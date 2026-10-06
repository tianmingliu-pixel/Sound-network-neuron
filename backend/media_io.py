"""
媒体文件处理：文件名清洗、格式分类、ffmpeg 转码。

为什么需要：
  - 下载的音频文件名常带 【】#&，、 等符号，以前会被直接拒绝（MP3 上传失败的原因）。
    现在一律清洗成安全文件名，不再拒绝。
  - 浏览器能直接解码 MP3 / WAV / M4A / AAC / FLAC / OGG / OPUS / WebM / MP4 等；
    WMA、AIFF、AMR、APE、AC-3、AVI、WMV、FLV 等浏览器不支持的格式，上传时自动用 ffmpeg 转码。
  - ffmpeg 来源：系统已安装的 ffmpeg，或 pip 包 imageio-ffmpeg（自带 ffmpeg，Windows 免安装）。
"""
from __future__ import annotations

import re
import shutil
import subprocess
import unicodedata
from pathlib import Path

# 浏览器可直接播放（Chrome / Edge / Firefox 均支持）
BROWSER_AUDIO = {".wav", ".mp3", ".ogg", ".oga", ".opus", ".flac", ".m4a", ".aac", ".weba"}
BROWSER_VIDEO = {".mp4", ".m4v", ".webm", ".mov", ".mkv"}  # mov / mkv 视编码而定，失败时可按需转码
# 需要先转码
CONVERT_AUDIO = {".wma", ".aiff", ".aif", ".aifc", ".amr", ".ape", ".ac3", ".dts", ".caf", ".au", ".snd",
                 ".mka", ".wv", ".tta", ".mp2", ".m4b", ".3ga", ".awb", ".voc", ".spx"}
CONVERT_VIDEO = {".avi", ".wmv", ".flv", ".3gp", ".ts", ".mts", ".m2ts", ".mpg", ".mpeg", ".vob",
                 ".rm", ".rmvb", ".asf", ".f4v", ".ogv"}

PLAYABLE = BROWSER_AUDIO | BROWSER_VIDEO
SUPPORTED = PLAYABLE | CONVERT_AUDIO | CONVERT_VIDEO
AUDIO_EXT = BROWSER_AUDIO | CONVERT_AUDIO

_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def clean_name(raw: str) -> str:
    """把任意上传文件名变成安全文件名：保留中日韩文字、字母数字和 - _ . ( ) 空格，其余替换为 _。"""
    name = Path(str(raw).replace("\\", "/")).name
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    stem = unicodedata.normalize("NFKC", stem)
    stem = re.sub(r"[^\w\-. ()]+", "_", stem)   # \w 已包含中文、日文、韩文等文字
    stem = re.sub(r"_+", "_", stem).strip(" ._") or "audio"
    if stem.lower() in _RESERVED:
        stem = f"_{stem}"
    stem = stem[:80]
    ext = re.sub(r"[^A-Za-z0-9]", "", ext).lower()
    return f"{stem}.{ext}" if ext else stem


def unique_path(folder: Path, name: str) -> Path:
    p = folder / name
    stem, suffix = p.stem, p.suffix
    i = 1
    while p.exists():
        p = folder / f"{stem}-{i}{suffix}"
        i += 1
    return p


def find_ffmpeg() -> str | None:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


FFMPEG_HINT = "需要 ffmpeg 才能转码这种格式：python -m pip install imageio-ffmpeg（或安装系统 ffmpeg）"


def convert(src: Path, folder: Path, timeout: int = 900) -> Path:
    """转成浏览器可播放的格式：音频 → WAV（48 kHz，16-bit），视频 → MP4（H.264 + AAC）。"""
    exe = find_ffmpeg()
    if not exe:
        raise RuntimeError(FFMPEG_HINT)
    is_audio = src.suffix.lower() in AUDIO_EXT
    if is_audio:
        dst = unique_path(folder, f"{src.stem}.wav")
        args = ["-vn", "-ar", "48000", "-c:a", "pcm_s16le"]
    else:
        dst = unique_path(folder, f"{src.stem}_h264.mp4")
        args = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]
    cmd = [exe, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), *args, str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0 or not dst.exists() or dst.stat().st_size == 0:
        dst.unlink(missing_ok=True)
        tail = (r.stderr or "").strip().splitlines()[-3:]
        raise RuntimeError("转码失败：" + " / ".join(tail) if tail else "转码失败（文件可能已损坏）")
    return dst
