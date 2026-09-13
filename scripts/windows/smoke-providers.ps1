#requires -Version 7.0
param(
    [Parameter(Mandatory)][string]$Project,
    [string]$ServerUrl = 'http://127.0.0.1:38886',
    [ValidateRange(1024, 65535)][int]$DaemonPort = 38887,
    [string]$ProviderFile = (Join-Path $PSScriptRoot 'providers.example.json'),
    [ValidateRange(10, 1800)][int]$TimeoutSeconds = 180
)
$ErrorActionPreference = 'Stop'
$env:BB_SERVER_URL = $ServerUrl
$env:BB_HOST_DAEMON_PORT = "$DaemonPort"
$cli = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../apps/host-daemon/dist/bb'))
$env:BB_CLI = $cli
$providers = Get-Content -LiteralPath $ProviderFile -Raw | ConvertFrom-Json
$expected = @('codex', 'claude-code', 'acp-zcode', 'acp-opencode', 'acp-deepseek-harness')
if (@($providers).Count -ne 5 -or (Compare-Object @($providers.id | Sort-Object) @($expected | Sort-Object))) { throw 'The smoke configuration must cover all five provider routes exactly once.' }
function Invoke-Bb([string[]]$Arguments) {
    $output = & node.exe $cli @Arguments
    if ($LASTEXITCODE -ne 0) { throw "CLI failed: $($Arguments[0]) $($Arguments[1])" }
    return ($output -join "`n" | ConvertFrom-Json)
}
$failures = @()
foreach ($provider in $providers) {
    $threadId = $null
    try {
        $marker = 'BB_WINDOWS_SMOKE_' + [Guid]::NewGuid().ToString('N')
        $arguments = @('thread', 'spawn', '--project', $Project, '--provider', $provider.id, '--environment-provider', 'project-checkout', '--title', ('Windows smoke: ' + $provider.id), '--prompt', "Reply with exactly $marker. Do not use tools or change files.", '--json')
        if ($provider.model) { $arguments += @('--model', $provider.model) }
        if ($provider.reasoning) { $arguments += @('--reasoning-level', $provider.reasoning) }
        $thread = Invoke-Bb $arguments
        $threadId = $thread.id
        if (-not $threadId) { throw 'Spawn returned no thread ID.' }
        Write-Output "Created $($provider.id): $threadId"
        [void](Invoke-Bb @('thread', 'wait', $threadId, '--status', 'idle', '--timeout', "$TimeoutSeconds", '--json'))
        $result = Invoke-Bb @('thread', 'output', $threadId, '--json')
        if (-not $result.output -or -not $result.output.Contains($marker)) { throw 'The final output does not contain the requested marker.' }
        Write-Output "PASS $($provider.id): $threadId"
    } catch {
        $failures += $provider.id
        Write-Warning "FAIL $($provider.id): $($_.Exception.Message)"
        if ($threadId) { & node.exe $cli thread stop $threadId | Out-Null }
    }
}
if ($failures.Count) { throw "Provider smoke failed: $($failures -join ', ')" }
Write-Output 'All five provider routes returned a fresh response. Verify open-chat delivery separately in the UI.'
