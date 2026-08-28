<#
.SYNOPSIS
    สร้างโปรเจกต์ใหม่ใน C:\dev ตามธรรมนูญ (C:\dev\CLAUDE.md)

.EXAMPLE
    .\new-project.ps1 -Name smart-notes -Type web -Description "จดโน้ตแบบเร็ว"
    .\new-project.ps1 -Name fuel-api -Type python
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,

    [Parameter(Position = 1)]
    [ValidateSet('web', 'next', 'node', 'python', 'blank')]
    [string]$Type = 'blank',

    [string]$Description = '',

    # ข้าม npm install / create-* (สร้างแค่โครงไฟล์)
    [switch]$NoInstall
)

$ErrorActionPreference = 'Stop'
$Root = 'C:\dev'
$Templates = Join-Path $Root '.workspace\templates\common'

# ---------- helpers ----------

function Write-Utf8($Path, $Text) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, ($Text -replace "`r`n", "`n"), $enc)
}

function Render($TemplateFile, $Map) {
    $text = [System.IO.File]::ReadAllText((Join-Path $Templates $TemplateFile))
    foreach ($k in $Map.Keys) { $text = $text.Replace("{{$k}}", [string]$Map[$k]) }
    return $text
}

function Fail($msg) { Write-Host "  x $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "  > $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  + $msg" -ForegroundColor Green }

# ---------- 1. ตรวจสัญชาติ (validate) ----------

if ($Name -cnotmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
    Fail "ชื่อต้องเป็น kebab-case ภาษาอังกฤษ เช่น my-app (ได้มา: '$Name')"
}

$ProjectDir = Join-Path $Root $Name
if (Test-Path $ProjectDir) { Fail "มี $ProjectDir อยู่แล้ว" }
if (-not $Description) { $Description = "<!-- ยังไม่ได้เขียนคำอธิบาย -->" }

$LaunchPath = Join-Path $Root '.claude\launch.json'
$launch = Get-Content $LaunchPath -Raw | ConvertFrom-Json

# ---------- 2. จองพอร์ต ----------

$ranges = @{
    next   = @(3000, 3099)
    web    = @(5170, 5199)
    node   = @(8000, 8099)
    python = @(8000, 8099)
}

$Port = $null
if ($ranges.ContainsKey($Type)) {
    $used = @($launch.configurations | ForEach-Object { $_.port })
    $r = $ranges[$Type]
    for ($p = $r[0]; $p -le $r[1]; $p++) {
        if ($used -notcontains $p) { $Port = $p; break }
    }
    if (-not $Port) { Fail "พอร์ตในช่วง $($r[0])-$($r[1]) เต็มแล้ว" }
    Step "จองพอร์ต $Port"
}

# ---------- 3. scaffold ตามชนิด ----------

Step "สร้าง $Type project: $Name"
Push-Location $Root
try {
    switch ($Type) {
        'web' {
            if ($NoInstall) {
                New-Item -ItemType Directory -Path $ProjectDir -Force | Out-Null
            }
            else {
                & npm create vite@latest $Name -- --template vanilla-ts
                if ($LASTEXITCODE -ne 0) { Fail "npm create vite ล้มเหลว" }
                Push-Location $ProjectDir; & npm install; Pop-Location
            }
            $install = 'npm install'
            $dev = "npm run dev -- --port $Port"
            $build = 'npm run build'
            $test = 'npm run test   # ยังไม่ได้ตั้ง'
            $gitignore = 'gitignore.node'
            $launchArgs = @('--prefix', $Name, 'run', 'dev', '--', '--port', "$Port")
            $launchExe = 'npm'
        }
        'next' {
            if ($NoInstall) {
                New-Item -ItemType Directory -Path $ProjectDir -Force | Out-Null
            }
            else {
                & npx --yes create-next-app@latest $Name --ts --app --eslint --tailwind --src-dir --import-alias "@/*" --use-npm --yes
                if ($LASTEXITCODE -ne 0) { Fail "create-next-app ล้มเหลว" }
            }
            $install = 'npm install'
            $dev = "npm run dev -- -p $Port"
            $build = 'npm run build'
            $test = 'npm run lint'
            $gitignore = 'gitignore.node'
            $launchArgs = @('--prefix', $Name, 'run', 'dev', '--', '-p', "$Port")
            $launchExe = 'npm'
        }
        'node' {
            New-Item -ItemType Directory -Path "$ProjectDir\src" -Force | Out-Null
            $pkg = @{
                name    = $Name
                version = '0.1.0'
                private = $true
                type    = 'module'
                scripts = @{
                    dev   = 'node --experimental-strip-types --watch src/index.ts'
                    start = 'node --experimental-strip-types src/index.ts'
                    build = 'tsc --noEmit'
                    test  = 'node --test'
                }
            }
            Write-Utf8 "$ProjectDir\package.json" ($pkg | ConvertTo-Json -Depth 5)
            Write-Utf8 "$ProjectDir\tsconfig.json" (@'
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
'@)
            Write-Utf8 "$ProjectDir\src\index.ts" "console.log('$Name is alive');`n"
            $install = 'npm install'
            $dev = 'npm run dev'
            $build = 'npm run build'
            $test = 'npm test'
            $gitignore = 'gitignore.node'
            $launchArgs = @('--prefix', $Name, 'run', 'dev')
            $launchExe = 'npm'
        }
        'python' {
            New-Item -ItemType Directory -Path "$ProjectDir\src" -Force | Out-Null
            Write-Utf8 "$ProjectDir\src\main.py" "def main() -> None:`n    print('$Name is alive')`n`n`nif __name__ == '__main__':`n    main()`n"
            Write-Utf8 "$ProjectDir\requirements.txt" "# แพ็กเกจของโปรเจกต์นี้`npytest`n"
            New-Item -ItemType Directory -Path "$ProjectDir\tests" -Force | Out-Null
            Write-Utf8 "$ProjectDir\tests\test_smoke.py" "def test_smoke() -> None:`n    assert True`n"
            if (-not $NoInstall) {
                Step "สร้าง .venv"
                & python -m venv "$ProjectDir\.venv"
            }
            $install = 'python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements.txt'
            $dev = 'python src\main.py'
            $build = '# ไม่มี build step'
            $test = 'pytest'
            $gitignore = 'gitignore.python'
            $launchArgs = $null
            $launchExe = $null
        }
        'blank' {
            New-Item -ItemType Directory -Path $ProjectDir -Force | Out-Null
            $install = '# ยังไม่มี'
            $dev = '# ยังไม่มี'
            $build = '# ยังไม่มี'
            $test = '# ยังไม่มี'
            $gitignore = 'gitignore.node'
            $launchArgs = $null
            $launchExe = $null
        }
    }
}
finally { Pop-Location }

# ---------- 4. ใส่เอกสารสัญชาติ ----------

$map = @{
    NAME        = $Name
    TYPE        = $Type
    DESCRIPTION = $Description
    PORT        = if ($Port) { $Port } else { '-' }
    DATE        = (Get-Date -Format 'yyyy-MM-dd')
    INSTALL_CMD = $install
    DEV_CMD     = $dev
    BUILD_CMD   = $build
    TEST_CMD    = $test
}

Write-Utf8 "$ProjectDir\CLAUDE.md" (Render 'CLAUDE.md.tpl' $map)
Write-Utf8 "$ProjectDir\README.md" (Render 'README.md.tpl' $map)
Copy-Item (Join-Path $Templates $gitignore) "$ProjectDir\.gitignore" -Force
Copy-Item (Join-Path $Templates 'gitattributes') "$ProjectDir\.gitattributes" -Force
Copy-Item (Join-Path $Root '.editorconfig') "$ProjectDir\.editorconfig" -Force
if ($Type -in @('web', 'next', 'node')) {
    Copy-Item (Join-Path $Root '.nvmrc') "$ProjectDir\.nvmrc" -Force
}
Ok "ใส่ CLAUDE.md / README.md / .gitignore / .gitattributes / .editorconfig"

# ---------- 4b. CI (GitHub Actions) ----------

$ciTpl = switch ($Type) {
    { $_ -in @('web', 'next', 'node') } { 'ci-node.yml.tpl' }
    'python' { 'ci-python.yml.tpl' }
    default { $null }
}
if ($ciTpl) {
    New-Item -ItemType Directory -Path "$ProjectDir\.github\workflows" -Force | Out-Null
    Write-Utf8 "$ProjectDir\.github\workflows\ci.yml" (Render $ciTpl $map)
    Ok "ใส่ CI (.github/workflows/ci.yml)"
}

# ---------- 5. ลงทะเบียนพอร์ต ----------

if ($launchExe) {
    $entry = [pscustomobject]@{
        name              = $Name
        runtimeExecutable = $launchExe
        runtimeArgs       = $launchArgs
        port              = $Port
    }
    $launch.configurations = @($launch.configurations) + $entry
    Write-Utf8 $LaunchPath ($launch | ConvertTo-Json -Depth 6)
    Ok "ลงทะเบียนใน launch.json (preview_start '$Name')"
}

# ---------- 6. ลงทะเบียนราษฎร์ ----------

$RegPath = Join-Path $Root 'PROJECTS.md'
$reg = [System.IO.File]::ReadAllText($RegPath)
$row = "| [$Name]($Name/) | $Type | $($map.PORT) | $($map.DATE) | $Description |"
$reg = $reg.Replace('<!-- PROJECTS:START -->', "<!-- PROJECTS:START -->`n$row")
Write-Utf8 $RegPath $reg
Ok "ลงทะเบียนใน PROJECTS.md"

# ---------- 7. commit เข้า dev-workspace repo เดิม ----------
# dev-workspace เป็น monorepo เดียว ไม่ git init แยกต่อโปรเจกต์ (ธรรมนูญข้อ 1)
# identity มาจาก C:\dev\.gitconfig ผ่าน includeIf อัตโนมัติ ไม่ต้องตั้งตรงนี้

Push-Location $Root
try {
    & git add -- $Name
    & git commit -q -m "add $Name ($Type project)"
    if ($?) { Ok "commit เข้า dev-workspace เรียบร้อย" }
}
finally { Pop-Location }

Write-Host ""
Write-Host "  พลเมืองใหม่: $ProjectDir" -ForegroundColor Green
if ($Port) { Write-Host "  พอร์ต $Port  ->  preview_start ชื่อ '$Name'" -ForegroundColor Green }
Write-Host "  ต่อไป: แก้ $Name\CLAUDE.md ให้บอกว่าโปรเจกต์นี้ทำอะไร แล้ว push dev-workspace" -ForegroundColor DarkGray
