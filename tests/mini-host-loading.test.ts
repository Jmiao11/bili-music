import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { collectBusinessScripts } from "./helpers/module-graph.ts";
import { loadNativeModules } from "./helpers/native-module-loader.ts";

test("mini host classic installation matches G0 and an ESM loading candidate preserves order", async () => {
  const ui = path.join(import.meta.dirname, "../ui"), html = fs.readFileSync(path.join(ui, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)].flatMap(tag => {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[1]);
    return src ? [{ file: src[1].replace(/^\.\//, ""), module: /\btype\s*=\s*["']module["']/i.test(tag[1]) }] : [];
  });
  const { files } = collectBusinessScripts(ui);
  const candidate = scripts.map(script => script.file === "mini-player-host.js" ? { file: "mini-player-host.ts", module: true } : script);
  const after = await loadNativeModules(ui, files, "app.ts", candidate);
  const sequence = after.events.map(({ stack, ...event }) => event);
  assert.deepEqual(sequence, JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/playback-startup-installation.json"), "utf8")).sequence);
  assert.equal(sequence.length, 157);
  assert.equal(sequence.findIndex(event => event.action === "dispatch" && event.type === "bilibili-music-trackchange"), 70);
  const installs = after.events.filter(event => /mini-player-host\.ts:/.test(String(event.stack))).map(({ stack, ...event }) => event);
  assert.deepEqual(installs, [{ action: "listen", target: "window", type: "beforeunload", options: { once: true } }]);
});
