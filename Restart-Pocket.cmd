@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Restart-Pocket.ps1"
if errorlevel 1 pause
