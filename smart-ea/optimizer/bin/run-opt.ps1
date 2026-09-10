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
  [ValidateSet('0', '1', '2')][string]$Optimization = '1',  # 0=รันเดียว 1=ไล่ครบ 2=genetic
  [string]$Terminal = 'C:\Program Files\MetaTrader 5 EXNESS\terminal64.exe',
  [string]$DataDir                                   # โฟลเดอร์ข้อมูลของ terminal (เดาให้ถ้าไม่ระบุ)
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $Terminal)) { throw "ไม่พบ terminal64.exe ที่ $Terminal — ส่ง -Terminal มาเอง" }

# หาโฟลเดอร์ข้อมูลของ terminal: ตัวที่มี MQL5\Experts\MARibbonEA.ex5 อยู่
if (-not $DataDir) {
  $DataDir = Get-ChildItem "$env:APPDATA\MetaQuotes\Terminal" -Directory |
    Where-Object { Test-Path "$($_.FullName)\MQL5\Experts\MARibbonEA.ex5" } |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $DataDir) { throw "หาโฟลเดอร์ terminal ไม่เจอ — deploy EA ก่อน (ดู README.md)" }

$dump = "$env:APPDATA\MetaQuotes\Terminal\Common\Files\ribbon_opt"
$out  = Join-Path $root "results\$OutName.csv"

# .set ต้องอยู่ใน Profiles\Tester ของ terminal ถึงจะถูกโหลด
New-Item -ItemType Directory -Force -Path "$DataDir\MQL5\Profiles\Tester" | Out-Null
Copy-Item (Join-Path $root "sets\$SetName.set") "$DataDir\MQL5\Profiles\Tester\" -Force

if (Get-Process terminal64 -ErrorAction SilentlyContinue) {
  throw 'MT5 เปิดอยู่ ปิดก่อน แล้วสั่งใหม่'
}

# ล้างผลเก่า ไม่งั้นจะปนกับรอบนี้
New-Item -ItemType Directory -Force -Path $dump | Out-Null
Get-ChildItem "$dump\*.csv" -ErrorAction SilentlyContinue | Remove-Item -Force

# ini ต้อง UTF-16 + CRLF
$ini = Join-Path $env:TEMP "ribbon_$Period.ini"
$lines = @(
  '[Tester]'
  'Expert=MARibbonEA'
  "Symbol=$Symbol"
  "Period=$Period"
  "Optimization=$Optimization"
  'OptimizationCriterion=6'          # 6 = Custom max ใช้คะแนนจาก OnTester()
  "ExpertParameters=$SetName.set"
  'ShutdownTerminal=1'
)
[System.IO.File]::WriteAllText($ini, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::Unicode)

Write-Host "รัน $Symbol $Period ด้วย $SetName ..." -ForegroundColor Cyan
$t0 = Get-Date
Start-Process -FilePath $Terminal -ArgumentList "/config:`"$ini`"" -Wait
$mins = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)

$files = Get-ChildItem "$dump\*.csv" -ErrorAction SilentlyContinue
if (-not $files) { throw "ไม่มีไฟล์ผลออกมาเลย — เช็คว่าตั้งค่าใน GUI ครบตาม README.md แล้วหรือยัง" }

Get-Content $files.FullName | Set-Content $out -Encoding UTF8
Write-Host "เสร็จใน $mins นาที — $($files.Count) ชุด เขียนลง $out" -ForegroundColor Green
