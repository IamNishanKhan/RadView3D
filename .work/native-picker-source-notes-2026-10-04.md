# Native picker source notes (2026-10-04)

## Official `tauri-plugin-dialog` 2.7.3 implementation

Sources:
- https://docs.rs/tauri-plugin-dialog/2.7.3/src/tauri_plugin_dialog/commands.rs.html
- https://docs.rs/tauri-plugin-dialog/2.7.3/src/tauri_plugin_dialog/desktop.rs.html
- https://docs.rs/tauri-plugin-dialog/2.7.3/src/tauri_plugin_dialog/lib.rs.html

Verified details:
- The built-in `open` command receives the invoking `Window` and calls `dialog.file().set_parent(&window)` on Windows/macOS before configuring the dialog (`commands.rs`, around lines 121–132).
- The built-in directory-open branch uses `blocking_pick_folder()` and returns the selected path (`commands.rs`, around lines 152–183).
- The callback API uses `run_on_main_thread`, creates an `AsyncFileDialog`, and spawns a thread to `block_on` the picker result (`desktop.rs`, around lines 172–181).
- `FileDialogBuilder::set_parent` captures the parent’s raw window and display handles (`lib.rs`, around lines 466–484).
