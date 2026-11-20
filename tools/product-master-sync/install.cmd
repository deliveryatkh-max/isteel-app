@echo off
rem iSteel Stock Count: install the hourly Product Master sync (Kim, 20 Nov 2026). Double-click once.
cd /d "%~dp0"
if not exist sync-key.txt (echo sync-key.txt is missing. & pause & exit /b 1)
schtasks /Create /TN "iSteel Product Master Sync" /SC HOURLY /TR "wscript.exe \"%~dp0run-hidden.vbs\"" /F
echo Sending the Product Master now...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-product-master.ps1" -force
echo.
type sync-log.txt
echo.
pause
