# Third-party notices

Original Codex Pocket code and artwork are MIT licensed. Third-party components retain their own licenses.

| Component | Use | License / source |
| --- | --- | --- |
| Capacitor 6 (Ionic / Drifty Co.) | Android runtime and app packaging | MIT; [included text](docs/licenses/Capacitor-MIT.txt), [source](https://github.com/ionic-team/capacitor) |
| Gradle wrapper 8.2.1 | Android build bootstrap | Apache-2.0; [included license](docs/licenses/Gradle-LICENSE.txt), [upstream notice](docs/licenses/Gradle-NOTICE.txt), [source](https://github.com/gradle/gradle) |
| AndroidX | Android UI and platform integration | Apache-2.0; [license](docs/licenses/Apache-2.0.txt), [source](https://android.googlesource.com/platform/frameworks/support/) |
| Apache Cordova framework used by Capacitor | Android compatibility integration | Apache-2.0; [license](docs/licenses/Apache-2.0.txt), [source](https://github.com/apache/cordova-android) |
| Playwright Core | Development-only rendering and icon generation | Apache-2.0; [source](https://github.com/microsoft/playwright) |
| TypeScript | Development tooling | Apache-2.0; [source](https://github.com/microsoft/TypeScript) |

The Android build can include additional transitive libraries. Their upstream license metadata remains authoritative; inspect Gradle dependency metadata when changing the dependency set. npm dependency versions and metadata are recorded in `package-lock.json`. The notices and license texts accompany the APK in the bridge ZIP and this repository.

The full Gradle distribution is not bundled; its upstream NOTICE is included for attribution. Node.js, the Codex desktop client, cc-switch and model services are external prerequisites and are not redistributed by this repository or the bridge ZIP. Their names identify interoperability and do not imply endorsement.
