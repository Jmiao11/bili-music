const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { collectBusinessScripts } = require("./helpers/module-graph.cjs");
const { loadNativeModules } = require("./helpers/native-module-loader.cjs");

test("startup installation sequence matches the playback G0 snapshot", async () => {
  const ui = path.join(__dirname, "../ui");
  const html = fs.readFileSync(path.join(ui, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)].flatMap((tag) => {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[1]);
    return src ? [{ file: src[1].replace(/^\.\//, ""), module: /\btype\s*=\s*["']module["']/i.test(tag[1]) }] : [];
  });
  const { files } = collectBusinessScripts(ui);
  const loaded = await loadNativeModules(ui, files, "app.js", scripts);
  const sequence = loaded.events.map(({ stack, ...event }) => event);
  const firstTrackchange = sequence.findIndex((event) => event.action === "dispatch" && event.type === "bilibili-music-trackchange");
  const snapshot = { firstTrackchange, sequence };
  assert.ok(firstTrackchange >= 0);
  assert.deepEqual(snapshot, JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/playback-startup-installation.json"), "utf8")));
});
