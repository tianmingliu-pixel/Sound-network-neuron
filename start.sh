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

# If an older NeuroSense backend is still running on port 8000, stop it so the new code is used.
if curl -s -m 2 http://127.0.0.1:8000/api/files 2>/dev/null | grep -q '"files"'; then
  echo "[NeuroSense] An older NeuroSense backend is running on port 8000 - stopping it ..."
  if command -v lsof >/dev/null 2>&1; then kill $(lsof -ti tcp:8000 -sTCP:LISTEN) 2>/dev/null || true; fi
  sleep 1
fi

(sleep 2; "$PY" -m webbrowser http://127.0.0.1:8000 >/dev/null 2>&1) &
exec "$PY" server.py
