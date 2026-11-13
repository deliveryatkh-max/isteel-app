@echo off
rem Stops the iSteel GR auto-save on this computer. The PDFs already saved stay where they are.
schtasks /Delete /F /TN "iSteel GR auto-save" >nul 2>nul
rmdir /s /q "%LOCALAPPDATA%\iSteel\GR Sync" 2>nul
echo GR auto-save is switched off on this computer.
pause
