# อ่านไฟล์ผลใน results\ แล้วแสดงเป็นตารางที่มีหัวคอลัมน์ เรียงตามคะแนน
#
# ไฟล์ผลไม่มีหัวคอลัมน์ (DumpPass() เขียนแต่ตัวเลข) จำลำดับ 31 ช่องด้วยตาไม่ได้
# สคริปต์นี้จึงเป็นที่เดียวที่นิยามชื่อคอลัมน์ไว้ แก้ DumpPass() แล้วต้องแก้ที่นี่ด้วย
#
# ตัวอย่าง:
#   .\show-results.ps1 -OutName consistA_M15 -Top 15
#   .\show-results.ps1 -OutName consistA_M15 -All | Format-Table

param(
  [Parameter(Mandatory = $true)][string]$OutName,
  [int]$Top = 20,
  [switch]$All,          # คืนทุกแถวเป็นออบเจกต์ ไม่จัดตาราง (เอาไปกรองต่อเอง)
  [switch]$Raw           # ไม่กรองแถวคะแนน 0 ออก
)

$ErrorActionPreference = 'Stop'
$cols = @(
  'symbol', 'tf', 'atrSL', 'atrMult', 'tpMode', 'rr1', 'rr2', 'rr3', 'be',
  'shift', 'ma', 'swing', 'closeOpp', 'beLock', 'deposit',
  'trades', 'profit', 'dd', 'pf', 'payoff',
  'winrate', 'months', 'posMonths', 'posPct', 'worstMonth', 'medianMonth',
  'shareNet', 'shareGross', 'holdH', 'maxLossStreak', 'score'
)

$path = Join-Path (Split-Path -Parent $PSScriptRoot) "results\$OutName.csv"
if (-not (Test-Path $path)) { throw "ไม่พบ $path" }

$rows = foreach ($line in (Get-Content $path)) {
  if (-not $line.Trim()) { continue }
  $f = $line -split ';'
  if ($f.Count -ne $cols.Count) { Write-Warning "แถวมี $($f.Count) ช่อง ไม่ใช่ $($cols.Count) — ข้าม"; continue }
  $o = [ordered]@{}
  for ($i = 0; $i -lt $cols.Count; $i++) {
    $v = $f[$i]
    $n = 0.0
    $o[$cols[$i]] = if ([double]::TryParse($v, [ref]$n)) { $n } else { $v }
  }
  [pscustomobject]$o
}

if (-not $Raw) { $rows = $rows | Where-Object { $_.score -gt 0 } }
$rows = $rows | Sort-Object score -Descending
if ($All) { return $rows }

$rows | Select-Object -First $Top |
  Format-Table score, trades, profit, dd, pf, winrate, posMonths, months,
               shareNet, worstMonth, medianMonth, holdH,
               atrSL, atrMult, tpMode, rr1, rr3, be, beLock, shift, ma, swing, closeOpp -AutoSize
