# iSteel: nightly read-only Excel copy of the Google Sheet "Master Data - All - For Apps" into OneDrive (Kim, 28 Nov 2026).
# The Google Sheet is the only place to edit master data; this copy is for reading, Power BI and backup.
# Runs every night from Task Scheduler (install.cmd). Needs sync-key.txt next to this file (PM_SYNC_KEY).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$folder = Join-Path $env:USERPROFILE 'OneDrive - ISI GROUP\01. ISI STEEL-WH&LOG\00. Data Warehouse\Master Data (All)'
$url = 'https://script.google.com/macros/s/AKfycbyMaGBBMaMfGmb0FWnEMc-RK9mCochRZ45S_wcM2RUiZDXaptE0VW1KJHGFQgm1M_H-/exec'
$log = Join-Path $here 'sync-log.txt'
function Log($m) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm}  {1}" -f (Get-Date), $m) -Encoding UTF8 }
try {
  $key = (Get-Content (Join-Path $here 'sync-key.txt') -Raw).Trim()
  if (-not (Test-Path $folder)) { throw "Folder not found: $folder" }
  $body = @{ action = 'mdBackup'; key = $key } | ConvertTo-Json -Compress
  $res = Invoke-RestMethod -Uri $url -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'text/plain; charset=utf-8' -TimeoutSec 300
  if (-not $res.ok) { throw "App said: $($res.error)" }
  $bytes = [Convert]::FromBase64String($res.data.b64)
  if ($bytes.Length -lt 1000) { throw 'Copy too small; nothing changed.' }
  $out = Join-Path $folder $res.data.name
  if (Test-Path $out) { (Get-Item $out).IsReadOnly = $false }
  [IO.File]::WriteAllBytes($out, $bytes)
  (Get-Item $out).IsReadOnly = $true   # read-only: edit the Google Sheet, not this copy
  Log ("OK  master data copy saved ({0:N0} KB)" -f ($bytes.Length / 1KB))
} catch { Log "ERROR  master data copy: $($_.Exception.Message)"; exit 1 }
