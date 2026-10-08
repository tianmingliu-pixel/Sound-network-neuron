# Online version: Vercel (interface) + your own computer (backend)

**English** | [简体中文](DEPLOY.zh-CN.md) | [한국어](DEPLOY.ko.md) | [Deutsch](DEPLOY.de.md)

```
Browser ──► https://sound-network-neuron.vercel.app     frontend/ (Vercel, static files)
              │  HTTP (files / upload / media) + WebSocket (PCM audio)
              ▼
        http://127.0.0.1:8000                            backend/server.py on your own computer
```

The page only displays. Analysis, captions and sound / bird recognition run in the backend on **the visitor's own computer**; audio and files are never uploaded. Without a backend, the page opens a "Backend connection" panel explaining how to start one.

## Users

1. Start the backend as in the README's Quick start: double-click `start.bat` on Windows, run `./start.sh` on macOS / Linux.
2. Open <https://sound-network-neuron.vercel.app> in Chrome / Edge / Firefox.
3. When the status at the top right says "Connected", you are ready. Click the status to open the "Backend connection" panel:

| Option | Meaning |
|---|---|
| Current | backend in use: this page / your own computer / manually set / none found |
| Backend URL | normally leave empty and let auto-select decide |
| Local `http://127.0.0.1:8000` | your own computer (click it if auto-detection missed it) |
| Auto-select | clears manual settings |
| Save & reconnect | saves the URL above and reloads |

Auto-select order: ① manual setting (panel or `?api=…`) → ② the page's own address (when opened from `http://127.0.0.1:8000`) → ③ `http://127.0.0.1:8000` on your computer → ④ site default backend (`frontend/config.js`, empty by default).

## Repository owner: deploying to Vercel (once)

1. Sign in to <https://vercel.com> with GitHub → **Add New… → Project** → `Sound-network-neuron` → **Import**.
2. Framework Preset: **Other**, keep the rest (`vercel.json`: no install, no build, publish `frontend/`) → **Deploy**.
3. Every push to GitHub redeploys automatically.

If the address is not `sound-network-neuron*.vercel.app` (renamed project or own domain), set before starting the backend:

```powershell
$env:NEUROSENSE_ALLOWED_ORIGINS = "https://your-domain"
.\start.bat
```

## Security

- The backend listens on `127.0.0.1` only and is not reachable from the internet.
- Cross-origin requests and WebSockets are accepted only from local pages and `sound-network-neuron*.vercel.app` (plus `NEUROSENSE_ALLOWED_ORIGINS`); other websites can neither read your media nor upload or convert anything.
- The browser asks before using the microphone / camera; audio goes only to the backend on your own computer.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Keeps showing "No backend connected" | Start `start.bat` / `./start.sh`, then reload |
| Chrome / Edge asks about "devices on your local network" | Click "Allow" |
| Safari cannot connect | Use Chrome / Edge / Firefox, or open `http://127.0.0.1:8000` directly |
| File list works but "Disconnected, reconnecting…" | Make sure `uvicorn[standard]` is installed (`pip install -r backend/requirements.txt`) |
| Own domain cannot connect | Set `NEUROSENSE_ALLOWED_ORIGINS` |
| Port 8000 in use | Nothing to do: the backend switches to 8001…8010 automatically and the page finds it; set `NEUROSENSE_PORT` to pin a port |
