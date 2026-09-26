# 手机和电脑不在同一个网络：一步一步连接

适用：Windows 电脑 + Android 手机 + Codex Pocket。手机安装 Pocket 和 Tailscale 两个 App；电脑安装 Tailscale 并运行电脑桥。电脑上的 Codex 需已配置可用的模型服务，Pocket 沿用原配置。

## 先理解这次为什么没有第 3 步

旧向导在第 2 步运行 `tailscale up --timeout=60s`。如果浏览器登录、设备授权或连接过程超过 60 秒，它就把等待超时当作失败，退出向导，因此不会显示第 3、4 步。

网页 Machines 列表表示账号登记过哪些设备，不等于设备此刻正在连接。灰点和「Last seen / 最后出现时间」需要结合客户端状态判断；电脑上的 Tailscale 服务运行、网卡显示 Up，也不代表账号认证已完成。

新版电脑桥（1.3.2-bridge.1）按客户端实际状态继续：启动连接命令超时后重新读取状态，登录完成后自动进入下一步。等待约 3 分钟仍未完成，会保留在第 2 步，让你按 Enter 继续检查、输入 R 重新请求连接或 Q 退出。没有清除账号或重置已有路由设置。

本次还修复了 Windows PowerShell 5.1 在管理员窗口读取含中文账号名称的 Tailscale 状态时，按旧代码页解码导致 JSON 解析失败的问题。新版直接按 UTF-8 读取，并将第 4 步的具体错误带回主窗口，不再只显示笼统的「访问规则未配置」。

## 第一次需要下载什么

