@echo off
set PYTHONIOENCODING=utf-8
set PYLON2_DAEMON_MODE=server
set PYLON2_TRAY_NAME=pylon-server
set PYLON2_DATA_DIR=%USERPROFILE%\pylon-server\data
if not exist "%PYLON2_DATA_DIR%" mkdir "%PYLON2_DATA_DIR%"
if exist "%~dp0..\main.py" (
    cd /d "%~dp0\.."
    start "" /b pythonw "%~dp0windows\agent.py" >> "%PYLON2_DATA_DIR%\pylon-daemon-server.log" 2>&1
    if errorlevel 1 python "%~dp0windows\agent.py"
) else (
    cd /d "C:\Users\sm\.gemini\antigravity\scratch\pylon-server"
    start "" /b pythonw "C:\Users\sm\.gemini\antigravity\scratch\pylon-server\daemons\windows\agent.py" >> "%PYLON2_DATA_DIR%\pylon-daemon-server.log" 2>&1
    if errorlevel 1 python "C:\Users\sm\.gemini\antigravity\scratch\pylon-server\daemons\windows\agent.py"
)
