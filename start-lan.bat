@echo off
setlocal
cd /d "%~dp0"
title Burning Chariot LAN Server

where node >nul 2>nul
if errorlevel 1 (
  echo ============================================
  echo        Burning Chariot LAN Server
  echo ============================================
  echo.
  echo Node.js was not found.
  echo Install Node.js or use BurningChariot.exe from the release folder.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws\index.js" (
  echo First run: installing the WebSocket dependency...
  call npm install --omit=dev --ignore-scripts
  if errorlevel 1 (
    echo.
    echo Dependency installation failed. Check the network and try again.
    pause
    exit /b 1
  )
)

if not "%BC_NO_BROWSER%"=="1" start "" /min powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 900; Start-Process 'http://localhost:3000'"
node "server\server.js"
set "BC_EXIT=%ERRORLEVEL%"

if not "%BC_EXIT%"=="0" (
  echo.
  echo The server stopped. See the message above.
  pause
)
exit /b %BC_EXIT%
