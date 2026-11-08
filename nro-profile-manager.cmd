@echo off
setlocal
cd /d "%~dp0"
node tools\nro-profile-manager.cjs %*
