param([switch]$Firewall, [switch]$Remove, [switch]$StatusOnly, [string]$ResultPath)
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
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = $exe
        $start.Arguments = 'status --json --peers=false'
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        # Windows PowerShell 5.1 otherwise decodes UTF-8 JSON using the console's
        # legacy code page, which can corrupt non-ASCII account display names.
        $start.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
        $start.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $start
        try {
            $process.Start() | Out-Null
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
            if (-not $process.WaitForExit(10000)) { $process.Kill() }
            else {
                $raw = $stdout.GetAwaiter().GetResult()
                $null = $stderr.GetAwaiter().GetResult()
                if ($process.ExitCode -eq 0) {
                    try { $result = $raw | ConvertFrom-Json }
                    catch { throw 'Tailscale 状态数据无法解析。请更新客户端后重试；未输出包含账号信息的原始数据。' }
                    if ($result.BackendState) { return $result }
                }
            }
        } finally { $process.Dispose() }
        if ($attempt -lt 4) { Start-Sleep -Seconds 2 }
    }
    throw '无法读取 Tailscale 状态，请先从开始菜单打开 Tailscale，再重新运行。'
}
function Get-TailscaleIPv4($status) {
    return @($status.TailscaleIPs | Where-Object { $_ -match '^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d{1,3}\.\d{1,3}$' }) | Select-Object -First 1
}
function Show-TailscaleState($status) {
    $label = switch ($status.BackendState) {
        'NeedsLogin' { '需要给这台电脑完成登录授权；网页有设备列表不代表本机已连接。' }
        'NeedsMachineAuth' { '设备等待管理员审批，请在 Tailscale 管理页面批准这台电脑。' }
        'Stopped' { '账号已保存，但连接开关已关闭。请在电脑托盘 Tailscale 中点击 Connect / 连接。' }
        'Starting' { '客户端正在建立连接，请稍候。' }
        'Running' { if ($status.Self.Online -eq $false) { '连接已启用，但本机仍显示离线，请检查电脑网络和 Tailscale 提示。' } else { '电脑已连接。' } }
        default { '客户端尚未就绪，请打开电脑托盘的 Tailscale 查看提示。' }
    }
    Write-Host ('当前状态：' + $status.BackendState + ' — ' + $label)
    foreach ($health in @($status.Health)) { if ($health) { Write-Host ('Tailscale 提示：' + $health) -ForegroundColor Yellow } }
}
function Wait-TailscaleConnection($exe) {
    $status = Read-TailscaleStatus $exe
    $connectRequested = $false
    $lastAuthURL = ''
    $lastMessage = ''
    $nextReminder = Get-Date
    $deadline = (Get-Date).AddMinutes(3)
    while ($true) {
        if ($status.BackendState -eq 'Running' -and (Get-TailscaleIPv4 $status) -and $status.Self.Online -ne $false) { return $status }
        $message = $status.BackendState + ':' + $status.Self.Online
        if ($message -ne $lastMessage -or (Get-Date) -ge $nextReminder) {
            Show-TailscaleState $status
            $lastMessage = $message
            $nextReminder = (Get-Date).AddSeconds(20)
        }
        if (-not $connectRequested -and $status.BackendState -in @('Stopped', 'NoState', 'NeedsLogin')) {
            # A CLI timeout does not undo a browser login; re-read daemon state afterward.
            $savedPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $connectOutput = @(& $exe up --timeout=15s 2>&1)
                $upExit = $LASTEXITCODE
            } finally { $ErrorActionPreference = $savedPreference }
            $connectRequested = $true
            if ($upExit -ne 0 -and ($connectOutput -join "`n") -match 'non-default flags|requires mentioning') {
                Write-Host '已有自定义网络设置，请从电脑托盘 Tailscale 点击连接；本向导不会用 --reset 重置设置。' -ForegroundColor Yellow
            }
            $status = Read-TailscaleStatus $exe
            continue
        }
        if ($status.BackendState -eq 'NeedsLogin' -and $status.AuthURL -and $status.AuthURL -ne $lastAuthURL) {
            $lastAuthURL = $status.AuthURL
            if ($status.AuthURL -match '^https://(?:login|controlplane)\.tailscale\.com/') {
                try { Start-Process $status.AuthURL } catch { Write-Host '浏览器未能打开，请从电脑托盘 Tailscale 点击 Log in / 登录。' -ForegroundColor Yellow }
            }
            Write-Host '请在登录页确认将这台电脑加入网络。不要只停留在 Machines 设备列表。完成后向导会自动继续。'
        }
        if ((Get-Date) -ge $deadline) {
            Write-Host '连接仍未就绪，向导保留在第 2 步；不会因为登录耗时而直接退出。' -ForegroundColor Yellow
            $choice = Read-Host '完成连接后按 Enter 重新检查；输入 R 重新请求连接；输入 Q 退出'
            if ($choice -match '^[Qq]$') { throw '已退出配置。完成设备登录后，重新双击 Setup-Remote.cmd 可继续。' }
            if ($choice -match '^[Rr]$') { $connectRequested = $false; $lastAuthURL = '' }
            $deadline = (Get-Date).AddMinutes(3)
        } else { Start-Sleep -Seconds 3 }
        $status = Read-TailscaleStatus $exe
    }
}
try {
    if ($StatusOnly) {
        $exe = Get-TailscaleExe
        if (-not $exe) { throw '未安装 Tailscale。' }
        $status = Read-TailscaleStatus $exe
        Show-TailscaleState $status
        $ip = Get-TailscaleIPv4 $status
        if ($ip) { Write-Host ('本机 Tailscale 地址：' + $ip) }
        Write-Host '这是状态查看，没有执行登录、修改防火墙或更换配对信息。'
        exit 0
    }
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
        if ($status.BackendState -ne 'Running' -or $status.Self.Online -eq $false) { throw '请先登录并连接 Tailscale。' }
        $ip = Get-TailscaleIPv4 $status
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
    $status = Wait-TailscaleConnection $exe
    $ip = Get-TailscaleIPv4 $status
    if (-not $ip) { throw '未取得 Tailscale IPv4 地址。' }
    Write-Host '3/4 启动后台电脑桥'
    $starter = Start-Process -FilePath $powerShellExe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Start-Pocket.ps1') + '" -Background') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -Wait -PassThru
    if ($starter.ExitCode -ne 0) { throw '电脑桥启动失败，请运行 Start-Pocket.cmd 查看原因。' }
    $setup = Invoke-RestMethod -Uri 'http://127.0.0.1:15732/api/setup' -TimeoutSec 10
    if (-not $setup.code) { throw '未读取到配对信息。' }
    Write-Host '4/4 配置仅限 Tailscale 的访问规则（请允许 Windows 权限提示）'
    $firewallResult = Join-Path ([IO.Path]::GetTempPath()) ('pocket-firewall-' + [guid]::NewGuid().ToString('N') + '.txt')
    try {
        $firewallProcess = Start-Process -FilePath $powerShellExe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Firewall -ResultPath "' + $firewallResult + '"') -WorkingDirectory $PSScriptRoot -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        if ($firewallProcess.ExitCode -ne 0) {
            $reason = if (Test-Path -LiteralPath $firewallResult) { Get-Content -LiteralPath $firewallResult -Raw } else { '权限操作未完成，或窗口被取消。' }
            throw ('访问规则未配置：' + $reason)
        }
    } finally { if (Test-Path -LiteralPath $firewallResult) { Remove-Item -LiteralPath $firewallResult } }
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
    if ($Firewall -and $ResultPath) { try { Set-Content -LiteralPath $ResultPath -Value $_.Exception.Message -Encoding UTF8 } catch { } }
    Write-Host ('配置未完成：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
