# 온라인 버전: Vercel(화면) + 내 컴퓨터(백엔드)

[English](DEPLOY.md) | [简体中文](DEPLOY.zh-CN.md) | **한국어** | [Deutsch](DEPLOY.de.md)

```
Browser ──► https://sound-network-neuron.vercel.app     frontend/ (Vercel, static files)
              │  HTTP (files / upload / media) + WebSocket (PCM audio)
              ▼
        http://127.0.0.1:8000                            backend/server.py on your own computer
```

웹 페이지는 표시만 합니다. 분석·자막·소리/새 종 인식은 **방문자 자신의 컴퓨터**에 있는 백엔드에서 실행되며, 오디오와 파일은 업로드되지 않습니다. 백엔드가 없으면 「Backend connection」 패널이 열려 시작 방법을 알려 줍니다. (화면 언어는 중국어·영어·일본어·프랑스어·스페인어를 지원하므로 아래 항목 이름은 영어 화면 기준입니다.)

## 사용자

1. README의 빠른 시작대로 백엔드를 시작합니다: Windows는 `start.bat` 더블클릭, macOS / Linux는 `./start.sh` 실행.
2. Chrome / Edge / Firefox로 <https://sound-network-neuron.vercel.app> 을 엽니다.
3. 오른쪽 위 상태가 "Connected"이면 사용할 수 있습니다. 상태를 클릭하면 패널이 열립니다.

| 항목 | 의미 |
|---|---|
| Current | 사용 중인 백엔드: 이 페이지 / 내 컴퓨터 / 수동 설정 / 찾지 못함 |
| Backend URL | 보통 비워 두고 자동 선택에 맡김 |
| Local `http://127.0.0.1:8000` | 내 컴퓨터 (자동으로 못 찾았을 때 클릭) |
| Auto-select | 수동 설정을 지움 |
| Save & reconnect | 위 주소를 저장하고 새로 고침 |

자동 선택 순서: ① 수동 설정(패널 또는 `?api=…`) → ② 페이지 자신의 주소(`http://127.0.0.1:8000`에서 열었을 때) → ③ 내 컴퓨터의 `http://127.0.0.1:8000` → ④ 사이트 기본 백엔드(`frontend/config.js`, 기본값 비어 있음).

## 저장소 주인: Vercel 배포 (한 번)

1. GitHub 계정으로 <https://vercel.com> 로그인 → **Add New… → Project** → `Sound-network-neuron` → **Import**.
2. Framework Preset은 **Other**, 나머지는 그대로(`vercel.json`: 설치·빌드 없이 `frontend/` 게시) → **Deploy**.
3. 이후 GitHub에 푸시할 때마다 자동으로 다시 배포됩니다.

주소가 `sound-network-neuron*.vercel.app`이 아니면(이름 변경, 자체 도메인) 백엔드 시작 전에 설정합니다:

```powershell
$env:NEUROSENSE_ALLOWED_ORIGINS = "https://내-도메인"
.\start.bat
```

## 보안

- 백엔드는 `127.0.0.1`에서만 수신하므로 인터넷에서 접근할 수 없습니다.
- 로컬 페이지와 `sound-network-neuron*.vercel.app`(및 `NEUROSENSE_ALLOWED_ORIGINS`)의 요청과 WebSocket만 받습니다. 다른 웹사이트는 미디어를 읽거나 업로드·변환할 수 없습니다.
- 마이크 / 카메라는 브라우저가 먼저 허락을 묻고, 오디오는 내 컴퓨터의 백엔드로만 갑니다.

## 문제 해결

| 증상 | 해결 |
|---|---|
| 계속 "No backend connected" | `start.bat` / `./start.sh` 실행 후 새로 고침 |
| Chrome / Edge가 「로컬 네트워크의 기기」 접근을 물음 | 「허용」 클릭 |
| Safari에서 연결 안 됨 | Chrome / Edge / Firefox 사용 또는 `http://127.0.0.1:8000` 직접 열기 |
| 파일 목록은 보이지만 "Disconnected, reconnecting…" | `uvicorn[standard]` 설치 확인(`pip install -r backend/requirements.txt`) |
| 자체 도메인 연결 안 됨 | `NEUROSENSE_ALLOWED_ORIGINS` 설정 |
| 8000 포트 사용 중 | 따로 할 일 없음: 백엔드가 8001…8010으로 자동 전환하고 페이지도 자동으로 찾습니다. 포트를 고정하려면 `NEUROSENSE_PORT` 설정 |
