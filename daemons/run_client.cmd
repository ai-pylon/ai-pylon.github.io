@echo off
cd /d "%~dp0\.."
set PYTHONIOENCODING=utf-8
set PYLON2_DAEMON_MODE=client
set PYLON2_TRAY_NAME=pylon-daemon
set PYLON2_DATA_DIR=%USERPROFILE%\pylon-server\data
if not "%~1"=="" set PYLON2_FRAMEWORK_URL=%~1
if not exist "%PYLON2_DATA_DIR%" mkdir "%PYLON2_DATA_DIR%"
start "" /b pythonw "%~dp0windows\agent.py" >> "%PYLON2_DATA_DIR%\pylon-daemon-client.log" 2>&1
if errorlevel 1 python "%~dp0windows\agent.py"
