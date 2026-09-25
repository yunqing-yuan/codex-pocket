param([switch]$Remove)
$ErrorActionPreference = 'Stop'
try {
    $startup = [Environment]::GetFolderPath('Startup')
    $shortcutPath = Join-Path $startup 'Codex Pocket.lnk'
    if ($Remove) {
        if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
        Write-Host 'Automatic startup disabled. The currently running bridge is not stopped.'
        exit
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Start-Pocket.ps1') + '" -Background'
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Codex Pocket background bridge (current user)'
    $shortcut.Save()
    Start-Process -FilePath $shortcut.TargetPath -ArgumentList $shortcut.Arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    Write-Host 'Background startup enabled for your Windows sign-in. No Codex chat window is opened.'
    Write-Host 'Keep this folder in place. Pair once with Start-Pocket.cmd before leaving.'
    Write-Host 'The computer must remain powered on, signed in and awake. You can lock its screen.'
} catch {
    Write-Host "Background setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
