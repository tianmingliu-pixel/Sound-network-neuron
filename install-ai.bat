@echo off
rem NeuroSense: install speech / sound / bird recognition (see backend\install-ai.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend\install-ai.ps1" %*
pause
