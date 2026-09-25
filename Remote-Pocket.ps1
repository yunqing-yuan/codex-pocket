param([switch]$Firewall, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$ruleName = 'CodexPocket-Tailscale-TCP-15731'
$ruleGroup = 'Codex Pocket Remote'
$powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function Get-TailscaleExe {
    $command = Get-Command tailscale.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($folder in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($folder) {
            $candidate = Join-Path $folder 'Tailscale\tailscale.exe'
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
        }
    }
    return $null
}
function Read-TailscaleStatus($exe) {
    # A fresh install may need a few seconds for its service to become ready.
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        $savedPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $raw = & $exe status --json --peers=false 2>$null
            $statusExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $savedPreference }
        if ($statusExit -eq 0) {
            $result = ($raw -join "`n") | ConvertFrom-Json
            if ($result.BackendState) { return $result }
        }
        if ($attempt -lt 4) { Start-Sleep -Seconds 2 }
    }
    throw '无法读取 Tailscale 状态，请先从开始菜单打开 Tailscale，再重新运行。'
}
try {
    if ($Firewall -or $Remove) {
        $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            $mode = if ($Remove) { '-Remove' } else { '-Firewall' }
            $process = Start-Process -FilePath $powerShellExe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" ' + $mode)
            if ($process.ExitCode -ne 0) { throw '专用规则配置未完成。请确认系统权限提示，或联系设备管理员。' }
            if ($Remove) { Write-Host '已移除 Pocket 的异地访问放行规则。Tailscale 账户、其他网络配置和后台启动项不变。' }
            exit 0
        }
        $existing = Get-NetFirewallRule -Name $ruleName -PolicyStore PersistentStore -ErrorAction SilentlyContinue
        if ($existing -and $existing.Group -ne $ruleGroup) { throw '发现其他配置的同名规则，未修改。' }
        if ($Remove) {
            if ($existing) { $existing | Remove-NetFirewallRule }
            Write-Host '已移除 Pocket 的异地访问规则。其他防火墙规则、Tailscale 和后台启动项不变。'
            exit 0
        }
        $exe = Get-TailscaleExe
        if (-not $exe) { throw '未找到 Tailscale。' }
        $status = Read-TailscaleStatus $exe
        if ($status.BackendState -ne 'Running') { throw '请先登录并连接 Tailscale。' }
        $ip = @($status.TailscaleIPs | Where-Object { $_ -match '^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d{1,3}\.\d{1,3}$' }) | Select-Object -First 1
        if (-not $ip) { throw '未找到支持的 Tailscale IPv4 地址。' }
        $network = Get-NetIPAddress -IPAddress $ip -AddressFamily IPv4 -ErrorAction Stop | Select-Object -First 1
        $listener = Get-NetTCPConnection -LocalPort 15731 -State Listen -ErrorAction Stop | Select-Object -First 1
        $worker = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($worker.Name -ne 'node.exe' -or $worker.CommandLine -notmatch '(?:^|[\s"/\\])desktop\.mjs(?:[\s"]|$)' -or -not $worker.ExecutablePath) { throw '15731 不是电脑桥，未修改防火墙。' }
        $settings = @{
            Direction = 'Inbound'; Action = 'Allow'; Enabled = 'True'; Profile = 'Any'
            Program = $worker.ExecutablePath; Protocol = 'TCP'; LocalPort = 15731
            LocalAddress = $ip; RemoteAddress = '100.64.0.0/10'; InterfaceAlias = $network.InterfaceAlias
            EdgeTraversalPolicy = 'Block'
            Description = 'Pocket bridge on this Tailscale interface and IP only; no public port mapping.'
        }
        if ($existing) { Set-NetFirewallRule -Name $ruleName -PolicyStore PersistentStore @settings | Out-Null }
        else { New-NetFirewallRule -Name $ruleName -DisplayName 'Codex Pocket (Tailscale TCP 15731)' -Group $ruleGroup -PolicyStore PersistentStore @settings | Out-Null }
        exit 0
    }

    Write-Host 'Codex Pocket · 异地连接配置' -ForegroundColor Cyan
    Write-Host '首次需要自己登录 Tailscale；手机也安装 Tailscale，并登录同一私人网络。'
    Write-Host '1/4 检查 Tailscale'
    $exe = Get-TailscaleExe
    if (-not $exe) {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $winget) {
            Start-Process 'https://tailscale.com/download/windows'
            throw '本机没有 winget。已打开官方下载页，安装 Tailscale 后重新双击本向导。'
        }
        & $winget.Source install --id Tailscale.Tailscale --exact --source winget --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw 'Tailscale 安装未完成，请到 tailscale.com/download 安装后重试。' }
        $exe = Get-TailscaleExe
        if (-not $exe) { throw '安装后未找到 Tailscale，请重新运行向导。' }
    }
    Write-Host '2/4 连接私人网络'
    $status = Read-TailscaleStatus $exe
    if ($status.BackendState -ne 'Running') {
        if ($status.AuthURL -and $status.AuthURL -match '^https://(?:login|controlplane)\.tailscale\.com/') { Start-Process $status.AuthURL }
        # Native stderr can become a terminating error in Windows PowerShell 5.1.
        $savedPreference = $ErrorActionPreference
        try { $ErrorActionPreference = 'Continue'; & $exe up --timeout=60s; $upExit = $LASTEXITCODE }
        finally { $ErrorActionPreference = $savedPreference }
        if ($upExit -ne 0) { throw '请按上方 Tailscale 登录链接完成登录，或在托盘中连接后重新运行。不覆盖已有路由或账号设置。' }
        $status = Read-TailscaleStatus $exe
    }
    if ($status.BackendState -ne 'Running') { throw 'Tailscale 尚未运行，可能需要完成设备审批或登录。' }
    $ip = @($status.TailscaleIPs | Where-Object { $_ -match '^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d{1,3}\.\d{1,3}$' }) | Select-Object -First 1
    if (-not $ip) { throw '未取得 Tailscale IPv4 地址。' }
    Write-Host '3/4 启动后台电脑桥'
    $starter = Start-Process -FilePath $powerShellExe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Start-Pocket.ps1') + '" -Background') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -Wait -PassThru
    if ($starter.ExitCode -ne 0) { throw '电脑桥启动失败，请运行 Start-Pocket.cmd 查看原因。' }
    $setup = Invoke-RestMethod -Uri 'http://127.0.0.1:15732/api/setup' -TimeoutSec 10
    if (-not $setup.code) { throw '未读取到配对信息。' }
    Write-Host '4/4 配置仅限 Tailscale 的访问规则（请允许 Windows 权限提示）'
    $firewallProcess = Start-Process -FilePath $powerShellExe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Firewall') -WorkingDirectory $PSScriptRoot -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($firewallProcess.ExitCode -ne 0) { throw '访问规则未配置。请检查权限、电脑桥端口或组织策略。' }
    # Fresh one-time code; do not save it or long-lived bridge credentials to a new file.
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:15732/api/rotate' -TimeoutSec 10 | Out-Null
    $setup = Invoke-RestMethod -Uri 'http://127.0.0.1:15732/api/setup' -TimeoutSec 10
    Write-Host ''
    Write-Host ('电脑端准备完成。手机 App 地址：http://' + $ip + ':15731') -ForegroundColor Green
    Write-Host ('一次性配对码：' + $setup.code)
    Write-Host '手机打开 Tailscale 并连接同一账号，再将上方地址和配对码填入 Pocket。'
    Write-Host '手机和电脑可以使用不同网络。建议离开前切换手机到移动数据确认连接。'
    Write-Host '需要登录后自动启动电脑桥时，双击 Enable-Background.cmd。电脑须开机、登录、不休眠，可锁屏。'
    Write-Host '若连不上：检查已有阻止规则、Tailscale 设备审批/访问规则，以及校园网是否封锁服务。'
    Write-Host '撤销本工具的规则：运行 Remove-Remote.cmd。规则撤销不等于撤销手机配对或已有其他放行规则。'
    Start-Process ('http://127.0.0.1:15732/#address=' + [uri]::EscapeDataString('http://' + $ip + ':15731'))
} catch {
    Write-Host ('配置未完成：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
