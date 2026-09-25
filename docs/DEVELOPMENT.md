# 开发与配置

## 本地开发

手机界面为 HTML/CSS/JavaScript，通过 Capacitor 6 打包。Android 原生插件负责输入与系统栏适配、剪贴板和 Keystore 凭据存储。电脑桥使用 Node.js 内置模块。

```powershell
npm ci
npm run dev
```

开发预览默认端口 `4178`；在设置里选择「先体验演示对话」，可以查看不发送网络请求的演示交互。预览服务器仅用于开发，请勿公开部署为生产服务。

构建 Android：

```powershell
npm run build
npx cap sync android
.\android\gradlew.bat -p android :app:assembleDebug
```

前置条件：JDK 17、Android SDK 34、Build Tools 34.0.0、可用的 Android SDK 许可证和网络。Gradle wrapper 为 8.2.1。`cap sync` 会生成未入库的 Cordova/Capacitor 文件；直接跳过此步运行 Gradle 可能缺少依赖工程。

可通过 Android Studio 配置 SDK，或在本机 `android/local.properties` 设置 `sdk.dir`。该文件被 Git 忽略，不要提交个人绝对路径或签名配置。

## 电脑桥环境变量

| 变量 | 默认 / 含义 |
| --- | --- |
| `CODEX_BIN` | 自动查找本机 Codex 可执行文件；可指定绝对路径 |
| `CODEX_HOME` | Codex 自身的配置目录；未设置时沿用本机默认 |
| `POCKET_BRIDGE_HOST` | `0.0.0.0`，API 监听地址 |
| `POCKET_BRIDGE_PORT` | `15731`，API 端口 |
| `POCKET_PANEL_PORT` | `15732`，本机配对页端口 |
| `POCKET_BRIDGE_RUNTIME_DIR` | 桥旁的 `runtime/`，令牌及运行数据目录 |
| `POCKET_BRIDGE_TOKEN` | 可选；覆盖自动生成的桥令牌，应自行生成高强度随机值 |
| `POCKET_BRIDGE_ALLOWED_ORIGINS` | 可选，逗号分隔的浏览器 Origin 列表；CORS 不代替鉴权或防火墙 |
| `POCKET_DESKTOP_PIPE` | 本机桌面 IPC 地址覆盖，主要用于协议适配 |
| `PORT` | 开发预览服务器端口，默认 `4178` |
| `POCKET_BROWSER` | 图标生成用 Chromium/Edge 路径，供 `resources/generate-icons.mjs` 使用 |

更改端口或运行目录时，直接从同一终端运行 `node desktop.mjs`。Windows 的启动/重启便利脚本按默认端口和默认 `runtime/` 设计，不能保证跟随全部自定义配置。

## 桌面集成

桥通过独立的 `codex app-server --listen stdio://` 进程读取会话、模型和项目；同会话发送交给运行中的桌面客户端所有者，通过本机 IPC 跟随状态并转发审批。

内部协议适配集中在 `bridge/desktop-ipc.mjs`。它不是稳定的公开 API，桌面版本变化可能导致消息、审批或状态订阅失效。处理兼容性问题时请记录版本和脱敏错误，避免复制桌面应用包、提取的客户端源码或私人会话数据到本仓库。

新会话在第一条真实消息前保留 app-server 写入所有权，因为 rollout 尚未落盘。后台通过 `turn/start` 执行，在 `turn/completed` 后释放；已有桌面所有者时用 IPC 转发。没有所有者时恢复到后台引擎；从不调用 `codex://` 自动打开会话。缺失记录文件的旧会话返回明确错误，手机可将草稿带入新会话。

作品 API 使用与聊天相同的鉴权，只读取项目内被回复或文件修改明确引用的允许格式文件。HTML 本地资源经过实际路径限制。Android 在没有 Capacitor 或原生 JavaScript 接口的独立 WebView 中预览，并禁止网络、文件访问和导航；开发预览使用无同源权限的 iframe，两者均附加 CSP 网络限制。

## 发布材料

只发布源码、文档、原始图标以及干净构建产物。`runtime/`、`.toolchain/`、`node_modules/`、`dist/`、浏览器用户目录、签名私钥、SDK 路径和私人截图不入库。发布 ZIP 仅包含桥及其依赖文件、使用文档、许可证和可选 APK。

`1.3.0` 为 debug 签名的预览包。正式分发需要独立安全保存的签名密钥与可复现的构建流程；密钥不能进入 Git。当前仓库没有宣称通过的自动化测试套件。
