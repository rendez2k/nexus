@echo off
REM One-click update-and-launch for the Nexus tray.
REM Make a Desktop shortcut to this file rather than copying it - the script it
REM calls lives beside it.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0nexus-tray.ps1" %*
REM Keep the window open only when something went wrong, so the error is readable.
if errorlevel 1 pause
