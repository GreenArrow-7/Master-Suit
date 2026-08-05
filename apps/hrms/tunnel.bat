@echo off
REM Cloudflare Tunnel launcher - double-click or run: tunnel.bat
REM
REM Batch files bypass PowerShell's execution policy, so this works on a
REM stock machine where .\scripts\tunnel.ps1 is blocked as "not digitally
REM signed". Start the HRMS first (run.bat), then run this in a second window.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tunnel.ps1" %*
pause
