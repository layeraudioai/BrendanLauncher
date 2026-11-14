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