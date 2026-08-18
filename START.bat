@echo off
setlocal
cd /d "%~dp0"
title Task Manager
if not exist "node_modules" (
  echo [ERROR] Dependencies are missing. Run PREPARE.bat on a computer with internet access.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo [ERROR] Production build is missing. Run PREPARE.bat first.
  pause
  exit /b 1
)
where node >nul 2>nul || (
  echo [ERROR] Node.js 22.12 or newer is required on this computer.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<12))process.exit(1)" || (
  echo [ERROR] Install Node.js 22.12 or newer on this computer.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:3707"
node server\index.js
if errorlevel 1 pause
