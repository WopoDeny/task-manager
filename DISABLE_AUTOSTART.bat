@echo off
schtasks /Delete /TN "TaskManagerService" /F
if errorlevel 1 (
  echo Task Manager autostart task was not found.
) else (
  echo Task Manager autostart removed.
)
pause
