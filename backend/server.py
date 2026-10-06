"""
NeuroSense 后端服务 v0.2 (Starlette + uvicorn)

运行:
    python server.py          # 默认 http://127.0.0.1:8000

接口:
    GET  /api/files           列出 media/ 目录下的音频 / 视频文件
    POST /api/upload          上传媒体文件（multipart 字段名 file）；文件名自动清洗，不支持的格式自动转码
    POST /api/convert         {"file": 名称}：把已有文件转成浏览器可播放的格式
    GET  /media/{name}        原始媒体（浏览器负责解码）
    WS   /ws                  流式分析通道

WebSocket 协议:
    客户端 → 文本 {"type": "start", "sr": 48000, "channels": 2, "t0": 0.0, "source": "file|mic"}
    客户端 → 二进制  float32 PCM，按声道交错 (L R L R ...)
    客户端 → 文本 {"type": "reset", "t0": 12.3}         # 跳转：清缓冲，图保留
    客户端 → 文本 {"type": "clear"}                      # 清空图
    客户端 → 文本 {"type": "export"}                     # 导出图

    服务端 ← {"type": "ready", "band_centers": [...]}
    服务端 ← {"type": "frame", "t", "bands", "rms", "centroid", "tonality", "azimuth", ...}  每秒 60 帧
    服务端 ← {"type": "event", "node": {...}, "edges": [[src, dst, type], ...]}          每个声音事件
    服务端 ← {"type": "pca_ready", "coords": {"id": [x, y, z], ...}}
    服务端 ← {"type": "graph", ...}                                                       export 的回复
    服务端 ← {"type": "ai_status", "speech", "sound", "bird"}                              识别引擎状态
    服务端 ← {"type": "caption", "t", "t_end", "text", "lang", "lang_name"}                  语音字幕
    服务端 ← {"type": "sound", "t", "t_end", "labels": [{"zh", "en", "group", "score"}]}     声音类别
    服务端 ← {"type": "bird", "t", "t_end", "species": [{"sci", "common", "conf"}]}         鸟种

三种输入源（文件 / 视频 / 麦克风）都在浏览器里解码成 PCM，所以后端只有这一条路径。
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import sys
from pathlib import Path

import numpy as np
import uvicorn
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket

from audio_engine import make_demo_wav
from stream_engine import StreamSession
from recognizers import ENGINE, AISession
from media_io import PLAYABLE, SUPPORTED, clean_name, convert, find_ffmpeg, unique_path

ROOT = Path(__file__).resolve().parent
MEDIA_DIR = ROOT / "media"
FRONTEND_DIR = ROOT.parent / "frontend"
MEDIA_DIR.mkdir(exist_ok=True)

DEMO = MEDIA_DIR / "demo.wav"
if not DEMO.exists():
    make_demo_wav(DEMO)


def _media_path(name: str) -> Path | None:
    """只允许访问 media/ 目录下已存在、格式受支持的文件。"""
    p = (MEDIA_DIR / Path(name).name).resolve()
    if p.parent != MEDIA_DIR.resolve() or not p.is_file() or p.suffix.lower() not in SUPPORTED:
        return None
    return p


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------
async def list_files(request: Request):
    files = sorted((p.name for p in MEDIA_DIR.iterdir() if p.suffix.lower() in PLAYABLE), key=str.lower)
    return JSONResponse({"files": files, "ffmpeg": find_ffmpeg() is not None})


async def upload(request: Request):
    """上传任意常见音频 / 视频。文件名自动清洗；浏览器不支持的格式自动转码。"""
    form = await request.form()
    f = form.get("file")
    if f is None or not getattr(f, "filename", None):
        return JSONResponse({"error": "没有收到文件"}, status_code=400)
    name = clean_name(f.filename)
    ext = Path(name).suffix.lower()
    if ext not in SUPPORTED:
        return JSONResponse({"error": f"不支持的格式「{ext or '无扩展名'}」。支持："
                             + " ".join(sorted(e.lstrip('.') for e in SUPPORTED))}, status_code=400)
    dst = unique_path(MEDIA_DIR, name)
    with open(dst, "wb") as out:
        while chunk := await f.read(1 << 20):
            out.write(chunk)
    if dst.stat().st_size == 0:
        dst.unlink()
        return JSONResponse({"error": "文件是空的"}, status_code=400)
    if ext in PLAYABLE:
        return JSONResponse({"ok": True, "file": dst.name, "renamed": dst.name != Path(f.filename).name})
    try:
        out = await run_in_threadpool(convert, dst, MEDIA_DIR)
    except Exception as e:
        return JSONResponse({"error": str(e), "file": dst.name}, status_code=400)
    return JSONResponse({"ok": True, "file": out.name, "converted": True, "original": dst.name})


async def convert_file(request: Request):
    """浏览器解码失败时由前端调用：把已有文件转成 WAV（音频）或 H.264 MP4（视频）。"""
    data = await request.json()
    src = _media_path(str(data.get("file", "")))
    if src is None:
        return JSONResponse({"error": "文件不存在"}, status_code=404)
    try:
        out = await run_in_threadpool(convert, src, MEDIA_DIR)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    return JSONResponse({"ok": True, "file": out.name})


async def media_file(request: Request):
    p = _media_path(request.path_params["name"])
    if p is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(p)  # 支持 Range 请求，可拖动进度


# ----------------------------------------------------------------------------
# WebSocket：流式分析 + 识别（字幕 / 声音 / 鸟种）
# ----------------------------------------------------------------------------
AI_ENABLED = "--no-ai" not in sys.argv and os.environ.get("NEUROSENSE_AI", "1") != "0"


async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    loop = asyncio.get_running_loop()
    out_q: asyncio.Queue = asyncio.Queue()

    def emit(msg: dict):
        """线程安全：识别线程也通过它把结果交给发送队列。"""
        loop.call_soon_threadsafe(out_q.put_nowait, msg)

    async def sender():
        # 所有输出只由这一个协程发送，避免实时帧与识别结果并发写同一个连接
        while True:
            m = await out_q.get()
            if m is None:
                return
            await ws.send_json(m)

    send_task = asyncio.create_task(sender())
    session: StreamSession | None = None
    ai: AISession | None = None
    if AI_ENABLED:
        out_q.put_nowait(ENGINE.status())
    else:
        out_q.put_nowait({"type": "ai_status", "disabled": True})

    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break

            if msg.get("bytes") is not None:
                if session is None:
                    continue
                pcm = np.frombuffer(msg["bytes"], dtype="<f4")
                usable = len(pcm) - len(pcm) % session.ch
                block = pcm[:usable].reshape(-1, session.ch)
                for out in session.push(block):
                    out_q.put_nowait(out)
                if ai is not None:
                    ai.push(block)
                continue

            try:
                data = json.loads(msg.get("text") or "{}")
            except json.JSONDecodeError:
                continue
            kind = data.get("type")

            if kind == "start":
                sr = int(data.get("sr", 48000))
                ch = max(1, min(int(data.get("channels", 2)), 16))
                t0 = float(data.get("t0", 0.0))
                if not (8000 <= sr <= 192000):
                    out_q.put_nowait({"type": "error", "message": f"采样率不支持: {sr}"})
                    continue
                keep_graph = session is not None and session.sr == sr and session.ch == ch \
                    and data.get("keep_graph", True)
                if not keep_graph:
                    session = StreamSession(sr, ch)
                session.reset(t0)
                if AI_ENABLED:
                    if ai is None or ai.sr != sr or ai.ch != ch:
                        if ai is not None:
                            ai.close()
                        ai = AISession(sr, ch, emit)
                    ai.reset(t0)
                out_q.put_nowait({"type": "ready", "sr": sr, "channels": ch,
                                  "band_centers": np.round(session.band_centers, 1).tolist(),
                                  "nodes": len(session.nodes)})

            elif session is None:
                continue
            elif kind == "reset":
                session.reset(float(data.get("t0", 0.0)))
                if ai is not None:
                    ai.reset(float(data.get("t0", 0.0)))
            elif kind == "clear":
                session.clear_graph()
            elif kind == "export":
                out_q.put_nowait({"type": "graph", **session.export_graph()})
    finally:
        if ai is not None:
            ai.close()
        out_q.put_nowait(None)
        send_task.cancel()


def _quiet_disconnects(loop, context):
    """Windows 上浏览器断开连接（刷新、拖动进度、关标签页）时，asyncio 会打印
    ConnectionResetError [WinError 10054]。这是无害的，直接忽略；其它异常照常显示。"""
    exc = context.get("exception")
    if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
        return
    loop.default_exception_handler(context)


@contextlib.asynccontextmanager
async def lifespan(app):
    asyncio.get_running_loop().set_exception_handler(_quiet_disconnects)
    if AI_ENABLED:
        ENGINE.start()  # 后台加载模型，不阻塞启动
    yield


app = Starlette(lifespan=lifespan, routes=[
    Route("/api/files", list_files),
    Route("/api/upload", upload, methods=["POST"]),
    Route("/api/convert", convert_file, methods=["POST"]),
    Route("/media/{name}", media_file),
    WebSocketRoute("/ws", ws_endpoint),
    Mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend"),
])

if __name__ == "__main__":
    print("NeuroSense v0.7 已启动 → http://127.0.0.1:8000（按 Ctrl+C 退出）")
    if AI_ENABLED:
        print("识别功能：后台加载模型中（首次运行会自动下载模型）。用 --no-ai 可关闭。")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
