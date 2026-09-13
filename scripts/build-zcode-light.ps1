param([ValidateSet('build', 'test')][string]$Task = 'build')
$ErrorActionPreference = 'Stop'
$zcRepo = Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime\zcode-acp'
if (-not (Test-Path -LiteralPath (Join-Path $zcRepo 'Cargo.toml'))) { throw 'ZCode adapter checkout is missing.' }
$zcProcess = [Diagnostics.Process]::GetCurrentProcess()
$zcPreviousPriority = $zcProcess.PriorityClass
$zcPreviousAffinity = $zcProcess.ProcessorAffinity
$zcLightAffinity = [long]0
$zcSelectedCores = 0
for ($zcCoreIndex = 0; $zcCoreIndex -lt 64 -and $zcSelectedCores -lt 2; $zcCoreIndex++) {
    $zcCoreBit = [long]1 -shl $zcCoreIndex
    if (($zcPreviousAffinity.ToInt64() -band $zcCoreBit) -ne 0) {
        $zcLightAffinity = $zcLightAffinity -bor $zcCoreBit
        $zcSelectedCores++
    }
}
$zcPreviousJobs = $env:CARGO_BUILD_JOBS
try {
    $zcProcess.PriorityClass = [Diagnostics.ProcessPriorityClass]::BelowNormal
    $zcProcess.ProcessorAffinity = [IntPtr]$zcLightAffinity
    $env:CARGO_BUILD_JOBS = '1'
    Push-Location $zcRepo
    try {
        & cargo $Task --locked --jobs 1
        if ($LASTEXITCODE -ne 0) { throw "ZCode $Task failed: $LASTEXITCODE" }
        if ($Task -eq 'build') {
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'zcode-edit-snapshot.cjs') -Destination (Join-Path $zcRepo 'target\debug\zcode-edit-snapshot.cjs')
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'zcode-native-stop-preload.cjs') -Destination (Join-Path $zcRepo 'target\debug\zcode-native-stop-preload.cjs')
        }
    } finally { Pop-Location }
} finally {
    $env:CARGO_BUILD_JOBS = $zcPreviousJobs
    $zcProcess.PriorityClass = $zcPreviousPriority
    $zcProcess.ProcessorAffinity = $zcPreviousAffinity
}
