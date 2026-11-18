@echo off
cls
echo ==========================================================
echo  BrendanLauncher - Unified Switch 2 Hybrid Launcher
echo  IZLauncher, HBLauncher, and SPHAIRA Architecture Suite
echo ==========================================================
echo.
echo Open SmileBasic 4 on Nintendo Switch 2, type the following into DIRECT mode with your ns2jb project loaded:
echo   " LOAD "TXT:NS2" "
echo   " RUN "
echo   " REMOVE NSR,&60000000,&30000000 "
echo.
echo ==========================================================
echo Network Configuration:
ipconfig
echo ==========================================================
echo.

rem ---------------------------------------------------------------------------
rem  Session question.
rem  Y = install/start everything Moonlight needs (Sunshine host + the GPU app
rem      package) before the launcher server comes up.
rem  N = plain launcher session, nothing is downloaded.
rem ---------------------------------------------------------------------------
set "MOONLIGHT=0"
set "ANSWER="
set /p "ANSWER=Will you be using Moonlight this session? [y/N]: "
if /i "!ANSWER!"=="y" set "MOONLIGHT=1"
if /i "!ANSWER!"=="yes" set "MOONLIGHT=1"
echo.


rem ---------------------------------------------------------------------------
rem  Node.js is the only hard prerequisite for the launcher itself.
rem ---------------------------------------------------------------------------
set "NODE=node"
where node >nul 2>nul || call :InstallNode
"%NODE%" --version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is required but was not found.
  echo         Install Node.js 22 or newer from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if "!MOONLIGHT!"=="1" (
  if not defined MOONLIGHT_BACKEND set "MOONLIGHT_BACKEND=sunshine"
  if not defined MOONLIGHT_HOSTS set "MOONLIGHT_HOSTS=127.0.0.1"
  echo [MOONLIGHT] Answer was yes: preparing the stream host and the app package.
  echo [MOONLIGHT] The first run downloads Sunshine and the app; later runs only probe.
  echo.
  "%NODE%" "%~dp0BrendanLauncher\scripts\moonlight-setup.cjs" --auto
  if errorlevel 1 echo [MOONLIGHT] Setup reported problems - details in BrendanLauncher\data\state\moonlight-setup.json
  echo.
  echo [MOONLIGHT] Backend !MOONLIGHT_BACKEND! pointed at !MOONLIGHT_HOSTS!
  echo [MOONLIGHT] On the console: press A on the host row, then type the PIN into
  echo [MOONLIGHT] Sunshine at https://127.0.0.1:47990 (opening that page now).
  start "" "https://127.0.0.1:47990"
  echo.
) else (
  echo [SKIP] Moonlight setup skipped for this session.
  echo.
)


set IPPC=%1%
if "%IPPC%"=="" (
    set /p IPPC="Enter the displayed PC IP (leave blank to auto-detect): "
)
set PIN=%2%
if "%PIN%"=="" (
    for /f "usebackq" %%p in (`powershell -NoProfile -Command "$sec = Read-Host -Prompt 'PIN' -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))"`) do set PIN=%%p
    echo PIN entered: ****
)

echo.
echo [SETUP] Building and publishing BrendanLauncher modules (.izm packages)...
node -e "const {publish} = require('./BrendanLauncher/sdk/publish-modules.cjs'); publish('./BrendanLauncher').then(r => console.log('[OK] Published modules:', r.updated)).catch(console.error);"

echo.
echo Starting BrendanLauncher server...

:STARTBL
if "%PIN%"=="" (
    if "%IPPC%"=="" (
        node BrendanLauncher\server.cjs
    ) else (
        node BrendanLauncher\server.cjs %IPPC%
    )
) else (
    if "%IPPC%"=="" (
        node BrendanLauncher\server.cjs --pin "%PIN%"
    ) else (
        node BrendanLauncher\server.cjs %IPPC% --pin "%PIN%"
    )
)
goto :STARTBL
EXIT