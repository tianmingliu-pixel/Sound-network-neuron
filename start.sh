#!/usr/bin/env bash
# NeuroSense launcher (macOS / Linux)
set -e
cd "$(dirname "$0")/backend"

if [ -x ".venv/bin/python" ]; then PY=".venv/bin/python"; else PY="python3"; fi
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "[NeuroSense] python3 not found. Install Python 3.10+ first." >&2
  exit 1
fi

if ! "$PY" -c "import numpy, starlette, uvicorn, multipart, imageio_ffmpeg" >/dev/null 2>&1; then
  echo "[NeuroSense] First run: installing base packages ..."
  "$PY" -m pip install -r requirements.txt
fi

(sleep 2; "$PY" -m webbrowser http://127.0.0.1:8000 >/dev/null 2>&1) &
exec "$PY" server.py
