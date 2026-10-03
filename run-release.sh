#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -d "$HOME/.local/tauri-sys/usr/lib/x86_64-linux-gnu/pkgconfig" ]]; then
  export PKG_CONFIG_PATH="$HOME/.local/tauri-sys/usr/lib/x86_64-linux-gnu/pkgconfig:$HOME/.local/tauri-sys/usr/share/pkgconfig:${PKG_CONFIG_PATH:-}"
  unset PKG_CONFIG_SYSROOT_DIR
fi
export RUSTFLAGS="-C link-arg=-fuse-ld=bfd -C link-arg=-L$(pwd)/src-tauri/syslib -C link-arg=-Wl,-rpath,/usr/lib/x86_64-linux-gnu"
source "$HOME/.cargo/env" 2>/dev/null || true
npm run build
(
  cd src-tauri
  cargo build --release --features custom-protocol
)
exec src-tauri/target/release/radview3d
