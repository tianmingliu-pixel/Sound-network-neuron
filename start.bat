@echo off
rem NeuroSense launcher (Windows)
rem - uses backend\.venv (created by install-ai.bat) if present, otherwise system Python
rem - installs the base packages on first run
cd /d "%~dp0backend"

if exist ".venv\Scripts\python.exe" (
  set "PY=.venv\Scripts\python.exe"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo.
    echo [NeuroSense] Python not found. Install Python 3.10+ from https://www.python.org/downloads/
    echo              and tick "Add python.exe to PATH" during setup, then run start.bat again.
    echo.
    pause
    exit /b 1
  )
  set "PY=python"
)

"%PY%" -c "import numpy, starlette, uvicorn, multipart, imageio_ffmpeg" >nul 2>nul
if errorlevel 1 (
  echo [NeuroSense] First run: installing base packages ...
  "%PY%" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [NeuroSense] pip install failed. See README.md - Troubleshooting.
    pause
    exit /b 1
  )
)

rem If an older NeuroSense backend is still running on port 8000, stop it so the new code is used.
rem Only processes that answer like NeuroSense (/api/files) are stopped.
curl -s -m 2 http://127.0.0.1:8000/api/files 2>nul | findstr /c:"\"files\"" >nul 2>nul
if not errorlevel 1 (
  echo [NeuroSense] An older NeuroSense backend is running on port 8000 - stopping it ...
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"127.0.0.1:8000 .*LISTENING"') do taskkill /F /PID %%p >nul 2>nul
  timeout /t 1 /nobreak >nul
)

start "" http://127.0.0.1:8000
"%PY%" server.py
pause
