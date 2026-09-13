#requires -Version 7.0
param([string]$DataDir = $(if ($env:BB_WINDOWS_DATA_DIR) { $env:BB_WINDOWS_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'BBWindows' }))
$ErrorActionPreference = 'Stop'
$env:PATH = (($env:PATH -split ';' | Select-Object -Unique) -join ';')
& (Join-Path $PSScriptRoot 'check.ps1')
& (Join-Path $PSScriptRoot 'bb.ps1') -Action Status -DataDir $DataDir
if ($LASTEXITCODE -eq 0) { throw 'Stop the Windows BB instance before building this checkout.' }
$checkout = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $checkout
try {
    $env:BB_DATA_DIR = [IO.Path]::GetFullPath($DataDir)
    $env:BB_SERVER_BIND_HOST = '127.0.0.1'
    $env:NODE_ENV = 'production'
    & pnpm.cmd install --frozen-lockfile --prod=false
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & node.exe --conditions=source --import tsx scripts/start-bb.mjs --dryrun
    if ($LASTEXITCODE -ne 0) { throw 'Runtime preparation failed.' }
    Write-Output ('CLI: ' + (Join-Path $checkout 'apps/host-daemon/dist/bb.cmd'))
    Write-Output 'Prepared. Run: pwsh -File scripts/windows/bb.ps1 -Action Start'
} finally { Pop-Location }
