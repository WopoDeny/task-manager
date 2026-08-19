@echo off
setlocal
cd /d "%~dp0"
if not exist "data\server.pid" (
  echo Task Manager is not running or the PID file is missing.
  pause
  exit /b 0
)
set /p TASK_MANAGER_PID=<"data\server.pid"
echo %TASK_MANAGER_PID%| findstr /R "^[0-9][0-9]*$" >nul || (
  echo [ERROR] Invalid PID file. Remove data\server.pid and check the installation.
  pause
  exit /b 1
)
powershell -NoProfile -Command "$p=Get-CimInstance Win32_Process -Filter 'ProcessId = %TASK_MANAGER_PID%' -ErrorAction SilentlyContinue; if(-not $p){exit 1}; $cmd=[string]$p.CommandLine; if($p.Name -notmatch '^node(\.exe)?$' -or $cmd -notmatch 'server[\\/]index\.js'){exit 2}; Stop-Process -Id %TASK_MANAGER_PID% -Force; exit 0"
if errorlevel 1 (
  echo Task Manager process was not found or the PID belongs to another application. No process was stopped.
) else (
  echo Task Manager stopped.
)
del /q "data\server.pid" >nul 2>nul
pause
