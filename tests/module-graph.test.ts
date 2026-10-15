import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectBusinessScripts } from "./helpers/module-graph.ts";

test("the entry and union retain the approved complete business file set", () => {
  const root = path.join(import.meta.dirname, "../ui");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const original = [...html.matchAll(/<script\b[^>]*\ssrc=["'](?:\.\/)?([^"']+)["'][^>]*>/g)].map((match) => fs.existsSync(path.join(root, match[1])) ? match[1] : match[1].replace(/\.js$/, ".ts"));
  const graph = collectBusinessScripts(root);
  assert.deepEqual(graph.entries, ["app.ts"]);
  assert.deepEqual(new Set(graph.files), new Set([...original, "root-mount.ts", "application-store.ts", "startup-platform.ts", "sidebar.ts", "mascot.ts", "lyrics.ts", "window-controls.ts", "dynamic-background.ts", "startup-before-main.ts", "playback-messages-state.ts", "playback-messages-view.ts", "playback-messages.ts", "mini-player-host.ts", "main-window-ready.ts", "playback-mini-view.ts", "playback-commands.ts", "playback-request-state.ts", "playback-session-state.ts", "playback-queue-state.ts", "playback-display-state.ts", "playback-display-view.ts", "playback-settings-state.ts", "media-adapter.ts", "playback-settings-view.ts", "settings-state.ts", "settings-adapter.ts", "settings-view.ts", "state-store.ts", "app-state.ts", "track-list-ui.ts", "track-list-view.ts", "home-view.ts", "search-state.ts", "search-view.ts", "library-state.ts", "library-view.ts", "focus-trap.ts", "pages-state.ts", "pages-view.ts", "page-selection.ts", "track-utils.ts", "runtime-api.ts", "player-dom.ts", "player-state.ts", "playback-policy.ts", "playback-notice.ts", "playback-diagnostics.ts", "home.ts", "library-ui.ts", "video-pages.ts", "search.ts", "playback-core.ts", "main.ts", "appearance.ts"]));
});

test("static module traversal collects recursive cyclic dependencies once", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-module-graph-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "index.html"), '<script src="./ordinary.js"></script><script type="module" src="app.js"></script>');
  fs.writeFileSync(path.join(root, "ordinary.js"), "const ordinary = true;");
  fs.writeFileSync(path.join(root, "app.js"), 'import "./a.js";');
  fs.writeFileSync(path.join(root, "a.js"), 'import { b } from "./b.js"; const a = 1; export { a };');
  fs.writeFileSync(path.join(root, "b.js"), 'import { a } from "./a.js"; const b = 2; export { b };');
  assert.deepEqual(collectBusinessScripts(root), {
    ordinary: ["ordinary.js"], entries: ["app.js"], modules: ["app.js", "a.js", "b.js"],
    files: ["ordinary.js", "app.js", "a.js", "b.js"],
  });
  fs.unlinkSync(path.join(root, "b.js"));
  assert.throws(() => collectBusinessScripts(root), /ENOENT.*b\.js/);
});
