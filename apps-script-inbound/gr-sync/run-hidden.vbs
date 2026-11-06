' Starts gr-sync.ps1 without opening a window (used by the "iSteel GR auto-save" scheduled task).
Set sh = CreateObject("WScript.Shell")
d = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & d & "\gr-sync.ps1""", 0, False
