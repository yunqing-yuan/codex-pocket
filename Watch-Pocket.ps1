$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$settingsPath = Join-Path $projectRoot 'runtime\background.json'
$sha = [Security.Cryptography.SHA256]::Create()
try { $id = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-', '').Substring(0, 24) }
finally { $sha.Dispose() }
$mutex = New-Object Threading.Mutex($false, ('Local\CodexPocket-' + $id))
$held = $false
try {
    try { $held = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { exit }
    while (Test-Path -LiteralPath $settingsPath) {
        try {
            $healthy = $false
            try {
                $panel = Invoke-RestMethod -Uri 'http://127.0.0.1:15732/api/setup' -TimeoutSec 3
                $healthy = [bool]$panel.urls
            } catch { }
            if (-not $healthy) {
                # Keep Start-Pocket's exit and startup failures in their own hidden process.
                $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
                $arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $projectRoot 'Start-Pocket.ps1') + '" -Background'
                $starter = Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
                # Bound retries; do not stop the bridge or an active Codex task on timeouts.
                if (-not $starter.WaitForExit(45000)) { $starter.Kill() }
                $starter.Dispose()
            }
        } catch {
            $message = (Get-Date -Format o) + ' Background retry failed: ' + $_.Exception.Message
            Set-Content -LiteralPath (Join-Path $projectRoot 'runtime\background-error.log') -Value $message -Encoding UTF8
        }
        Start-Sleep -Seconds 15
    }
} finally {
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
