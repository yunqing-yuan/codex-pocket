param([switch]$Remove)
$ErrorActionPreference = 'Stop'
try {
    $startup = [Environment]::GetFolderPath('Startup')
    $shortcutPath = Join-Path $startup 'Codex Pocket.lnk'
    $settingsPath = Join-Path $PSScriptRoot 'runtime\background.json'
    if ($Remove) {
        if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
        if (Test-Path -LiteralPath $settingsPath) { Remove-Item -LiteralPath $settingsPath }
        Write-Host 'Automatic startup disabled. The currently running bridge is not stopped.'
        exit
    }
    $nodeExe = Join-Path $PSScriptRoot 'node.exe'
    if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = (Get-Command node -ErrorAction Stop).Source }
    New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'runtime') | Out-Null
    @{ node = $nodeExe; enabledAt = (Get-Date -Format o) } | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding UTF8
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Watch-Pocket.ps1') + '"'
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Codex Pocket background bridge (current user)'
    $shortcut.Save()
    Start-Process -FilePath $shortcut.TargetPath -ArgumentList $shortcut.Arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    Write-Host 'Background startup and automatic recovery enabled for your Windows sign-in. No Codex chat window is opened.'
    Write-Host 'Keep this folder in place. Pair once with Start-Pocket.cmd before leaving.'
    Write-Host 'The computer must remain powered on, signed in and awake. You can lock its screen.'
} catch {
    Write-Host "Background setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
