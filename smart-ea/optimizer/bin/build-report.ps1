# รวมไฟล์ผลใน results\ เป็น JSON ก้อนเดียว แล้วฝังลงในหน้าเว็บสรุปผล
#
# เหตุผลที่ต้องมีสคริปต์: ผลมีหลักพันแถว ถ้าให้ Claude ก๊อปตัวเลขเองจะทั้งช้าและพลาดได้
# สคริปต์นี้อ่านจากไฟล์ผลตรงๆ หน้าเว็บจึงตรงกับข้อมูลจริงเสมอ
#
# วิธีใช้: แก้เทมเพลตที่มี /*__DATA__*/ อยู่ แล้วสั่ง
#   .\build-report.ps1 -Template ..\..\report\template.html -Out ..\..\report\report.html

param(
  [Parameter(Mandatory = $true)][string]$Template,
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'
$results = Join-Path (Split-Path -Parent $PSScriptRoot) 'results'

# ชุดข้อมูลที่จะให้ไล่ดูได้ในหน้าเว็บ — แต่ละชุดต้องบอกช่วงเวลาที่ใช้รันด้วยเสมอ
# เพราะตัวเลขจากคนละช่วงเทียบกันตรงๆ ไม่ได้
$SETS = @(
  @{ id='wide';   name='M15 · SL กว้าง + แบ่งปิด'; win='จูน · ม.ค.–ธ.ค. 2568'
     files=@('copy_partial_tune','lowtp1_M15_tune') }
  @{ id='ribbon'; name='M15 · จูน ribbon';        win='จูน · ม.ค.–ธ.ค. 2568'
     files=@('ribbon2_M15_tune','ribbon3_M15_tune') }
  @{ id='trail';  name='M15 · trailing stop';      win='จูน · ม.ค.–ธ.ค. 2568'
     files=@('trail_M15_tune','trailearly_M15_tune') }
  @{ id='m5';     name='M5 · SL กว้าง';            win='จูน · ม.ค.–ธ.ค. 2568'
     files=@('copy_partial_M5_tune','lowtp1_M5_tune','ribbon2_M5_tune') }
  @{ id='slow';   name='H1 / H4';                  win='ปีที่จูน + 3 ปีก่อนหน้า'
     files=@('consistH_H1_tune','consistH_H1_old3y','consistH_H4_tune','consistH_H4_old3y') }
  @{ id='lowtp';  name='M15 · TP ต่ำ (รอบแรก)';   win='จูน · ก.ย. 2568–ก.ย. 2569'
     files=@('consistA_M15','consistB_M15','consistA_M5') }
  @{ id='oos';    name='ตรวจสอบนอกช่วงจูน';        win='ม.ค.–ก.ย. 2569 · tick จริง'
     files=@('val_A_oos','val_B_oos','val_C_oos','val_D_oos','val_E_oos','val_F_oos','val_G_oos','val_H_oos') }
)

# เขียนใส่ลิสต์ที่ส่งเข้ามาโดยตรง ไม่ return ออกไป — ถ้า return ลิสต์ที่มีแถวเดียว
# PowerShell จะแตกแถวนั้นออกเป็นช่องๆ แล้วนับได้ 22 แถวแทนที่จะเป็น 1
# (เจอจริง 2026-09-11: tab ตรวจสอบขึ้น 154 แถวทั้งที่มีไฟล์ละ 1 แถว 7 ไฟล์)
function Add-Rows([string]$name, $target) {
  $p = Join-Path $results "$name.csv"
  if (-not (Test-Path $p)) { Write-Warning "ข้าม $name — ไม่มีไฟล์"; return }
  foreach ($line in (Get-Content $p)) {
    if (-not $line.Trim()) { continue }
    $f = ($line -replace "^﻿", '') -split ';'
    # 31 ช่อง = ผังก่อนเพิ่ม trailing, 33 ช่อง = หลังเพิ่ม — ช่องท้าย 17 ช่องเหมือนกัน
    if ($f.Count -eq 31)      { $tr = 0;                     $t = 14 }
    elseif ($f.Count -eq 33)  { $tr = [double]$f[14];        $t = 16 }
    else { continue }
    $tf = $f[1]
    $row = @(
      [int]$f[2], [double]$f[3], [int]$f[4],                  # atrSL, atrMult, tpMode
      [double]$f[5], [double]$f[6], [double]$f[7],            # rr1, rr2, rr3
      [int]$f[8], [int]$f[9], [int]$f[10], [int]$f[12], $tr,  # be, shift, ma, closeOpp, trail
      [int]$f[($t+1)], [math]::Round([double]$f[($t+2)], 0),  # trades, profit
      [math]::Round([double]$f[($t+3)], 0),                   # dd
      [double]$f[($t+4)],                                     # pf
      [math]::Round([double]$f[($t+6)], 4),                   # winrate
      [int]$f[($t+8)], [int]$f[($t+7)],                       # posMonths, months
      [math]::Round([double]$f[($t+12)], 4),                  # shareNet
      [math]::Round([double]$f[($t+14)], 1),                  # holdH
      [math]::Round([double]$f[($t+16)], 3)                   # score
    )
    [void]$target.Add(@($tf) + $row)
  }
}

$payload = foreach ($s in $SETS) {
  $rows = New-Object System.Collections.ArrayList
  foreach ($f in $s.files) { Add-Rows $f $rows }
  Write-Host ("{0,-34} {1,5} แถว" -f $s.name, $rows.Count)
  [pscustomobject]@{ id = $s.id; name = $s.name; win = $s.win; rows = $rows }
}

$json = $payload | ConvertTo-Json -Depth 5 -Compress
$html = [System.IO.File]::ReadAllText($Template)
if ($html -notmatch [regex]::Escape('/*__DATA__*/')) { throw "เทมเพลตไม่มี /*__DATA__*/" }
$html = $html.Replace('/*__DATA__*/', $json)
[System.IO.File]::WriteAllText($Out, $html, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("เขียน {0} — {1:N0} KB" -f $Out, ((Get-Item $Out).Length / 1KB)) -ForegroundColor Green
