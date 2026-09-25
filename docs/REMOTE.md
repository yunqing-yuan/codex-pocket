# 不同网络连接：配置向导

本功能在 1.3.0 的体验改进交付之后提供。使用 **Tailscale 私人网络**，电脑无需公网 IP 或路由器端口映射。手机仍使用 Codex Pocket App；Tailscale 负责连接两台设备，不替代模型服务或 cc-switch。

## 第一次：电脑双击一次，手机完成登录

1. 完整解压电脑桥，双击 **`Setup-Remote.cmd`**。
2. 向导检测 Tailscale；未安装时通过 Windows winget 安装。没有 winget 的电脑会打开官方下载页，安装后重新运行向导。
3. 首次按提示登录 Tailscale，使用自己的账号。手机安装 [Tailscale Android](https://tailscale.com/download/android)，登录同一账号，并允许系统 VPN 请求。
4. 向导后台启动电脑桥，并请求管理员权限设置**只限 Tailscale 网卡和地址、TCP 15731、Tailscale 来源网段**的入站规则。它不改默认路由、不配置出口节点、不打开公网隧道，也不替换既有 VPN 配置。
5. 在 Pocket「设置与配对」填写向导显示的 `100.x.x.x:15731` 地址和一次性配对码。以后连接时，两端 Tailscale 都需保持在线。
6. 外出前，将手机从 Wi-Fi 切换到移动数据，确认能同步会话。需要电脑桥登录后自动运行时，双击 `Enable-Background.cmd`。

首次登录、VPN 系统授权和管理员权限不能由工具替用户绕过。向导不会把账号、配对码或令牌写入新配置文件；仍沿用原桥的配对存储。它不改变模型服务账号。

## 校园网与兼容范围

Tailscale 优先直连；无法直连时可使用加密 DERP 中继，官方文档说明中继使用 TCP 443。因此许多 NAT/UDP 较严格的网络仍可用，但如果学校阻止 Tailscale、登录服务、中继服务或 VPN，本工具不能保证连接，也不绕过学校策略。先完成校园网自己的认证。

Android 通常只能同时启用一个 VPN。若另一个代理/VPN 正在占用系统 VPN，请先停用它，再打开 Tailscale；不要把 Pocket 排除在 Tailscale 的应用路由之外。电脑上的其他 VPN 或使用 `100.64.0.0/10` 的网络也可能冲突。

向导针对 Tailscale 默认 IPv4 地址和电脑桥默认端口。自定义地址池、Headscale、组织 ACL、设备审批、设备密钥过期或第三方防火墙，需要按各自管理策略处理。安装器可能需要联网及系统管理员权限。

电脑仍需开机、登录并保持唤醒；可以锁屏。没有实现远程开机、绕过 Windows 登录或手机直接运行完整 Codex 引擎。

## 连接不通

- 先确认手机与电脑的 Tailscale 均为已连接，属于同一私人网络。
- 地址填写向导显示的 Tailscale 地址，而非原 Wi-Fi 地址。
- 向导成功表示**电脑侧配置完成**，不表示已经验证手机或校园网的端到端链路。
- Windows 显式阻止规则优先于允许规则；第三方防火墙或组织策略需单独处理。
- 管理员 PowerShell 可执行 `tailscale status` 查看设备状态、`tailscale netcheck` 查看直连/中继网络条件。分享输出前先移除账号、IP、设备名。
- 更换电脑的 Tailscale 账号、地址或 Node.js 安装路径后，重新运行向导。

## 撤销与隐私

双击 `Remove-Remote.cmd` 并允许权限提示，只移除本向导创建的 `CodexPocket-Tailscale-TCP-15731` 防火墙规则；不会删除账号、停止 VPN、影响其他程序或移除后台启动项。

其他已有放行规则仍可能允许连接。需要立即停止异地访问，应在 Tailscale 断开电脑或撤销对应设备；需要撤销 Pocket 手机凭据，按 [隐私说明](../PRIVACY.md) 更换桥令牌。`Disable-Background.cmd` 只撤销桥的自动启动。

Tailscale 是外部服务，登录身份、设备和网络连接元数据由其按自身政策处理。它提供的设备链路为加密隧道，Pocket 仍使用桥访问令牌。不要分享自己的账号、设备授权链接、配对码或 `runtime/`。

## 官方参考

- [Windows 安装](https://tailscale.com/docs/install/windows)
- [连接类型与中继](https://tailscale.com/docs/reference/connection-types)
- [防火墙端口](https://tailscale.com/docs/reference/faq/firewall-ports)
- [其他 VPN 的兼容限制](https://tailscale.com/docs/reference/faq/other-vpns)
- [tailscale up](https://tailscale.com/docs/reference/tailscale-cli/up)

交付检查只覆盖脚本语法、包内容和隐私扫描；尚未在用户校园网与两部跨网设备上完成验证。
