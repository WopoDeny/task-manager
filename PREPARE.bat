@echo off
setlocal
cd /d "%~dp0"
title Task Manager - Online Preparation
echo.
echo  Task Manager - Online Preparation
echo  =================================
echo.
where node >nul 2>nul || (
  echo [ERROR] Node.js 22.12 or newer is required.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<12))process.exit(1)" || (
  echo [ERROR] Install Node.js 22.12 or newer.
  pause
  exit /b 1
)
call npm install || goto :failed
call npm run check || goto :failed
call npm run build || goto :failed
echo.
echo [READY] Build validation completed successfully.
echo You can start Task Manager with START.bat.
pause
exit /b 0

:failed
echo.
echo [ERROR] Preparation failed. Review the message above.
pause
exit /b 1
