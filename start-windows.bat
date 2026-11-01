@echo off
rem Double-click to run the Phase 0 web prototype at http://localhost:8080/prototypes/b-webview/
rem Needs nothing installed: uses the PowerShell that ships with Windows. Close this window to stop.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
pause