| 设备 | 文件 | 用途 |
| --- | --- | --- |
| 电脑 | [Codex-Pocket-Bridge.zip](https://github.com/yunqing-yuan/codex-pocket/releases/download/v1.3.2-bridge.1/Codex-Pocket-Bridge.zip) | 解压后运行连接向导和后台电脑桥 |
| 电脑 | [tailscale-setup-1.102.4.exe](https://github.com/yunqing-yuan/codex-pocket/releases/download/v1.3.2/tailscale-setup-1.102.4.exe) | 安装 Windows Tailscale |
| 手机 | [Codex-Pocket.apk](https://github.com/yunqing-yuan/codex-pocket/releases/download/v1.3.2-bridge.1/Codex-Pocket.apk) | 手机聊天 App；已安装 1.3.2 的无需重装 |
| 手机 | [tailscale-android-universal-1.102.4.apk](https://github.com/yunqing-yuan/codex-pocket/releases/download/v1.3.2/tailscale-android-universal-1.102.4.apk) | 安装 Android Tailscale |

上述 Tailscale 文件为用户提供的第三方安装包镜像；也可使用 [Tailscale 官方下载](https://tailscale.com/download)。Tailscale 文件校验值见 [Tailscale-SHA256SUMS.txt](https://github.com/yunqing-yuan/codex-pocket/releases/download/v1.3.2/Tailscale-SHA256SUMS.txt)。

已有电脑桥：将新版 ZIP 完整解压，再覆盖原桥文件夹里的同名程序文件。保留原 `runtime` 文件夹，现有配对、附件和工作文件都在那里。不要在压缩包内直接双击脚本。

## 第一步：电脑完成「这台设备」的授权

1. 安装 Windows Tailscale。已安装的直接从开始菜单打开。
2. 点击任务栏右下角的向上箭头，找到 Tailscale 图标。点击 **Log in / 登录**。
3. 在打开的浏览器页选择账号。**必须使用与你手机相同的 Tailscale 账号／私人网络**。
4. 如果网页询问是否连接这台设备，点击 **Connect / 连接** 或相应的确认按钮，直到显示设备连接成功。只进入 Machines 列表不算完成这台电脑的认证。
5. 回到右下角 Tailscale 图标，确认是 **Connected / 已连接**。如果看到 **Connect / 连接**，点它；如果仍显示 **Log in / 登录**，认证尚未完成。

公司或学校管理的账号可能需要管理员批准设备。此时先完成审批，不要删除设备或反复创建账号。

## 第二步：手机打开 VPN 连接开关

1. 打开 **Tailscale App**，登录与电脑相同的账号／私人网络。
2. 打开 Tailscale 连接开关。
3. Android 弹出「连接请求 / VPN」时点允许或确定。
4. 确认 Tailscale 页面显示 **Connected / 已连接**，通常状态栏也会显示 VPN 图标。
5. 在设备列表查看电脑是否在线。首次排查时让手机 Tailscale 保持前台，避免被省电机制暂停。

Android 通常只能同时使用一个 VPN。如果其他代理或加速器正在占用 VPN，请先停止，再连接 Tailscale。不要把 Pocket 排除在 Tailscale 的应用路由之外。

## 第三步：运行电脑桥配置向导

电脑双击解压目录里的 **`Setup-Remote.cmd`**。窗口应依次显示：

```text
1/4 检查 Tailscale
2/4 连接私人网络
3/4 启动后台电脑桥
4/4 配置仅限 Tailscale 的访问规则
```

- 停在第 2 步时，看窗口显示的实际状态，按下面的排障表处理。登录完成后会自动继续；若窗口已在等输入，按一次 Enter。
- 第 4 步 Windows 可能弹出「是否允许此应用对设备进行更改」。这是创建专用防火墙规则，点 **是**。取消时向导会报告配置未完成。
- 成功后窗口会显示 **电脑端准备完成**、一个以 `http://100.` 开头且以 `:15731` 结尾的地址，以及六位配对码，同时打开电脑本机配对页。
- 地址选择框应选中标有 **VPN 地址** 的那一项。

向导只给真实电脑桥的 Node 程序添加一条入站允许规则：TCP 15731、本机 Tailscale 网卡与地址、Tailscale 来源网段。不会关闭整个防火墙，不会设置公网端口映射，也不会修改出口节点或已有路由。

## 第四步：Pocket 填写电脑的地址

1. 手机打开 **Codex Pocket**。
2. 点左上角菜单 → 底部 **设置与配对**。
3. 在「电脑地址」填写向导显示的完整地址，格式是 **`http://100.x.x.x:15731`**。
4. 在「6 位配对码」填写电脑配对页当前显示的六位数字，点 **连接电脑**。
5. 看到「已连接」后，打开一条对话查看历史。

这里必须填写**电脑的 Tailscale 地址**，不能填手机的地址、`127.0.0.1`、网页管理后台地址或端口 `15732`。旧 Wi-Fi 地址在异地通常不可用，改用 Tailscale 地址即可。

同一电脑只是更改连接地址时，现有访问令牌可继续使用，无需先点清除配对；填写六位码也可以重新验证。不要卸载 Pocket。配对码过期只影响首次配对，不影响已经连接过的手机。

## 第五步：确认离开 Wi-Fi 也能用

1. 保持电脑联网。
2. 手机关闭 Wi-Fi，打开移动数据，确认手机 Tailscale 仍为已连接。
3. 回到 Pocket，等待它自动重连，点左侧历史刷新或打开对话确认同步。
4. 需要验证模型也可用时，自行发送一句消息；若出现等待时长，说明还需等待模型服务返回，不能仅凭等待时间判断 VPN 失败。

电脑向导完成，表示电脑侧设置完成；手机实际在移动数据／校园网下同步成功，才表示这条跨网络链路可用。

本次修复后，已在 Windows 电脑完成第 3、4 步并检查专用访问规则，用户确认手机切到移动数据后可同步。此结果不代表已覆盖所有手机或校园网。

## 以后每天怎么用

电脑首次双击一次 **`Enable-Background.cmd`**，以后登录 Windows 后会自动启动电脑桥和守护。电脑需开机、已经登录、保持唤醒，可以锁屏；重启后尚未登录 Windows 时，当前用户启动项还没有启动。

两端 Tailscale 保持在线，手机直接打开 Pocket 即可，无需每天重新配对或打开电脑 Codex 窗口。Android 可按需要允许 Tailscale 后台运行；若希望系统自动保持 VPN，可在手机系统 VPN 设置中寻找「始终开启 VPN」，各品牌入口不同。此设置会占用手机的 VPN。

## 常见状态与处理

| 提示或现象 | 含义 | 应该做什么 |
| --- | --- | --- |
| `NeedsLogin` | 电脑客户端没有完成认证 | 从电脑托盘点 Log in，完成这台设备的授权，然后回向导继续 |
| `NeedsMachineAuth` | 等待设备审批 | 在 Tailscale 管理页面批准设备，或联系该网络的管理员 |
| `Stopped` | 已有账号，但连接已停用 | 电脑托盘点击 Connect；手机也检查连接开关 |
| `Starting` | 正在建立连接 | 先等待；长时间不变时检查本机网络和客户端提示 |
| `Running` 但本机离线 | 已启用连接，但控制连接尚未恢复 | 检查电脑联网、校园网认证、客户端 Health 提示 |
| 网页有两台设备，Last seen 是过去时间 | 登记设备不等于实时在线 | 分别检查电脑托盘和手机 App 的 Connected 状态 |
| 旧版出现 `timeout waiting ... Running state` | 60 秒内没有连接完成，向导已退出 | 完成设备授权后重新运行新版 Setup-Remote.cmd；不是按「任意键」就会进入第 3 步 |
| 手机 Tailscale 登录了但仍离线 | VPN 开关未开、权限未允许或被别的 VPN 替换 | 开启连接并允许 Android VPN 提示，停用冲突的 VPN |
| 提示 JSON 对象无效、应为冒号或右大括号 | 旧脚本在 PowerShell 5.1 中错误解码中文账号名称 | 覆盖新版电脑桥，重新运行向导，无需改账号名称 |
| 第 4 步失败 | 权限被取消、端口未监听、规则被策略阻止等 | 重跑向导并允许权限；查看实际错误，不要关闭整个防火墙 |
| 两端在线，Pocket 仍连不上 | 地址／端口、入站阻止、VPN 访问策略等问题 | 用电脑的 `100.x` 地址与 15731；检查 Tailscale 的入站连接设置、管理员访问策略及 Windows 显式阻止规则 |

只想查看电脑状态，可在桥文件夹打开 PowerShell 执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Remote-Pocket.ps1 -StatusOnly
```

此命令只显示本机状态和地址，不会登录、修改规则或生成配对码。分享输出或截图前遮住账号、设备信息和认证链接。

## 校园网与撤销

先完成校园网自身认证。Tailscale 通常可以使用直连或 DERP 中继，但学校若阻止其登录、控制服务或 VPN，不保证可用。自定义 Headscale、地址池、组织策略和第三方防火墙可能需要单独配置。

`Remove-Remote.cmd` 仅移除 Pocket 创建的 Tailscale 防火墙规则，不退出 Tailscale 账号。`Disable-Background.cmd` 移除电脑桥启动项并停止守护检查，不中止正在运行的桥或任务。撤销这些设置不等于撤销已配对的手机凭据，参见 [隐私说明](../PRIVACY.md)。

参考：[Windows 安装](https://tailscale.com/docs/install/windows)、[连接类型](https://tailscale.com/docs/reference/connection-types)、[防火墙端口](https://tailscale.com/docs/reference/faq/firewall-ports)、[其他 VPN](https://tailscale.com/docs/reference/faq/other-vpns)、[tailscale up](https://tailscale.com/docs/reference/tailscale-cli/up)。
