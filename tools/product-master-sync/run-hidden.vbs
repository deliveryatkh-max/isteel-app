' Starts the Product Master sync without a window (used by Task Scheduler).
Set sh = CreateObject("WScript.Shell")
ps = Replace(WScript.ScriptFullName, "run-hidden.vbs", "sync-product-master.ps1")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps & """", 0, False
