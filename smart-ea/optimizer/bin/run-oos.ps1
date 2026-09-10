# ทดสอบชุดค่าหนึ่งบน 3 ปีที่ไม่เคยใช้จูน (มิ.ย. 2022 ถึง มิ.ย. 2025)
#
# ตามกฎโปรเจกต์: ชุดที่ชนะบนปีที่ใช้จูน ห้ามสรุปว่าใช้ได้จนผ่านช่วงนี้ก่อน
# และห้ามเอาผลจากช่วงนี้กลับไปเลือกค่าต่อ ไม่งั้นก็ไม่เหลืออะไรไว้ตรวจสอบ
#
# .set ที่ส่งมาต้องเป็นค่าเดี่ยว ไม่มีช่วง (ไม่มี ||) — สคริปต์รันแบบ single pass
#
# ตัวอย่าง:
#   .\run-oos.ps1 -SetName RF_Best_M15 -OutPrefix oos_rf -Period M15 -Expert RangeFadeEA -DumpDir rangefade_opt

param(
  [Parameter(Mandatory = $true)][string]$SetName,
  [Parameter(Mandatory = $true)][string]$OutPrefix,
  [Parameter(Mandatory = $true)][string]$Period,
  [string]$Expert = 'MARibbonEA',
  [string]$DumpDir = 'ribbon_opt',
  [string]$Model = '1'   # ส่งต่อให้ run-opt.ps1 — ต้องตรงกับโมเดลที่ใช้ตอนจูนถึงเทียบกันได้
)

$ErrorActionPreference = 'Stop'

$setPath = Join-Path (Split-Path -Parent $PSScriptRoot) "sets\$SetName.set"
if (Select-String -Path $setPath -Pattern '\|\|' -Quiet) {
  throw "$SetName.set มีช่วงค่า (||) อยู่ — รอบตรวจสอบต้องเป็นค่าเดี่ยวชุดเดียว"
}

$years = @(
  @{ n = 'y1'; from = '2022.06.01'; to = '2023.06.01' }
  @{ n = 'y2'; from = '2023.06.01'; to = '2024.06.01' }
  @{ n = 'y3'; from = '2024.06.01'; to = '2025.06.01' }
)

foreach ($y in $years) {
  & (Join-Path $PSScriptRoot 'run-opt.ps1') -Period $Period -SetName $SetName `
    -OutName "$($OutPrefix)_$($y.n)" -Expert $Expert -DumpDir $DumpDir `
    -Optimization 0 -From $y.from -To $y.to -Model $Model
}
