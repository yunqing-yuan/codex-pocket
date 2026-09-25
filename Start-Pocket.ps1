param([switch]$Background)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$panelUrl = 'http://127.0.0.1:15732'
try {
    $existing = Invoke-RestMethod -Uri ($panelUrl + '/api/setup') -TimeoutSec 2
    if ($existing.urls) {
        if (-not $Background) {
            $existing.urls | ForEach-Object { Write-Host "Phone relay URL: $_" }
            Write-Host "Pairing code: $($existing.code)"
            Start-Process $panelUrl
        }
        exit
    }
} catch { }
$nodeExe = Join-Path $projectRoot 'node.exe'
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = (Get-Command node -ErrorAction Stop).Source }
$runtimePath = Join-Path $projectRoot 'runtime'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
Start-Process -FilePath $nodeExe -ArgumentList @('desktop.mjs') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'desktop.log') -RedirectStandardError (Join-Path $runtimePath 'desktop-error.log') | Out-Null
for ($i=0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $ready = Invoke-RestMethod -Uri ($panelUrl + '/api/setup') -TimeoutSec 1
        if ($ready.urls) {
            if (-not $Background) {
                $ready.urls | ForEach-Object { Write-Host "Phone relay URL: $_" }
                Write-Host "Pairing code: $($ready.code)"
                Start-Process $panelUrl
            }
            exit
        }
    } catch { }
}
throw 'Codex Pocket startup timed out. See runtime\desktop-error.log.'
