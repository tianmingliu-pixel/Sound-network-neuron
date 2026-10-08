# 在线版网页：Vercel（界面）+ 你自己的电脑（后端）

[English](DEPLOY.md) | **简体中文** | [한국어](DEPLOY.ko.md) | [Deutsch](DEPLOY.de.md)

```
Browser ──► https://sound-network-neuron.vercel.app     frontend/ (Vercel, static files)
              │  HTTP (files / upload / media) + WebSocket (PCM audio)
              ▼
        http://127.0.0.1:8000                            backend/server.py on your own computer
```

网页只负责显示；分析、字幕、声音 / 鸟种识别都在**访问者自己电脑上**的后端里运行，音频和文件不会上传到网上。没有后端时，网页会弹出「后端连接」面板说明怎么启动。

## 使用者

1. 按 README 的「快速开始」启动后端：Windows 双击 `start.bat`，macOS / Linux 运行 `./start.sh`。
2. 用 Chrome / Edge / Firefox 打开 <https://sound-network-neuron.vercel.app>。
3. 右上角状态显示「已连接」即可使用。点状态文字打开「后端连接」面板：

| 选项 | 意思 |
|---|---|
| 当前 | 正在使用的后端：本页面 / 你自己电脑上的后端 / 手动设置 / 没有找到 |
| 后端地址 | 一般留空，交给自动选择 |
| 本机 `http://127.0.0.1:8000` | 你自己的电脑（自动没找到时手动点它） |
| 自动选择 | 清除手动设置，恢复自动 |
| 保存并重新连接 | 保存上面的地址并刷新 |

自动选择顺序：① 手动设置（面板或网址 `?api=…`）→ ② 本页面同一个地址（从 `http://127.0.0.1:8000` 打开时）→ ③ 你电脑上的 `http://127.0.0.1:8000` → ④ 网站默认后端（`frontend/config.js`，默认为空）。

## 仓库主人：部署到 Vercel（一次）

1. 用 GitHub 账户登录 <https://vercel.com> → **Add New… → Project** → 选 `Sound-network-neuron` → **Import**。
2. Framework Preset 选 **Other**，其余保持默认（`vercel.json`：不安装、不构建，直接发布 `frontend/`）→ **Deploy**。
3. 以后每次推送到 GitHub，Vercel 自动重新发布。

网址不是 `sound-network-neuron*.vercel.app`（改了项目名或用自己的域名）时，启动后端前设置：

```powershell
$env:NEUROSENSE_ALLOWED_ORIGINS = "https://你的域名"
.\start.bat
```

## 安全

- 后端只监听 `127.0.0.1`，外网访问不到。
- 只接受本机页面和 `sound-network-neuron*.vercel.app`（以及 `NEUROSENSE_ALLOWED_ORIGINS`）的跨域请求和 WebSocket；其它网站不能读取你的媒体文件，也不能上传或转码。
- 麦克风 / 摄像头由浏览器询问授权，音频只发到你自己电脑上的后端。

## 常见问题

| 现象 | 解决 |
|---|---|
| 一直「未连接后端」 | 先启动 `start.bat` / `./start.sh`，再刷新网页 |
| Chrome / Edge 询问「访问本地网络上的设备」 | 点「允许」 |
| Safari 连不上 | 改用 Chrome / Edge / Firefox，或直接打开 `http://127.0.0.1:8000` |
| 文件列表正常但「断开，重连中…」 | 确认安装了 `uvicorn[standard]`（`pip install -r backend/requirements.txt`） |
| 自己的域名连不上 | 设置 `NEUROSENSE_ALLOWED_ORIGINS` |
| 端口 8000 被占用 | 不用处理：后端会自动改用 8001…8010，网页也会自动找到；想固定端口可设置 `NEUROSENSE_PORT` |
