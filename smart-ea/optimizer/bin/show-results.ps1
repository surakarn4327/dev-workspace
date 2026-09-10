# อ่านไฟล์ผลใน results\ แล้วแสดงเป็นตารางที่มีหัวคอลัมน์ เรียงตามคะแนน
#
# ไฟล์ผลไม่มีหัวคอลัมน์ (DumpPass() เขียนแต่ตัวเลข) จำลำดับด้วยตาไม่ได้
# สคริปต์นี้จึงเป็นที่เดียวที่นิยามชื่อคอลัมน์ไว้ แก้ DumpPass() แล้วต้องแก้ที่นี่ด้วย
#
# กลยุทธ์ต่างกันมีคอลัมน์พารามิเตอร์ต่างกัน แต่ 17 ช่องท้าย (ตัวชี้วัด) เหมือนกัน
# เพราะมาจาก MetricsCsvTail() ตัวเดียวกัน — เลือกผังด้วย -Layout หรือให้เดาจาก
# จำนวนช่องก็ได้
#
# ตัวอย่าง:
#   .\show-results.ps1 -OutName rf1_M15 -Top 15
#   .\show-results.ps1 -OutName rf1_M15 -All | Where-Object winrate -ge 0.5

param(
  [Parameter(Mandatory = $true)][string]$OutName,
  [int]$Top = 20,
  [ValidateSet('auto', 'ribbon', 'rangefade')][string]$Layout = 'auto',
  [switch]$All,          # คืนทุกแถวเป็นออบเจกต์ ไม่จัดตาราง (เอาไปกรองต่อเอง)
  [switch]$Raw           # ไม่กรองแถวคะแนน 0 ออก
)

$ErrorActionPreference = 'Stop'

$tail = @(
  'deposit', 'trades', 'profit', 'dd', 'pf', 'payoff',
  'winrate', 'months', 'posMonths', 'posPct', 'worstMonth', 'medianMonth',
  'shareNet', 'shareGross', 'holdH', 'maxLossStreak', 'score'
)
$layouts = @{
  ribbon    = @('symbol', 'tf', 'atrSL', 'atrMult', 'tpMode', 'rr1', 'rr2', 'rr3', 'be',
                'shift', 'ma', 'swing', 'closeOpp', 'beLock') + $tail
  rangefade = @('symbol', 'tf', 'bandPeriod', 'bandDev', 'zEntry', 'tpMode', 'tpMult',
                'slMult', 'maxBars', 'trendMode', 'trendPeriod', 'useRSI', 'rsiLow',
                'rsiHigh', 'needTurn', 'cooldown') + $tail
}
$shown = @{
  ribbon    = @('atrSL', 'atrMult', 'tpMode', 'rr1', 'rr3', 'be', 'beLock', 'shift', 'ma', 'swing', 'closeOpp')
  rangefade = @('bandPeriod', 'zEntry', 'tpMode', 'tpMult', 'slMult', 'maxBars', 'trendMode', 'useRSI', 'needTurn', 'cooldown')
}

$path = Join-Path (Split-Path -Parent $PSScriptRoot) "results\$OutName.csv"
if (-not (Test-Path $path)) { throw "ไม่พบ $path" }
$lines = @(Get-Content $path | Where-Object { $_.Trim() })
if (-not $lines) { throw "$path ว่างเปล่า" }

if ($Layout -eq 'auto') {
  $n = ($lines[0] -split ';').Count
  $Layout = ($layouts.Keys | Where-Object { $layouts[$_].Count -eq $n } | Select-Object -First 1)
  if (-not $Layout) { throw "แถวมี $n ช่อง ไม่ตรงกับผังไหนเลย — ส่ง -Layout มาเอง" }
}
$cols = $layouts[$Layout]

$rows = foreach ($line in $lines) {
  $f = $line -split ';'
  if ($f.Count -ne $cols.Count) { Write-Warning "แถวมี $($f.Count) ช่อง ไม่ใช่ $($cols.Count) — ข้าม"; continue }
  $o = [ordered]@{}
  for ($i = 0; $i -lt $cols.Count; $i++) {
    $v = $f[$i]
    $num = 0.0
    $o[$cols[$i]] = if ([double]::TryParse($v, [ref]$num)) { $num } else { $v }
  }
  [pscustomobject]$o
}

if (-not $Raw) { $rows = $rows | Where-Object { $_.score -gt 0 } }
$rows = $rows | Sort-Object score -Descending
if ($All) { return $rows }

$rows | Select-Object -First $Top |
  Format-Table (@('score', 'trades', 'profit', 'dd', 'pf', 'winrate', 'posMonths', 'months',
                  'shareNet', 'worstMonth', 'medianMonth', 'holdH') + $shown[$Layout]) -AutoSize
