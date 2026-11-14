echo off
cls
echo Open SmileBasic 4 on Nintendo Switch 2 (un-modded), create a new project, switch to the new project, enter project editor, switch to Editor mode (X), and do a save as whatever filename (- then Simple Save).
pause
echo Open nxhid on modded Nintendo Switch 1 as app (Hold R booting a Game, choose nxhid from homebrew launcher), and plug the data type C-to-C cable into both Nintendo Switchs.
pause
Set /P IPSWITCH="Enter the displayed IP:"
Set /P FILE="Enter file path to send:"
python client\nxhid.py %IPSWITCH% text --file %FILE%
pause
