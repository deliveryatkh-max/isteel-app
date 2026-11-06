@echo off
rem iSteel Inbound: double-click once. Every 10 minutes Windows saves new Goods Receipt Report PDFs into the
rem "Goods Receipt Report" OneDrive folder. No admin rights needed. Undo: "Remove GR auto-save.cmd".
setlocal
set "SRC=%~dp0"
set "DST=%LOCALAPPDATA%\iSteel\GR Sync"
if not exist "%DST%" mkdir "%DST%"
copy /y "%SRC%gr-sync.ps1" "%DST%\gr-sync.ps1" >nul
copy /y "%SRC%run-hidden.vbs" "%DST%\run-hidden.vbs" >nul
if not exist "%DST%\gr-sync.json" copy /y "%SRC%gr-sync.json" "%DST%\gr-sync.json" >nul
if not exist "%DST%\gr-sync.json" (
  echo The settings file gr-sync.json is missing. Ask Claude in the iSteel project.
  pause
  exit /b 1
)
echo Step 1: paste the key, then press Enter. After that the PDFs are saved; the first time can take a few minutes.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DST%\gr-sync.ps1" -Setup
schtasks /Create /F /SC MINUTE /MO 10 /TN "iSteel GR auto-save" /TR "wscript.exe \"%DST%\run-hidden.vbs\"" >nul
if errorlevel 1 (
  echo Windows did not allow the scheduled task. Send a photo of this window to Claude.
  pause
  exit /b 1
)
echo.
echo Done. New Goods Receipt Report PDFs will now arrive every 10 minutes while this computer is on.
echo Last lines of the log:
if exist "%DST%\log.txt" powershell.exe -NoProfile -Command "Get-Content -Tail 3 -LiteralPath (Join-Path $env:LOCALAPPDATA 'iSteel\GR Sync\log.txt')"
pause
