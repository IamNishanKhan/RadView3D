#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# User-local GTK/WebKit headers (when system -dev packages are not installed)
if [[ -d "$HOME/.local/tauri-sys/usr/lib/x86_64-linux-gnu/pkgconfig" ]]; then
  export PKG_CONFIG_PATH="$HOME/.local/tauri-sys/usr/lib/x86_64-linux-gnu/pkgconfig:$HOME/.local/tauri-sys/usr/share/pkgconfig:${PKG_CONFIG_PATH:-}"
  unset PKG_CONFIG_SYSROOT_DIR
fi
# rust-lld cannot find unversioned GTK/WebKit stubs; GNU ld.bfd + syslib works.
export RUSTFLAGS="-C link-arg=-fuse-ld=bfd -C link-arg=-L$(pwd)/src-tauri/syslib -C link-arg=-Wl,-rpath,/usr/lib/x86_64-linux-gnu"
source "$HOME/.cargo/env" 2>/dev/null || true
# `tauri dev` must NOT enable custom-protocol (it loads the Vite URL).
# `tauri build` / cargo --features custom-protocol embeds dist/.
npm run tauri dev
