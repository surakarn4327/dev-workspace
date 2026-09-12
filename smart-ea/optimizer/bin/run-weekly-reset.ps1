# Run one Strategy Tester pass per calendar week (7-day blocks from StartDate), deposit
# reset to a fixed value each time (simulates withdrawing all profit at week end) -
# no balance carried across weeks.

param(
  [Parameter(Mandatory = $true)][string]$SetName,
  [Parameter(Mandatory = $true)][string]$OutPrefix,
  [Parameter(Mandatory = $true)][string]$Period,
  [Parameter(Mandatory = $true)][string]$Expert,
  [Parameter(Mandatory = $true)][string]$DumpDir,
  [string]$Symbol = 'XAUUSDc',
  [string]$Deposit = '10000',
  [string]$Model = '0',
  [datetime]$StartDate = '2025-01-01',
  [datetime]$EndDate = (Get-Date)
)

$ErrorActionPreference = 'Stop'
$results = @()
$w = $StartDate
$idx = 1
while ($w -lt $EndDate) {
  $next = $w.AddDays(7)
  $to = if ($next -lt $EndDate) { $next } else { $EndDate }
  $from = $w.ToString('yyyy.MM.dd')
  $toStr = $to.ToString('yyyy.MM.dd')
  $tag = "{0:D3}_{1}" -f $idx, $w.ToString('yyyy-MM-dd')
  $outName = "$($OutPrefix)_$tag"

  & (Join-Path $PSScriptRoot 'run-opt.ps1') -Period $Period -SetName $SetName `
    -OutName $outName -Expert $Expert -Symbol $Symbol -DumpDir $DumpDir `
    -Optimization 0 -From $from -To $toStr -Model $Model -Deposit $Deposit -SkipPreflight

  $csv = Join-Path (Split-Path -Parent $PSScriptRoot) "results\$outName.csv"
  $line = Get-Content $csv
  $f = $line -split ';'
  # Last 17 columns are MetricsCsvTail; net profit is at Count-15, trade count at Count-16
  $netProfit = $f[$f.Count - 15]
  $trades = $f[$f.Count - 16]
  $results += [pscustomobject]@{ week = $tag; weekStart = $w.ToString('yyyy-MM-dd'); profit = [double]$netProfit; trades = [int]$trades }

  $w = $next
  $idx++
}

$results | Format-Table -AutoSize
$outCsv = Join-Path (Split-Path -Parent $PSScriptRoot) "results\$($OutPrefix)_summary.csv"
$results | ForEach-Object { "$($_.weekStart);$($_.profit);$($_.trades)" } | Set-Content $outCsv -Encoding UTF8
Write-Host "Weekly summary written to $outCsv" -ForegroundColor Green
