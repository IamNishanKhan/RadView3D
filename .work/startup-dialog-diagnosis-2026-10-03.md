# Startup flash and folder-picker diagnosis — 2026-10-03

## Verified findings

The startup flash has a documented WebView2 explanation below CSS/React. The Tauri window is visible at creation and already has `backgroundColor: "#0b0e12"`; `index.html` also paints the document dark inline before loading the app bundle. Microsoft documents that WebView2's default surface is white before content loads and that setting `DefaultBackgroundColor` through the later property setter can still permit a white flicker. The documented early initialization setting is `WEBVIEW2_DEFAULT_BACKGROUND_COLOR`, supplied as AARRGGBB before WebView2 initializes. I set `0xFF0B0E12` before the Tauri builder starts. This matches Microsoft's documented fix, but a rebuilt Windows executable still needs a launch test to confirm the user's frame is gone.

The folder-picker implementation did change during the React migration. `App.tsx` used to call a custom `pick_patient_folder` Rust command that called `DialogExt::pick_folder()` and delivered its result through a callback. The React version instead invoked the dialog plugin's JavaScript wrapper; that wrapper reaches Rust, where `commands::open` selects `blocking_pick_folder()` for a single directory. The previous route is restored now. This code-path change is verified, and the user reported the older flow as faster, so it is a reasonable regression candidate. However, it is not proven to be the measured latency cause: the plugin source itself recommends its blocking API for use from async contexts. A rebuilt-app timing comparison is still needed before claiming causality.

The current machine's WebView2 Runtime is 154.0.4258.53. Locked dependencies are Tauri 2.11.5, tauri-runtime-wry 2.11.4, Wry 0.55.1, Tao 0.35.3, and webview2-com 0.38.2. Wry's v0.52 release notes say WebView2 v137+ uses the newer default-background API, so the remaining white frame is consistent with the documented timing gap before the runtime property takes effect, not an obsolete installed runtime.

## Evidence and references

- Microsoft WebView2 `DefaultBackgroundColor` documentation describes the white default, the early environment variable, and its required eight-digit AARRGGBB format: https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2controller.defaultbackgroundcolor?view=webview2-dotnet-1.0.4129.50
- Current plugin `open` implementation chooses `blocking_pick_folder()` for one directory: https://docs.rs/tauri-plugin-dialog/2.7.3/src/tauri_plugin_dialog/commands.rs.html
- The plugin's desktop module exposes callback-based `pick_folder()` through `AsyncFileDialog`; its module documentation recommends blocking APIs for async contexts: https://docs.rs/tauri-plugin-dialog/2.7.3/src/tauri_plugin_dialog/desktop.rs.html
- Earlier RadView3D commit `51f8fd9` used Rust `DialogExt::pick_folder` via `pick_patient_folder`.
- Tauri window config/backgroundColor reference: https://v2.tauri.app/reference/config/
- Tauri WebView2 startup flash issue: https://github.com/tauri-apps/tauri/issues/5170
- Tauri/WebView background timing discussion: https://github.com/tauri-apps/tauri/issues/1564
- Wry v0.52 release note for the WebView2 v137+ background API: https://v2.tauri.app/release/wry/v0.52.0/
- Tauri dialog delay report #6675 (title/defaultPath suggestions are from a macOS report, not evidence specific to this Windows machine): https://github.com/tauri-apps/tauri/issues/6675

## Validation limitation

The frontend production build passes with `npm.cmd run build`. Native Rust compilation cannot currently be run from this device session: Cargo/rustc are not on PATH, and attempts to inspect the user Cargo binaries were denied by Windows permissions. The picker helper is restored from the repository's earlier implementation; the new Windows environment-variable setting and actual Windows native dialog timing require release-build and launch testing.
