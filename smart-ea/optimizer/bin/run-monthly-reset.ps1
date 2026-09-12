# Run one Strategy Tester pass per calendar month, deposit reset to a fixed value each time
# (simulates withdrawing all profit at month end) - no balance carried across months.

param(
  [Parameter(Mandatory = $true)][string]$SetName,
  [Parameter(Mandatory = $true)][string]$OutPrefix,
  [Parameter(Mandatory = $true)][string]$Period,
  [Parameter(Mandatory = $true)][string]$Expert,
  [Parameter(Mandatory = $true)][string]$DumpDir,
  [string]$Symbol = 'XAUUSDc',
  [string]$Deposit = '10000',
  [string]$Model = '0',
  [datetime]$StartMonth = '2025-01-01',
  [datetime]$EndDate = (Get-Date)
)

$ErrorActionPreference = 'Stop'
$results = @()
$m = $StartMonth
while ($m -lt $EndDate) {
  $next = $m.AddMonths(1)
  $to = if ($next -lt $EndDate) { $next } else { $EndDate }
  $from = $m.ToString('yyyy.MM.dd')
  $toStr = $to.ToString('yyyy.MM.dd')
  $tag = $m.ToString('yyyy-MM')
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
  $results += [pscustomobject]@{ month = $tag; profit = [double]$netProfit; trades = [int]$trades }

  $m = $next
}

$results | Format-Table -AutoSize
$outCsv = Join-Path (Split-Path -Parent $PSScriptRoot) "results\$($OutPrefix)_summary.csv"
$results | ForEach-Object { "$($_.month);$($_.profit);$($_.trades)" } | Set-Content $outCsv -Encoding UTF8
Write-Host "Monthly summary written to $outCsv" -ForegroundColor Green
