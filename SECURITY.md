# 安全说明 / Security

Codex Pocket 是个人使用预览工具。持有桥令牌的设备可以访问电脑端对话、上传文件、发起模型任务并响应审批；应把桥令牌视为电脑访问凭据。

## 当前边界

- API 默认监听 `0.0.0.0:15731`。常规 API 使用 Bearer 令牌，`POST /pair` 用一次性配对码换取令牌，`GET /download` 公开提供 APK。
- 配对管理页只监听 `127.0.0.1:15732`，并检查 Host 与 Origin。
- 配对码有效期 10 分钟，成功使用后更新；每个来源 IP 每分钟最多尝试 5 次。这不能替代网络隔离。
- HTTP 默认不加密。不要直接做公网端口映射；推荐可信局域网或配置好访问控制的私人 VPN。
- Android Keystore 保护手机上静态存储的凭据；电脑的配对文件使用本机文件权限保护，**没有额外加密**。Windows 上应使用自己的受保护用户目录和合适的文件 ACL。
- 一个桥共享一个长期令牌，没有单设备撤销、角色权限或独立用户隔离。
- 审批行为依赖电脑端实际提供的请求；手机不会凭空为电脑自动允许的操作新增审批。
- 同会话发送依赖桌面内部 IPC，兼容性不由公开稳定协议保证。
- 发布 APK 为 debug 构建，适合个人预览。它不具备正式生产签名流程和完整安全审计。

## 丢失设备或泄露令牌

1. 停止电脑桥；确认没有正在进行、需保留的任务。
2. 移除电脑桥的 `runtime/pairing.json`，或更换 `POCKET_BRIDGE_TOKEN`。
3. 重新启动桥，让可信设备重新配对。
4. 如同时泄露模型服务密钥，在对应服务商处撤销该密钥。仅更换配对码不会撤销旧令牌。

## 报告漏洞

请通过 GitHub 的 [私密漏洞报告](https://github.com/yunqing-yuan/codex-pocket/security/advisories/new) 提交复现步骤、影响范围和脱敏证据。不要在公开 Issue 中粘贴真实密钥或可直接利用的个人访问地址。当前维护对象为最新预览版本，不承诺固定响应时限。

Please report vulnerabilities through GitHub private vulnerability reporting. Do not post credentials or private conversation content in public issues. The latest preview is the current maintenance target; no response-time SLA is offered.
