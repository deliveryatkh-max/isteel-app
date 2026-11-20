# iSteel Stock Count: send the Product Master Excel to the app (Kim, 20 Nov 2026).
# Reads OneDrive ...\Product Master (in use)\ISI Steel - Master Data - Product - *.xlsx, sheet "Product Master"
# (a file with "Final" in its name wins, else the newest), and posts it to the Stock Count Apps Script, which
# replaces the Product Master tab. Runs every hour from Task Scheduler (install.cmd); sends only when the file changed.
# Needs: Excel on this PC, sync-key.txt next to this file (same value as the PM_SYNC_KEY script property).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$folder = Join-Path $env:USERPROFILE 'OneDrive - ISI GROUP\01. ISI STEEL-WH&LOG\00. Data Warehouse\Master Data (All)\Product Master\Product Master (in use)'
$url = 'https://script.google.com/macros/s/AKfycbyMaGBBMaMfGmb0FWnEMc-RK9mCochRZ45S_wcM2RUiZDXaptE0VW1KJHGFQgm1M_H-/exec'
$log = Join-Path $here 'sync-log.txt'
function Log($m) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm}  {1}" -f (Get-Date), $m) -Encoding UTF8 }
$xl = $null; $wb = $null
try {
  $key = (Get-Content (Join-Path $here 'sync-key.txt') -Raw).Trim()
  $files = @(Get-ChildItem $folder -Filter '*Master Data - Product*.xlsx' | Where-Object { $_.Name -notlike '~$*' })
  $final = @($files | Where-Object { $_.BaseName -match 'Final' })
  $pool = if ($final.Count) { $final } else { $files }
  $file = $pool | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $file) { throw "No Product Master file in $folder" }
  $stamp = Join-Path $here 'last-sync.txt'
  $sig = "$($file.FullName)|$($file.LastWriteTimeUtc.Ticks)"
  if ((Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $sig) -and -not ($args -contains '-force')) { exit 0 }
  $tmp = Join-Path $env:TEMP ('pm-' + [guid]::NewGuid().ToString() + '.xlsx')
  Copy-Item $file.FullName $tmp   # a copy, so it works while the file is open in Excel
  try {
    $xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
    $wb = $xl.Workbooks.Open($tmp, 0, $true)
    $v = $wb.Worksheets.Item('Product Master').UsedRange.Value2
  } finally {
    if ($wb) { $wb.Close($false) }
    if ($xl) { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
  $nr = $v.GetLength(0); $nc = $v.GetLength(1); $hr = 0
  for ($r = 1; $r -le [Math]::Min(15, $nr) -and -not $hr; $r++) { for ($c = 1; $c -le $nc; $c++) { if ("$($v[$r, $c])".Trim() -eq 'Material Code') { $hr = $r } } }
  if (-not $hr) { throw 'Header "Material Code" not found in sheet Product Master' }
  # Every column with a header is sent (Kim, 20 Nov: the Product menu shows them all); $head keeps the Excel order.
  $cols = @{}; $head = New-Object System.Collections.ArrayList
  for ($c = 1; $c -le $nc; $c++) { $h = "$($v[$hr, $c])".Trim(); if ($h -and -not $cols.ContainsKey($h)) { $cols[$h] = $c; [void]$head.Add($h) } }
  $inv = [Globalization.CultureInfo]::InvariantCulture
  $rows = New-Object System.Collections.ArrayList
  for ($r = $hr + 1; $r -le $nr; $r++) {
    $cv = $v[$r, $cols['Material Code']]
    if ($cv -is [double]) { $code = ([decimal]$cv).ToString($inv) } else { $code = "$cv".Trim() }
    if (-not $code) { continue }
    $o = @{}
    foreach ($h in $cols.Keys) { $x = $v[$r, $cols[$h]]; if ($x -is [double]) { $o[$h] = ([decimal]$x).ToString($inv) } else { $o[$h] = "$x".Trim() } }
    [void]$rows.Add($o)
  }
  $body = @{ action = 'pmSync'; key = $key; file = $file.Name; head = $head; rows = $rows } | ConvertTo-Json -Depth 4 -Compress
  $res = Invoke-RestMethod -Uri $url -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'text/plain; charset=utf-8'
  if (-not $res.ok) { throw "App said: $($res.error)" }
  Set-Content $stamp $sig -Encoding UTF8
  Log "OK  sent $($res.data.rows) materials from $($file.Name)"
} catch { Log "ERROR  $($_.Exception.Message)"; exit 1 }
