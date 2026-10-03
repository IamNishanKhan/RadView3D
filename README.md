# RadView3D

Desktop CT + contour viewer for **Elekta/CMS Monaco** patient folders. v1 is Monaco only (no Varian, dose, or export).

Rust loads DICOM and `.WC` contours **once**. The UI (Vite + TypeScript + canvas) scrolls three orthogonal views in memory. Scroll never calls Rust.

On start the app opens `../Monaco/1~20230127` if that path exists. Use **Open folder** for another patient. Prefer `1~CT2` (real contours). `1~CT1` is CT with empty contour stubs.

## What a patient folder looks like

Open the patient directory (for example `1~20230127`), not a single `1~CTn` study. Each study is a subfolder:

```
1~20230127/
  1~CT1/
    DCMData/*.CT.DCM
    contournames
    T.<z>.WC
  1~CT2/
    ...
```

Images: `DCMData/*.CT.DCM` (preferred). Contours: `contournames` + `T.<z>.WC`. WC is matched to slices by filename Z (tolerance 0.11 mm). Axial mapping uses the Monaco Y-flip: `row = (-z_wc - y0) / dy`.

## Controls

- View mode: **All | Axial | Coronal | Sagittal** (keys `1`–`4`)
- Wheel or sliders on a pane
- Arrow keys / PageUp / PageDown on the last-clicked pane
- Structure checkboxes (empty templates are hidden)
- Window presets: Soft (40/400), Lung (−500/1400), Bone (500/2000)

Axial overlays are WC polylines. Coronal/sagittal overlays are outlines of the label volume (stepped look is expected).

---

## Prerequisites

Install these on the machine you build on.

### All platforms

- [Node.js](https://nodejs.org/) 18+ (20 or 24 is fine)
- [Rust](https://rustup.rs/) stable (`rustup` + `cargo`)
- npm (comes with Node)

```bash
npm install
```

### Ubuntu / Debian (build from source)

```bash
sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libgtk-3-dev \
  libayatana-appindicator3-dev patchelf nsis
```

`zenity` is used for **Open folder** on Linux (avoids a GTK/WebKit deadlock). It is normally already installed on Ubuntu Desktop:

```bash
sudo apt install zenity
```

### Windows (build from source)

- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (already on Windows 10/11)
- Visual Studio Build Tools with the **Desktop development with C++** workload (MSVC), **or** build the checked-in `release/RadView3D.exe` and skip compiling

---

## Run a prebuilt binary

If you have the `release/` folder from this tree:

**Linux**

```bash
chmod +x release/radview3d-linux
./release/radview3d-linux
```

**Windows**

Double-click `release/RadView3D.exe`, or:

```bat
release\RadView3D.exe
```

These are standalone apps (frontend is embedded). They do not need Node or a Vite server.

---

## Develop (live reload)

From the project root:

```bash
npm install
npm run tauri dev
```

That starts Vite on `http://localhost:1420` and a debug Tauri window. Do **not** pass `--features custom-protocol` here; the window must load the Vite URL.

Linux helper (only needed if system WebKit `-dev` packages are missing and you use a local header extract + `src-tauri/syslib`):

```bash
chmod +x dev.sh
./dev.sh
```

Loader-only check (no GUI):

```bash
cd src-tauri
cargo run -p radview_core --release --bin radview_verify -- /path/to/1~20230127
```

Expect CT2: 112 slices, 19 structures, ~1006 contour rings. Body contour anterior row should match the CT body (Y-flip).

---

## Build a release

`custom-protocol` embeds `dist/` into the binary so it does not need localhost.

### Linux (on Linux)

```bash
npm install
npm run build
cd src-tauri
cargo build --release --features custom-protocol
```

Binary: `src-tauri/target/release/radview3d`

Or:

```bash
chmod +x run-release.sh
./run-release.sh
```

If `npm run tauri build` fails with `ENOSPC` / inotify, use the `cargo build` path above. Raising `fs.inotify.max_user_watches` is optional.

Installable `.deb` (optional, needs the apt packages above):

```bash
npx tauri build --bundles deb
```

Output: `src-tauri/target/release/bundle/deb/`

### Windows (on Windows)

```bat
npm install
npm run build
cd src-tauri
cargo build --release --features custom-protocol
```

Binary: `src-tauri\target\release\radview3d.exe`

Installer (NSIS):

```bat
npx tauri build --bundles nsis
```

Output: `src-tauri\target\release\bundle\nsis\`

### Windows `.exe` from Linux (optional)

Needs `cargo-xwin`, the `x86_64-pc-windows-msvc` Rust target, `clang`/`lld`/`llvm-rc`, and NSIS. Then:

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm run build
cd src-tauri
cargo xwin build --release --target x86_64-pc-windows-msvc --features custom-protocol
```

Binary: `src-tauri/target/x86_64-pc-windows-msvc/release/radview3d.exe`

Do **not** apply the Linux `syslib` / `-fuse-ld=bfd` `RUSTFLAGS` to this target (they are already scoped to `x86_64-unknown-linux-gnu` in `src-tauri/.cargo/config.toml`).

---

## Layout

```
RadView3D/
  src/                 Vite + TypeScript UI (canvas)
  src-tauri/           Tauri app + radview_core loader
    radview_core/       DICOM, contournames, WC, raster, windowing
    src/lib.rs         IPC: list / load / rewindow / folder pick
  release/             Optional prebuilt Linux + Windows binaries
```

IPC: `list_patient_studies`, `load_study_json`, `get_volume_u8`, `get_labels_u8`, `rewindow`, `pick_patient_folder`. After load, the frontend holds `Uint8Array` volumes and never invokes Rust on scroll.

## Notes

- **Open folder on Ubuntu** uses `zenity`. Cancel the dialog is fine; the app should not freeze.
- `src-tauri/syslib/` is a local workaround for missing unversioned `.so` stubs. A normal `apt install libwebkit2gtk-4.1-dev` machine does not need it. You can delete the Linux-only `rustflags` in `src-tauri/.cargo/config.toml` if you have those `-dev` packages.
- Do not commit `node_modules/`, `dist/`, or `src-tauri/target/`.
