@echo off
:: Set English to avoid ANY Windows CMD encoding bugs
title Celestial Archive - Launcher
cd /d "%~dp0"

if exist "node_modules" goto skip_base
echo [1/3] Installing base dependencies...
call npm install
:skip_base

if exist "node_modules\https-proxy-agent" goto skip_proxy
echo [2/3] Installing proxy agent...
call npm install https-proxy-agent
:skip_proxy

:: Install node-fetch to replace the unstable native fetch
if exist "node_modules\node-fetch" goto skip_fetch
echo [3/3] Installing stable fetch engine...
call npm install node-fetch@2
:skip_fetch

echo.
echo ==========================================
echo    Starting Celestial Archive...
if defined IMAGE_PROXY_URL (
  echo    Image proxy: %IMAGE_PROXY_URL%
) else (
  echo    Image proxy: disabled
  echo    Tip: set IMAGE_PROXY_URL=http://127.0.0.1:7897 to use a local proxy.
)
echo ==========================================
echo.
echo Please DO NOT close this window.
echo Waking up browser...
echo.

set NODE_OPTIONS=--max-old-space-size=8192
call npm run dev -- --open
if errorlevel 1 (
  echo.
  echo [ERROR] Dev server exited with an error. See messages above.
  echo.
)
pause
