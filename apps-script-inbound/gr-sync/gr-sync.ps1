# iSteel Inbound: saves the Goods Receipt Report PDFs into OneDrive (Kim, 5 Nov 2026).
# Runs every 10 minutes from Windows Task Scheduler ("iSteel GR auto-save", made by "Install GR auto-save.cmd").
# It asks the Inbound Apps Script for PDFs made since the last run and saves them as
#   <root>\Goods Receipt Report YYYY\GR YYYY-MM\GR YYYY-MM <PO> <GR no.> <Supplier>.pdf
# Settings: gr-sync.json next to this file (url, key, root). Progress: state.json. Log: log.txt.
# -Setup (from the installer): asks once for the key that grSyncKey() shows in the Apps Script log.
param([switch]$Setup)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $dir 'log.txt'
function Log($m) {
  Add-Content -Path $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $m)
  $lines = @(Get-Content $log)
  if ($lines.Count -gt 300) { $lines[-200..-1] | Set-Content $log }
}
# only one copy at a time
$mutex = New-Object System.Threading.Mutex($false, 'iSteelGRAutoSave')
if (-not $mutex.WaitOne(0)) { exit 0 }
try {
  $cfgFile = Join-Path $dir 'gr-sync.json'
  $cfg = Get-Content $cfgFile -Raw | ConvertFrom-Json
  if (-not $cfg.key) {
    if (-not $Setup) { throw 'No key yet: run Install GR auto-save.cmd again.' }
    $k = ''
    while ($k -notmatch '^gr-[0-9a-f]{42}$') {
      $k = (Read-Host 'Paste the GR key from the Apps Script log (starts with gr-)').Trim()
      if ($k -notmatch '^gr-[0-9a-f]{42}$') { Write-Host 'That is not the key. It looks like gr- followed by 42 letters and digits.' }
    }
    $cfg | Add-Member -NotePropertyName key -NotePropertyValue $k -Force
    $cfg | ConvertTo-Json | Set-Content $cfgFile
  }
  $stateFile = Join-Path $dir 'state.json'
  $since = ''
  if (Test-Path $stateFile) { $since = [string](Get-Content $stateFile -Raw | ConvertFrom-Json).since }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  if ([Net.WebRequest]::DefaultWebProxy) { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials }
  $saved = 0
  for ($round = 0; $round -lt 60; $round++) {
    $u = $cfg.url + '?action=grSync&key=' + [uri]::EscapeDataString($cfg.key) + '&since=' + [uri]::EscapeDataString($since)
    $r = Invoke-RestMethod -Uri $u -Method Get -UseBasicParsing -TimeoutSec 180
    if (-not $r.ok) { throw ('Server: ' + $r.error) }
    foreach ($f in $r.data.files) {
      # the server's folder and file name are checked before anything is written
      if ($f.path -notmatch '^Goods Receipt Report \d{4}\\GR \d{4}-\d{2}$' -or $f.name -notmatch '^[^\\/:*?"<>|]+\.pdf$' -or $f.name -match '\.\.') {
        Log ('Skipped a file with an unexpected name: ' + $f.path + ' / ' + $f.name)
      } elseif ($f.b64) {
        $folder = Join-Path $cfg.root $f.path
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        [IO.File]::WriteAllBytes((Join-Path $folder $f.name), [Convert]::FromBase64String($f.b64))
        if ($f.replaces -and $f.replaces -match '^Goods Receipt Report \d{4}\\GR \d{4}-\d{2}\\[^\\/:*?"<>|]+\.pdf$' -and $f.replaces -notmatch '\.\.') {
          $old = Join-Path $cfg.root $f.replaces
          if ((Test-Path -LiteralPath $old) -and ($old -ne (Join-Path $folder $f.name))) { Remove-Item -LiteralPath $old -Force }
        }
        $saved++
      }
      $since = [string]$f.exported
      @{ since = $since } | ConvertTo-Json | Set-Content $stateFile
    }
    if (-not $r.data.more) { break }
  }
  if ($saved) { Log ("Saved $saved PDF") }
} catch {
  Log ('Error: ' + $_.Exception.Message)
  if ($Setup) { Write-Host ('Problem: ' + $_.Exception.Message) }
} finally {
  $mutex.ReleaseMutex()
}
