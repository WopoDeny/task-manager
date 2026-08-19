@echo off
setlocal
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo [ERROR] Run PREPARE.bat before installing autostart.
  pause
  exit /b 1
)
schtasks /Create /TN "TaskManagerService" /SC ONLOGON /TR "wscript.exe \"%~dp0START_HIDDEN.vbs\"" /F
if errorlevel 1 (
  echo [ERROR] Autostart could not be installed. Try Run as administrator.
) else (
  echo [READY] Task Manager will start silently when this user signs in.
)
pause
