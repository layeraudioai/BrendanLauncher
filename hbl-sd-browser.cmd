@echo off
setlocal
if defined HBL_NODE (
  "%HBL_NODE%" "%~dp0host\sd-browser.cjs" %*
) else (
  node "%~dp0host\sd-browser.cjs" %*
)
