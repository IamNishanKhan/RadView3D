# Tauri white-flash investigation

Research consulted on 2026-10-03 for the startup/dialog/picker flash issue.

- Tauri Dialog plugin documentation: https://v2.tauri.app/plugin/dialog/ — describes the plugin as native system dialogs for opening/saving files and message dialogs; it documents no per-dialog theme option.
- Tauri Rust `FileDialogBuilder` API: https://docs.rs/tauri-plugin-dialog/latest/tauri_plugin_dialog/struct.FileDialogBuilder.html — documented builder methods include directory, filename, parent, and pick operations; no theme setter is listed.
- Tauri config reference: https://v2.tauri.app/reference/config/ — `backgroundColor` applies to the window and webview; window `theme` accepts `Light`/`Dark` (Windows and macOS); `visible` defaults to true.
- Tauri WebView2 white startup flash issue: https://github.com/tauri-apps/tauri/issues/5170 — reports a known initial WebView2 white-window flash.

Implementation implication: keep one native window visible from creation to avoid a separate frontend-driven show transition. Retain the dark HTML background and matching native Dark window surface to minimize bright first paint without hide/show choreography. The hidden-window strategy adds an explicit permission and a second visibility stage; it is not being used. Use the plugin's official JavaScript `open({ directory: true, multiple: false, title })` API for the Windows-native folder picker to avoid the extra app-command/thread/channel hop. The native picker follows Windows appearance; the app cannot reliably override it through the documented Tauri dialog API.


## Follow-up findings — 2026-10-03

- Official Tauri core ACL reference: https://v2.tauri.app/reference/acl/core-permissions/ — `core:default` includes `core:window:default`; that window-default permission grants getters, not `show`. The hidden-window workaround needs the separate `core:window:allow-show` permission.
- Official Tauri dialog plugin docs: https://v2.tauri.app/plugin/dialog/ — JavaScript `open({ directory: true, multiple: false })` is the supported native directory picker API; plugin capability `dialog:default` grants `allow-open`.
- Official Rust API: https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html — builder has `on_page_load` callbacks for `PageLoadEvent::Started`/`Finished`.
- Tauri white-flash issue: https://github.com/tauri-apps/tauri/issues/5170 — WebView2 startup can expose an initial white frame; hiding until load is a common workaround, but reports note timing and runtime differences.
- Tauri slow dialog issue: https://github.com/tauri-apps/tauri/issues/6675 — reports platform-specific picker latency; commenters found explicitly providing a title and default path could improve it, though this is not a universal Windows guarantee.
