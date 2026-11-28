@echo off
rem iSteel Stock Count: install the hourly Product Master sync (Kim, 20 Nov 2026). Double-click once.
rem The files are copied to %LOCALAPPDATA%\iSteel\Product Master Sync and the task runs from there:
rem a folder name with "&" (01. ISI STEEL-WH&LOG) broke the scheduled task (Windows Script Host error, 23 Nov 2026).
setlocal
set "SRC=%~dp0"
set "DST=%LOCALAPPDATA%\iSteel\Product Master Sync"
if not exist "%SRC%sync-key.txt" if not exist "%DST%\sync-key.txt" (echo sync-key.txt is missing. & pause & exit /b 1)
if not exist "%DST%" mkdir "%DST%"
copy /y "%SRC%sync-product-master.ps1" "%DST%\sync-product-master.ps1" >nul
copy /y "%SRC%run-hidden.vbs" "%DST%\run-hidden.vbs" >nul
copy /y "%SRC%backup-master-data.ps1" "%DST%\backup-master-data.ps1" >nul
copy /y "%SRC%run-backup-hidden.vbs" "%DST%\run-backup-hidden.vbs" >nul
if exist "%SRC%sync-key.txt" copy /y "%SRC%sync-key.txt" "%DST%\sync-key.txt" >nul
schtasks /Create /TN "iSteel Product Master Sync" /SC HOURLY /TR "wscript.exe \"%DST%\run-hidden.vbs\"" /F
rem Nightly read-only Excel copy of the master Google Sheet into OneDrive Master Data (All) (Kim, 28 Nov 2026).
schtasks /Create /TN "iSteel Master Data Backup" /SC DAILY /ST 23:00 /TR "wscript.exe \"%DST%\run-backup-hidden.vbs\"" /F
echo Sending the Product Master now...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DST%\sync-product-master.ps1" -force
echo Saving the master data copy to OneDrive now...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DST%\backup-master-data.ps1"
echo.
if exist "%DST%\sync-log.txt" type "%DST%\sync-log.txt"
echo.
pause
