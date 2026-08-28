<#
.SYNOPSIS
    ตรวจสุขภาพประเทศ — เช็กว่าทุกโปรเจกต์ใน C:\dev ทำตามธรรมนูญหรือยัง
#>
[CmdletBinding()]
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Root = 'C:\dev'
$issues = @()

function Problem($project, $msg) {
    $script:issues += [pscustomobject]@{ Project = $project; Issue = $msg }
}

$skip = @('.claude', '.workspace', '_docs', '.git')
$projects = Get-ChildItem $Root -Directory | Where-Object { $skip -notcontains $_.Name }

$LaunchPath = Join-Path $Root '.claude\launch.json'
$launch = Get-Content $LaunchPath -Raw | ConvertFrom-Json
$registry = [System.IO.File]::ReadAllText((Join-Path $Root 'PROJECTS.md'))

# พอร์ตชนกัน
$ports = @($launch.configurations | ForEach-Object { $_.port })
$dupes = $ports | Group-Object | Where-Object { $_.Count -gt 1 }
foreach ($d in $dupes) { Problem '(launch.json)' "พอร์ต $($d.Name) ถูกจองซ้ำ $($d.Count) ครั้ง" }

foreach ($p in $projects) {
    $n = $p.Name
    $dir = $p.FullName

    if ($n -cnotmatch '^[a-z0-9]+(-[a-z0-9]+)*$') { Problem $n 'ชื่อไม่ใช่ kebab-case' }

    foreach ($f in 'README.md', 'CLAUDE.md', '.gitignore') {
        if (-not (Test-Path (Join-Path $dir $f))) { Problem $n "ไม่มี $f" }
    }

    if (Test-Path (Join-Path $dir '.git')) {
        Problem $n 'มี .git ซ้อนในโฟลเดอร์โปรเจกต์ -- dev-workspace เป็น monorepo ห้ามมี repo ซ้อน (ธรรมนูญข้อ 1)'
    }

    $isNode = Test-Path (Join-Path $dir 'package.json')
    $isPython = (Test-Path (Join-Path $dir 'requirements.txt')) -or (Test-Path (Join-Path $dir 'pyproject.toml'))

    $gi = Join-Path $dir '.gitignore'
    if (Test-Path $gi) {
        $text = Get-Content $gi -Raw
        $mustIgnore = @('.env')
        if ($isNode) { $mustIgnore += 'node_modules' }
        if ($isPython) { $mustIgnore += '.venv' }
        foreach ($must in $mustIgnore) {
            if ($text -notmatch [regex]::Escape($must)) {
                Problem $n ".gitignore ไม่ได้ ignore $must"
            }
        }
    }

    if ($isNode -or $isPython) {
        if (-not (Test-Path (Join-Path $dir '.github\workflows\ci.yml'))) {
            Problem $n 'ไม่มี CI (.github/workflows/ci.yml)'
        }
    }

    if ($registry -notmatch [regex]::Escape("| [$n]")) {
        Problem $n 'ยังไม่ได้ลงทะเบียนใน PROJECTS.md'
    }
}

# ---------- dev-workspace repo เดียว: remote / unpushed / secret ----------

Push-Location $Root
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$tracked = & git ls-files 2>$null
$remote = & git remote 2>$null
$unpushed = if ($remote) { & git log '@{u}..' --oneline 2>$null } else { $null }
$ErrorActionPreference = $prevEAP
Pop-Location

if (-not $remote) {
    Problem '(dev-workspace)' 'ไม่มี git remote -- ดิสก์พังคือหายหมด (ธรรมนูญข้อ 4)'
}
elseif ($unpushed) {
    Problem '(dev-workspace)' "มี $(@($unpushed).Count) commit ที่ยังไม่ push"
}
$leaked = @($tracked | Where-Object { $_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '\.example$' })
foreach ($l in $leaked) { Problem '(dev-workspace)' "!! ไฟล์ secret ถูก track ใน git: $l" }

# ---------- รายงาน ----------

Write-Host ""
Write-Host "ตรวจ $($projects.Count) โปรเจกต์ใน $Root" -ForegroundColor Cyan

if ($issues.Count -eq 0) {
    Write-Host "  ผ่านทั้งหมด ไม่มีปัญหา" -ForegroundColor Green
    exit 0
}

$issues | Group-Object Project | ForEach-Object {
    Write-Host ""
    Write-Host "  $($_.Name)" -ForegroundColor Yellow
    $_.Group | ForEach-Object { Write-Host "    - $($_.Issue)" }
}
Write-Host ""
Write-Host "  รวม $($issues.Count) ปัญหา" -ForegroundColor Yellow
exit 1
