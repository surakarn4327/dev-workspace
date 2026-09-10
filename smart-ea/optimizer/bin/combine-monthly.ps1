# รวมกำไรรายเดือนของหลาย EA เข้าเป็นพอร์ตเดียว แล้วดูว่านิ่งขึ้นไหม
#
# ทำไมต้องดู: EA ตัวเดียวที่ขาดทุนสูงสุดกินกำไรหลายเดือน อาจถอนรายเดือนไม่ได้
# แต่ถ้ารวมกับอีกตัวที่ขาดทุนคนละจังหวะ เดือนที่ติดลบจะหักกลบกัน กำไรรวมเท่าเดิม
# แต่เดือนที่ติดลบน้อยลง — เป็นทางเดียวที่ทำให้ถอนได้สม่ำเสมอโดยไม่ต้องมี edge ดีขึ้น
#
# กินไฟล์ที่ run-opt.ps1 เก็บไว้เป็น results\<ชื่อ>_monthly.csv (รูปแบบ ปี-เดือน;กำไร;ไม้)
#
# ตัวอย่าง:
#   .\combine-monthly.ps1 -Names rf_base_tune, ribbonA_tune

param(
  [Parameter(Mandatory = $true)][string[]]$Names
)

$ErrorActionPreference = 'Stop'
$dir = Join-Path (Split-Path -Parent $PSScriptRoot) 'results'

$perMonth = [ordered]@{}
$each = [ordered]@{}

foreach ($n in $Names) {
  $p = Join-Path $dir "$($n)_monthly.csv"
  if (-not (Test-Path $p)) { throw "ไม่พบ $p" }
  $each[$n] = @{}
  foreach ($line in (Get-Content $p | Where-Object { $_.Trim() })) {
    $f = $line -split ';'
    $m = $f[0]; $v = [double]$f[1]
    $each[$n][$m] = $v
    if (-not $perMonth.Contains($m)) { $perMonth[$m] = 0.0 }
    $perMonth[$m] += $v
  }
}

$months = $perMonth.Keys | Sort-Object

$rows = foreach ($m in $months) {
  $o = [ordered]@{ month = $m }
  foreach ($n in $Names) { $o[$n] = [math]::Round(($each[$n][$m]), 2) }
  $o['รวม'] = [math]::Round($perMonth[$m], 2)
  [pscustomobject]$o
}
$rows | Format-Table -AutoSize

function Stat([double[]]$v, [string]$label) {
  if (-not $v) { return }
  $sum = ($v | Measure-Object -Sum).Sum
  $pos = ($v | Where-Object { $_ -gt 0 }).Count
  # ขาดทุนสูงสุดคิดจากยอดสะสมรายเดือน ไม่ใช่ระหว่างเดือน — เป็นตัวเลขที่ตรงกับ
  # การถอนเงินรายเดือนมากกว่า equity drawdown ที่ MT5 รายงาน
  $run = 0.0; $peak = 0.0; $dd = 0.0
  foreach ($x in $v) { $run += $x; if ($run -gt $peak) { $peak = $run }; if (($peak - $run) -gt $dd) { $dd = $peak - $run } }
  $avg = $sum / $v.Count
  "{0,-14} กำไรรวม {1,10:N2}  เดือนที่กำไร {2,2}/{3,-2}  เดือนแย่สุด {4,9:N2}  DD รายเดือน {5,9:N2}  = กำไร {6,5:N1} เดือน" -f `
    $label, $sum, $pos, $v.Count, ($v | Measure-Object -Minimum).Minimum, $dd, ($(if ($avg -gt 0) { $dd / $avg } else { [double]::NaN }))
}

''
foreach ($n in $Names) { Stat ([double[]]($months | ForEach-Object { $each[$n][$_] })) $n }
Stat ([double[]]($months | ForEach-Object { $perMonth[$_] })) 'พอร์ตรวม'
