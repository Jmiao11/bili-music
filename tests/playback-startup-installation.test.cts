const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const { test }: typeof import("node:test") = require("node:test");
const { collectBusinessScripts }: import("./helpers/module-graph.cts").Contract = require("./helpers/module-graph.cts");
const { loadNativeModules }: import("./helpers/native-module-loader.cts").Contract = require("./helpers/native-module-loader.cts");

test("startup installation sequence matches the playback G0 snapshot", async () => {
  const ui = path.join(__dirname, "../ui");
  const html = fs.readFileSync(path.join(ui, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)].flatMap((tag) => {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[1]);
    return src ? [{ file: src[1].replace(/^\.\//, ""), module: /\btype\s*=\s*["']module["']/i.test(tag[1]) }] : [];
  });
  const { files } = collectBusinessScripts(ui);
  const loaded = await loadNativeModules(ui, files, "app.ts", scripts);
  const sequence = loaded.events.map(({ stack, ...event }) => event);
  const firstTrackchange = sequence.findIndex((event) => event.action === "dispatch" && event.type === "bilibili-music-trackchange");
  const snapshot = { firstTrackchange, sequence };
  assert.ok(firstTrackchange >= 0);
  assert.deepEqual(snapshot, JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/playback-startup-installation.json"), "utf8")));
});
