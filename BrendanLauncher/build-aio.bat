@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo BrendanLauncher AIO build + server
echo Native CPU launcher/apps, GPU apps and IZ module platform assets
echo ============================================================

if not defined VULKAN_SDK (echo ERROR: Install the Vulkan SDK and set VULKAN_SDK so Vulkan headers can be found. & exit /b 1)
if not exist "%VULKAN_SDK%\Include\vulkan\vulkan.h" (echo ERROR: Vulkan headers not found under "%VULKAN_SDK%\Include". & exit /b 1)

where node >nul 2>nul || (echo ERROR: Node.js 22+ is required. & exit /b 1)
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)" || (echo ERROR: Install Node.js 22 or newer. & exit /b 1)
where bash >nul 2>nul || (echo ERROR: Install Git for Windows or MSYS2 with bash on PATH. & exit /b 1)
where python >nul 2>nul || (echo ERROR: Install Python 3 and add python.exe to PATH. & exit /b 1)
where glslangValidator >nul 2>nul || (echo ERROR: Install glslangValidator and add it to PATH. & exit /b 1)
where spirv-val >nul 2>nul || (echo ERROR: Install spirv-val and add it to PATH. & exit /b 1)

rem Prefer DevkitA64/MSYS2 tools when present; Linux cross tools also work.
where aarch64-linux-gnu-gcc >nul 2>nul
if not errorlevel 1 (
  set "CC=aarch64-linux-gnu-gcc"
  set "OBJCOPY=aarch64-linux-gnu-objcopy"
  set "NM=aarch64-linux-gnu-nm"
  set "SIZE=aarch64-linux-gnu-size"
) else (
  where aarch64-none-elf-gcc >nul 2>nul || (echo ERROR: Install the AArch64 cross-toolchain ^(DevkitA64 or aarch64-linux-gnu^) and add it to PATH. & exit /b 1)
  rem Let tools/build-aio.sh prefer the complete DevkitA64 compiler when both
  rem DevkitA64 and an incomplete MSYS2 cross-compiler are on PATH.
)

set "PYTHON=python"
set "PYTHON3=python"
set "PYTHONUTF8=1"
set "HB_AIO_BUILD=1"

echo.
echo [1/2] Building launcher, native apps, GPU apps, modules and IZ shell...
node tools/build-aio.cjs
if errorlevel 1 (
  echo.
  echo ERROR: Build failed. BrendanLauncher server was not started.
  exit /b 1
)

echo.
echo [2/2] Starting BrendanLauncher server with integrated IZ modules...
echo NOTE: bundled IZ host modules declare Linux x64/ARM64 support; native Windows may show packages but cannot run those Linux-only host services.
echo Keep this window open. Press Ctrl+C to stop the server.
echo.
cd ..
BrendanLauncher
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo BrendanLauncher server exited with code %RESULT%.
exit /b %RESULT%
