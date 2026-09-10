# รัน Strategy Tester ของ MT5 จากคอมมานด์ไลน์ แล้วเก็บผลทุก pass เป็น CSV
#
# ทำไมต้องมีสคริปต์นี้: ไฟล์ที่ส่งผ่าน /config: ถูก MT5 ใช้แค่บาง key
# (Expert / Symbol / Period / Optimization / ExpertParameters) ส่วนวันที่
# โมเดล tick และเกณฑ์ให้คะแนน ต้องตั้งใน GUI ครั้งเดียวก่อน (ดู README.md)
# และไฟล์ ini ต้องเป็น UTF-16 + CRLF เท่านั้น ไม่งั้น MT5 อ่านไม่ออกเงียบๆ
#
# ผลของแต่ละ pass มาจาก OnTester() ใน MARibbonEA.mq5 ที่เขียนไฟล์ลง
# <Terminal Common>\Files\ribbon_opt\ เอง — ไม่ได้พึ่งระบบรายงานของ MT5
#
# ตัวอย่าง:
#   .\run-opt.ps1 -Period M15 -SetName RibbonStage2_M15b -OutName stage2_M15b

param(
  [Parameter(Mandatory = $true)][string]$Period,     # M1 / M5 / M15 ...
  [Parameter(Mandatory = $true)][string]$SetName,    # ชื่อไฟล์ .set (ไม่ต้องใส่นามสกุล)
  [Parameter(Mandatory = $true)][string]$OutName,    # ชื่อไฟล์ผลลัพธ์ที่จะเขียนลง results\
  [string]$Symbol = 'XAUUSDm',
  [string]$Expert = 'MARibbonEA',                    # ชื่อ EA ใน MQL5\Experts (ไม่ต้องใส่ .ex5)
  [ValidateSet('0', '1', '2')][string]$Optimization = '1',  # 0=รันเดียว 1=ไล่ครบ 2=genetic
  [string]$Terminal = 'C:\Program Files\MetaTrader 5 EXNESS\terminal64.exe',
  [string]$DataDir,                                  # โฟลเดอร์ข้อมูลของ terminal (เดาให้ถ้าไม่ระบุ)
  [string]$From,                                     # yyyy.MM.dd — ไม่ระบุ = ใช้ช่วงที่ตั้งไว้ใน GUI
  [string]$To,                                       # yyyy.MM.dd
  [string]$Model = '1',                              # 0=every tick 1=1 min OHLC 2=open prices 4=real ticks
  [string]$ExecutionMode = '37',                     # หน่วง ms จำลอง slippage — 0 = ได้ราคาดีเกินจริง
  [switch]$SkipPreflight                             # ข้ามด่านตรวจค่าใน GUI
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $Terminal)) { throw "ไม่พบ terminal64.exe ที่ $Terminal — ส่ง -Terminal มาเอง" }

# หาโฟลเดอร์ข้อมูลของ terminal: ตัวที่มี MQL5\Experts\MARibbonEA.ex5 อยู่
if (-not $DataDir) {
  $DataDir = Get-ChildItem "$env:APPDATA\MetaQuotes\Terminal" -Directory |
    Where-Object { Test-Path "$($_.FullName)\MQL5\Experts\$Expert.ex5" } |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $DataDir) { throw "หาโฟลเดอร์ terminal ไม่เจอ — deploy EA ก่อน (ดู README.md)" }

$dump = "$env:APPDATA\MetaQuotes\Terminal\Common\Files\ribbon_opt"
$out  = Join-Path $root "results\$OutName.csv"

# .set ต้องอยู่ใน Profiles\Tester ของ terminal ถึงจะถูกโหลด
New-Item -ItemType Directory -Force -Path "$DataDir\MQL5\Profiles\Tester" | Out-Null
Copy-Item (Join-Path $root "sets\$SetName.set") "$DataDir\MQL5\Profiles\Tester\" -Force

# รอบก่อนหน้าอาจยังปิดตัวไม่สนิท (Start-Process -Wait คืนค่าก่อน process หายจริง)
# รอสักครู่ก่อน แล้วค่อยยอมแพ้ ไม่งั้นสั่งรันติดกันหลายรอบจะสะดุดเปล่าๆ
$waited = 0
while ((Get-Process terminal64 -ErrorAction SilentlyContinue) -and $waited -lt 30) {
  Start-Sleep -Seconds 2; $waited += 2
}
if (Get-Process terminal64 -ErrorAction SilentlyContinue) {
  throw "MT5 ยังเปิดอยู่หลังรอ $waited วินาที — ปิดเองแล้วสั่งใหม่"
}

