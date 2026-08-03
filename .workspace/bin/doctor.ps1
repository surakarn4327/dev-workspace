<#
.SYNOPSIS
    ตรวจสุขภาพประเทศ — เช็กว่าทุกโปรเจกต์ใน C:\dev ทำตามธรรมนูญหรือยัง
#>
[CmdletBinding()]
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
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

    if (-not (Test-Path (Join-Path $dir '.git'))) {
        Problem $n 'ยังไม่เป็น git repo (ธรรมนูญข้อ 1)'
    }

    $gi = Join-Path $dir '.gitignore'
    if (Test-Path $gi) {
        $text = Get-Content $gi -Raw
        foreach ($must in '.env', 'node_modules') {
            if ($text -notmatch [regex]::Escape($must)) {
                Problem $n ".gitignore ไม่ได้ ignore $must"
            }
        }
    }

    # secret หลุดเข้า git หรือยัง
    if (Test-Path (Join-Path $dir '.git')) {
        Push-Location $dir
        $tracked = & git ls-files 2>$null
        Pop-Location
        $leaked = @($tracked | Where-Object { $_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '\.example$' })
        foreach ($l in $leaked) { Problem $n "!! ไฟล์ secret ถูก track ใน git: $l" }
    }

    if ($registry -notmatch [regex]::Escape("| [$n]")) {
        Problem $n 'ยังไม่ได้ลงทะเบียนใน PROJECTS.md'
    }
}

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
