@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if "%DEVKITPRO%"=="" (
  echo ERROR: Set DEVKITPRO to your devkitPro installation.
  exit /b 2
)
if not exist "%DEVKITPRO%\libounce\switch_rules" (
  echo ERROR: %DEVKITPRO%\libounce\switch_rules not found.
  echo Build/install alula/libnx-ounce for the Ounce target first; see README.md.
  exit /b 2
)
where make >nul 2>nul || (
  echo ERROR: GNU make is required. Run from a devkitPro/MSYS2 environment.
  exit /b 2
)
if "%PORTLIBS_PATH%"=="" set "PORTLIBS_PATH=%DEVKITPRO%\portlibs"
make clean
if errorlevel 1 exit /b %ERRORLEVEL%
make
if errorlevel 1 exit /b %ERRORLEVEL%
echo NRO companion build complete: %CD%\build\BrendanNroLauncher.nro