# ด่านตรวจก่อนยิง: ช่องที่สั่งจากคอมมานด์ไลน์ไม่ได้ ต้องยังตรงกับที่ตั้งไว้ใน GUI
# เคยพลาดมาแล้ว 2026-09-10 — Modelling เด้งกลับเป็น Every tick กับ leverage เป็น 1:50
# เองโดยไม่มีใครแตะ รันไป 3 นาทีกว่าจะมีคนสังเกตเห็น ผลที่ได้เทียบกับรอบก่อนไม่ได้เลย
if (-not $SkipPreflight) {
  $ini = Get-Content "$DataDir\config\terminal.ini"
  # ตรวจวันที่จริง (unix time) ไม่ใช่ DateRange — ค่านั้นเป็นรหัสภายในที่เดาความหมายไม่ได้
  # (เคยเข้าใจว่า 0 = custom period แต่บิลด์นี้ใช้ 3 ทั้งที่หน้าจอขึ้น Custom period)
  # ตรวจเฉพาะช่องที่ ini สั่งไม่ได้ ส่วน Model กับ ExecutionMode ส่งผ่าน ini เองแล้ว
  # (MT5 รีเซ็ตสองช่องนั้นทุกครั้งที่เปิดด้วย /config แล้วเขียนค่าที่รีเซ็ตทับ config ตอนปิด
  #  เอามาตรวจจึงไม่มีประโยชน์ — บล็อกตัวเองเปล่าๆ)
  $want = @{
    Leverage = '100'         # 1:100
    OptCrit  = '6'           # Custom max = คะแนนจาก OnTester()
  }
  # ช่วงวันที่ตรวจเฉพาะตอนที่ไม่ได้สั่งมาเอง
  if (-not $From) { $want['DateFrom'] = '1757462400' }  # 2025-09-10
  if (-not $To)   { $want['DateTo']   = '1788825600' }  # 2026-09-08
  $bad = @()
  foreach ($k in $want.Keys) {
    $line = $ini | Where-Object { $_ -like "$k=*" } | Select-Object -First 1
    $have = if ($line) { ($line -split '=', 2)[1] } else { '(ไม่มี)' }
    if ($have -ne $want[$k]) { $bad += "  $k = $have  (ต้องเป็น $($want[$k]))" }
  }
  if ($bad) {
    throw "ค่าใน Strategy Tester ไม่ตรงกับที่ต้องการ เปิด MT5 แก้ก่อน (ดู README.md):`n" +
          ($bad -join "`n") + "`n`nถ้าตั้งใจจะรันด้วยค่าพวกนี้จริง ให้ส่ง -SkipPreflight"
  }
}

# ล้างผลเก่า ไม่งั้นจะปนกับรอบนี้
New-Item -ItemType Directory -Force -Path $dump | Out-Null
Get-ChildItem "$dump\*.csv" -ErrorAction SilentlyContinue | Remove-Item -Force

# ini ต้อง UTF-16 + CRLF
$ini = Join-Path $env:TEMP "ribbon_$Period.ini"
$lines = @(
  '[Tester]'
  "Expert=$Expert"
  "Symbol=$Symbol"
  "Period=$Period"
  "Optimization=$Optimization"
  'OptimizationCriterion=6'          # 6 = Custom max ใช้คะแนนจาก OnTester()
  "ExpertParameters=$SetName.set"
  "Model=$Model"                     # ต้องระบุเอง — MT5 รีเซ็ตช่องนี้ทุกครั้งที่เปิดด้วย /config
  "ExecutionMode=$ExecutionMode"     # เช่นเดียวกัน ไม่ระบุ = 0 ms ซึ่งได้ราคาดีเกินจริง
  'ShutdownTerminal=1'
)
if ($From) { $lines += "FromDate=$From" }
if ($To)   { $lines += "ToDate=$To" }
[System.IO.File]::WriteAllText($ini, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::Unicode)

Write-Host "รัน $Expert บน $Symbol $Period ด้วย $SetName ..." -ForegroundColor Cyan
$t0 = Get-Date
Start-Process -FilePath $Terminal -ArgumentList "/config:`"$ini`"" -Wait
$mins = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)

$files = Get-ChildItem "$dump\*.csv" -ErrorAction SilentlyContinue
if (-not $files) { throw "ไม่มีไฟล์ผลออกมาเลย — เช็คว่าตั้งค่าใน GUI ครบตาม README.md แล้วหรือยัง" }

Get-Content $files.FullName | Set-Content $out -Encoding UTF8
# ล้างทิ้งหลังเก็บด้วย ไม่ใช่แค่ตอนเริ่ม — เคยพลาด 2026-09-10 รอบถัดไปที่ไม่ได้รันจริง
# ไปหยิบไฟล์ค้างของรอบก่อนมาเป็นผลตัวเอง แล้วดูเหมือนสำเร็จทั้งที่ไม่มีอะไรรัน
Remove-Item "$dump\*.csv" -Force -ErrorAction SilentlyContinue
Write-Host "เสร็จใน $mins นาที — $($files.Count) ชุด เขียนลง $out" -ForegroundColor Green
