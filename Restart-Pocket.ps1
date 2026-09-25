$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$listener = Get-NetTCPConnection -LocalPort 15732 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $bridgePid = $listener.OwningProcess
    $bridgeProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$bridgePid"
    if ($bridgeProcess.Name -ne 'node.exe' -or $bridgeProcess.CommandLine -notmatch '(?:^|[\s"/\\])desktop\.mjs(?:[\s"]|$)') {
        throw 'Port 15732 is owned by another application. No process was stopped.'
    }
    # Refuse to interrupt running phone tasks or approvals.
    $pair = Get-Content -LiteralPath (Join-Path $projectRoot 'runtime\pairing.json') -Raw | ConvertFrom-Json
    $headers = @{ Authorization = "Bearer $($pair.token)" }
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:15731/health' -Headers $headers -TimeoutSec 10
    $threads = Invoke-RestMethod -Uri 'http://127.0.0.1:15731/threads?limit=200' -Headers $headers -TimeoutSec 30
    $approvals = Invoke-RestMethod -Uri 'http://127.0.0.1:15731/approvals' -Headers $headers -TimeoutSec 10
    if (@($threads.threads | Where-Object { $_.owner -eq 'bridge' -and $_.status -eq 'active' }).Count -or @($approvals.approvals).Count) {
        throw 'Finish or stop running Pocket tasks and approvals before restarting.'
    }
    $worker = Get-CimInstance Win32_Process -Filter "ProcessId=$($health.pid)"
    if ($worker.ParentProcessId -ne $bridgePid -or $worker.Name -ne 'codex.exe' -or $worker.CommandLine -notmatch 'app-server.*stdio://') {
        throw 'Pocket worker identity could not be confirmed. No process was stopped.'
    }
    Write-Host 'Restarting only the Pocket bridge. Desktop Codex stays open.'
    Stop-Process -Id $bridgePid -Force
    Stop-Process -Id $worker.ProcessId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}
& (Join-Path $projectRoot 'Start-Pocket.ps1')
