@echo off
rem pylon-server on Windows: the daemon in server mode (config.json "mode": "server")
rem starts the server on http://127.0.0.1:8910, its tray icon, and this machine's capabilities.
cd /d "%~dp0\..\.."
set PYTHONIOENCODING=utf-8
set PYLON2_DATA_DIR=%USERPROFILE%\pylon-server\data
if not exist "%PYLON2_DATA_DIR%" mkdir "%PYLON2_DATA_DIR%"
python daemons\windows\agent.py >> "%PYLON2_DATA_DIR%\pylon-daemon.log" 2>&1
