@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies ^(first run^)...
  call npm ci
  if errorlevel 1 goto failed
)
rem Rebuild every start so updated sources reach the browser after an extension reload.
echo Building the extension...
call npm run build
if errorlevel 1 goto failed
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Could not start. See the error above; check that port 4318 is free and the configuration is valid.
pause
