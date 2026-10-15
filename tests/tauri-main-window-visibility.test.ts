import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("Tauri config guard requires hidden main windows without changing other platform overrides", t => {
  const project = path.resolve(import.meta.dirname, ".."), root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-hidden-window-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts")); fs.mkdirSync(path.join(root, "src-tauri"));
  fs.copyFileSync(path.join(project, "scripts/check-tauri-window-config.ts"), path.join(root, "scripts/check-tauri-window-config.ts"));
  const main = JSON.parse(fs.readFileSync(path.join(project, "src-tauri/tauri.conf.json"), "utf8"));
  const mac = JSON.parse(fs.readFileSync(path.join(project, "src-tauri/tauri.macos.conf.json"), "utf8"));
  const run = () => {
    fs.writeFileSync(path.join(root, "src-tauri/tauri.conf.json"), JSON.stringify(main));
    fs.writeFileSync(path.join(root, "src-tauri/tauri.macos.conf.json"), JSON.stringify(mac));
    return spawnSync(process.execPath, [path.join(root, "scripts/check-tauri-window-config.ts")], { encoding: "utf8" });
  };
  assert.equal(run().status, 0);
  main.app.windows[0].visible = true;
  assert.notEqual(run().status, 0);
  main.app.windows[0].visible = false; mac.app.windows[0].visible = true;
  assert.notEqual(run().status, 0);
  delete mac.app.windows[0].visible;
  assert.notEqual(run().status, 0);
});
