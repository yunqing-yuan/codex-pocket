<div align="center">
  <img src="resources/icon.png" width="96" alt="Codex Pocket icon" />
  <h1>Codex Pocket</h1>
  <p><strong>Your desktop conversations, within reach.</strong></p>
  <p><a href="https://github.com/yunqing-yuan/codex-pocket/releases">Download</a> · <a href="README.md">中文</a></p>
</div>

An independent **Android app and Windows desktop bridge** for continuing Codex conversations from your phone. Send messages and attachments, select available models and reasoning levels, and respond to synchronized approvals in the same desktop conversation.

Pocket uses the model service already configured on your computer, including compatible providers configured through cc-switch. The phone needs neither a separate OpenAI sign-in nor your model API key. A working Codex desktop installation and valid provider configuration are still required. No accounts, API credits, or hosted relay service are supplied.

This is an unofficial community project, not affiliated with or endorsed by OpenAI. The current release is a personal-use preview.

<p align="center">
  <img src="docs/screenshots/dao.png" width="23%" alt="Mountain theme" />
  <img src="docs/screenshots/stars.png" width="23%" alt="Stars theme" />
  <img src="docs/screenshots/chat.png" width="23%" alt="Built-in demo conversation" />
  <img src="docs/screenshots/themes.png" width="23%" alt="Theme selection" />
</p>

*Isolated renders of the app interface; conversations use built-in demo content. The current app UI is in Chinese.*

## Features

- A conversation-first interface with history and search in a side drawer.
- Messages from both devices in the same thread, delegated to the running desktop client.
- Synchronized command, file and permission approvals; task interruption.
- Up to 6 attachments per message, 20 MB each. Supported images become image inputs; documents are saved on the computer for its tools to read.
- Available models, reasoning levels and existing project folders read from the computer.
- Per-conversation drafts within the app session, reply copying and four themes.
- Android Keystore credential storage and no built-in analytics service.

## Install

Requirements: **Android 8+**, **Windows**, **Node.js 20/22 LTS**, and a working Codex desktop configuration.

1. Download `Codex-Pocket.apk` and `Codex-Pocket-Bridge.zip` from [Releases](https://github.com/yunqing-yuan/codex-pocket/releases).
2. Install the APK on your phone. Extract the **whole bridge ZIP** into a writable folder on the computer.
3. Install [Node.js](https://nodejs.org/) and open Codex. Confirm your desktop model service works first.
4. Run `Start-Pocket.cmd`. A local pairing page displays the computer address and a six-digit code.
5. On the same trusted network, open the app drawer → settings (设置与配对), enter the address and code, and connect.

Keep the computer awake and both Codex and the bridge running. Allow Node.js through Windows Firewall on the appropriate private network. To share the app, distribute the APK and the complete bridge ZIP; a launcher script alone is insufficient. Each user configures their own provider and pairs with their own computer. Never share an existing `runtime/` folder.

If connecting only works with Windows Firewall disabled, re-enable it, mark your own trusted Wi-Fi / phone hotspot as a **Private** network, and right-click `Fix-Firewall.cmd` → **Run as administrator**. The helper allows TCP 15731 only for the bridge's Node.js executable, Private networks and the local subnet. It reports existing Node.js block rules, which override allow rules. It does not change those blocks or create VPN rules. To remove its exception, run `Fix-Firewall.ps1 -Remove` from an elevated PowerShell.

## Privacy and transport

The phone communicates with your bridge, which communicates locally with Codex. Model keys remain in the computer's provider configuration. The app stores bridge credentials using Android Keystore and AES-GCM; app backup is disabled. Conversations and attachments sent to your model provider remain subject to that provider's policies.

The bridge listens on port `15731`; the pairing administration page is loopback-only on `127.0.0.1:15732`. **Default transport is HTTP, not encrypted. Use a trusted LAN or a private VPN; do not expose the bridge directly to the public internet.** A private VPN such as Tailscale can provide cross-network connectivity and must be configured separately.

The bridge stores its access token in `runtime/pairing.json` and attachments in `runtime/uploads/`. Attachments have no automatic retention limit. Disconnecting a phone does not revoke the server token; stop the bridge, remove its pairing file and restart to revoke all previously paired clients. These details and limitations are documented in [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Compatibility

- Android 8 / API 26 minimum, with a working System WebView. No iOS package.
- Windows is the supported distribution path. Full macOS/Linux workflows are unverified.
- Development used Codex Windows `26.917.9434.0`. Same-thread sending uses an internal desktop IPC protocol that may change with desktop updates.
- The `1.2.1` APK uses debug signing and is a preview, not a store release.
- No claim of exhaustive device testing or an independent security audit. Cross-network device usage has not been comprehensively validated.
- No built-in document parser, background push notifications, automatic public tunnel, or per-user access isolation.

## Build

The bridge only uses Node.js built-ins; run `node desktop.mjs` without installing npm dependencies.

For Android, install JDK 17 and Android SDK 34, configure `JAVA_HOME` and `ANDROID_HOME`, then:

```powershell
npm ci
npm run build
npx cap sync android
.\android\gradlew.bat -p android :app:assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. A locally generated signing key may prevent installing over the published APK. Uninstalling clears app data; use your own securely stored signing key for a production release.

See [development notes](docs/DEVELOPMENT.md), [setup and troubleshooting](docs/SETUP.md), [contributing](CONTRIBUTING.md) and [release notes](CHANGELOG.md). These detailed guides are currently in Chinese. Use [private vulnerability reporting](https://github.com/yunqing-yuan/codex-pocket/security/advisories/new) for security issues.

## License

Original source and artwork: [MIT](LICENSE). Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). Codex desktop, cc-switch, Node.js, provider credentials and personal runtime data are not redistributed.
