@echo off
REM Manath Homes HRMS - double-click launcher for Windows.
REM
REM Batch files aren't subject to PowerShell's execution policy, so this works
REM on a fresh machine where run.ps1 is blocked as "not digitally signed".
REM
REM   run.bat            first run: installs everything, seeds, starts server
REM
REM Use THIS, not run.ps1: PowerShell blocks unsigned scripts by default with
REM "cannot be loaded ... is not digitally signed". Batch files are exempt.
REM   run.bat -Test      run the test suite
REM   run.bat -Models    re-download the face recognition models (~275 MB)
REM   run.bat -SkipSetup start faster once installed

setlocal
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo PowerShell was not found on this system.
  echo Run the manual commands in README.md instead.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% neq 0 (
  echo.
  echo Startup failed with code %EXITCODE%. Scroll up for the reason.
)
pause
exit /b %EXITCODE%
