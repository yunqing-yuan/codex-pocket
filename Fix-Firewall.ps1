param(
    [ValidateRange(1, 65535)]
    [int]$Port = 15731,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw '请右键 Fix-Firewall.cmd，选择“以管理员身份运行”。'
    }

    $ruleName = "CodexPocket-Private-TCP-$Port"
    $ruleGroup = 'Codex Pocket'
    $existing = Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction SilentlyContinue
    if ($existing -and $existing.Group -ne $ruleGroup) {
        throw '存在同名的其他防火墙配置，未修改任何规则。'
    }
    if ($Remove) {
        if ($existing) { $existing | Remove-NetFirewallRule }
        Write-Host '已移除 Pocket 的防火墙放行规则。'
        exit 0
    }

    # Use the executable actually serving Pocket, including Node installed outside PATH.
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $worker = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($worker.Name -ne 'node.exe' -or $worker.CommandLine -notmatch '(?:^|[\s"/\\])(?:desktop|bridge)\.mjs(?:[\s"]|$)') {
            throw "端口 $Port 被其他程序占用，未修改任何规则。"
        }
        $nodeExe = $worker.ExecutablePath
    } else {
        $nodeExe = Join-Path $PSScriptRoot 'node.exe'
        if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
            $nodeExe = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
        }
    }
    if (-not $nodeExe -or -not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
        throw '找不到 Node.js。请安装 Node.js，启动电脑桥后重新运行此工具。'
    }

    # Explicit blocks override allows. Report them instead of changing unrelated policy.
    $blocks = @(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Inbound -Action Block |
        Where-Object { $_.Profile -eq 'Any' -or "$($_.Profile)" -match 'Private' } |
        Where-Object { @($_ | Get-NetFirewallApplicationFilter | Where-Object {
            [Environment]::ExpandEnvironmentVariables($_.Program) -eq $nodeExe
        }).Count -gt 0 })

    $settings = @{
        Direction = 'Inbound'
        Action = 'Allow'
        Enabled = 'True'
        Profile = 'Private'
        Program = $nodeExe
        Protocol = 'TCP'
        LocalPort = $Port
        RemoteAddress = 'LocalSubnet'
        EdgeTraversalPolicy = 'Block'
        Description = 'Allow the Pocket Node bridge from the local subnet on trusted private networks.'
    }
    if ($existing) {
        Set-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName @settings | Out-Null
    } else {
        New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName "Codex Pocket (Private LAN TCP $Port)" -Group $ruleGroup @settings | Out-Null
    }

    Write-Host "已配置：仅放行电脑桥的 Node.js / TCP $Port / 专用网络 / 本地子网。"
    Write-Host '请保持 Windows 防火墙开启。配对管理端口 15732 未开放。'
    Write-Host ''
    Write-Host '当前网络（Private = 专用，Public = 公用）：'
    $profiles = @(Get-NetConnectionProfile)
    $profiles | Select-Object Name, InterfaceAlias, NetworkCategory | Format-Table -AutoSize
    if (@($profiles | Where-Object NetworkCategory -ne 'Private').Count) {
        Write-Warning '如果自己的可信 Wi-Fi / 手机热点显示 Public，请在 Windows 设置 → 网络和 Internet → 当前连接属性中，将该网络改为“专用”。'
    }
    if ($blocks.Count) {
        Write-Warning '发现已有 Node.js 阻止规则，可能仍会拦截。按 Win+R 输入 wf.msc，在“入站规则”找到下列规则，打开“属性 → 高级”，仅对不需要阻止的规则取消“专用”。组织策略请联系管理员。'
        $blocks | Select-Object DisplayName, Name, Profile, PolicyStoreSourceType | Format-Table -AutoSize
        exit 2
    }
    Write-Host '保持电脑桥运行，手机连接同一可信网络后重试。'
    Write-Host '如仍无法连接，请检查其他明确的阻止规则或第三方防火墙。'
    Write-Host '撤销本工具的放行规则：powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Fix-Firewall.ps1 -Remove'
} catch {
    Write-Host "防火墙配置失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
