@echo off
rem Wire-Up: double-click to start the local dev server and open it in Chrome.
cd /d "%~dp0"
title Wire-Up (close this window to stop)

if not exist node_modules (
  echo Installing dependencies...
  call npm install || (pause & exit /b 1)
)

rem --open launches the default browser; try Chrome explicitly first.
start "" /b cmd /c "timeout /t 3 /nobreak >nul & (start chrome http://localhost:5173/ 2>nul || start http://localhost:5173/)"

call npm run dev -- --port 5173 --strictPort
pause
