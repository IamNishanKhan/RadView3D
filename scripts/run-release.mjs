import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const executable = process.platform === "win32"
  ? join("src-tauri", "target", "release", "radview3d.exe")
  : join("src-tauri", "target", "release", "radview3d");

if (!existsSync(executable)) {
  console.error(`Standalone executable not found: ${executable}`);
  console.error("Build it first with: npm run build:standalone");
  process.exit(1);
}

const child = spawn(executable, [], { stdio: "inherit" });
child.on("error", (error) => {
  console.error(`Could not start ${executable}: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Standalone application exited with signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
