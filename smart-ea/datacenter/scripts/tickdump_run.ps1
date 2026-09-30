param([string]$From = '2026.01.01', [string]$To = '2026.09.26', [string]$Tag = 'tickdump')
# Runs research\TickDump (no orders) in the MT5-Optimizer terminal's Strategy Tester with REAL ticks (Model=4).
# Output: %APPDATA%\MetaQuotes\Terminal\Common\Files\adxres\ticks\ticks_YYYYMM.bin
$ErrorActionPreference = 'Stop'
$Terminal = 'C:\Users\surak\MT5-Optimizer\terminal64.exe'
$DataDir  = "$env:APPDATA\MetaQuotes\Terminal\58FDB87266C735F9972726E6DA2AC5FA"
$out = "$env:APPDATA\MetaQuotes\Terminal\Common\Files\adxres\ticks"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$waited = 0
while ((Get-Process terminal64 -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $Terminal } catch { $false } }) -and $waited -lt 60) { Start-Sleep 2; $waited += 2 }
$lines = @('[Tester]', 'Expert=research\TickDump', 'Symbol=XAUUSDc', 'Period=M1', 'Optimization=0', 'Model=4', 'ExecutionMode=0',
           'Deposit=10000', 'Currency=USD', 'Leverage=100', "FromDate=$From", "ToDate=$To", "Report=diag_$Tag", 'ReplaceReport=1', 'ShutdownTerminal=1')
$ini = Join-Path $env:TEMP "$Tag.ini"
[System.IO.File]::WriteAllText($ini, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::Unicode)
$t0 = Get-Date
Start-Process -FilePath $Terminal -ArgumentList "/config:`"$ini`"" -Wait
Write-Host "done in $([math]::Round(((Get-Date) - $t0).TotalMinutes, 1)) min"
Get-ChildItem $out | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }
