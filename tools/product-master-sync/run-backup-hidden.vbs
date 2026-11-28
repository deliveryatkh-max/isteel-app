' Starts the nightly master data copy without a window (used by Task Scheduler).
Set sh = CreateObject("WScript.Shell")
ps = Replace(WScript.ScriptFullName, "run-backup-hidden.vbs", "backup-master-data.ps1")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps & """", 0, False
