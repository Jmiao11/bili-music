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
  assert.deepEqual(new Set(graph.files), new Set([...original, "app/root-controls.ts", "app/root-modals.ts", "app/root-modals.ts", "features/settings/root-settings.ts", "features/settings/settings-controls.ts", "platform/draft-ports.ts", "app/root-mount.ts", "features/playback/root-playback.ts", "store/application-store.ts", "features/tracks/root-lists.ts", "app/startup-platform.ts", "app/sidebar.ts", "app/mascot.ts", "features/immersive/lyrics.ts", "app/window-controls.ts", "features/settings/dynamic-background.ts", "app/startup-before-main.ts", "features/immersive/lyrics-display-state.ts", "features/playback/playback-messages-state.ts", "features/playback/playback-messages.ts", "mini/mini-player-host.ts", "app/main-window-ready.ts", "mini/mini-player-projection.ts", "features/playback/playback-commands.ts", "features/playback/playback-request-state.ts", "features/playback/playback-session-state.ts", "features/playback/playback-queue-state.ts", "features/playback/playback-display-state.ts", "features/playback/playback-display-view.ts", "features/playback/playback-settings-state.ts", "platform/media-adapter.ts", "features/playback/playback-settings-view.ts", "features/settings/settings-state.ts", "features/settings/settings-adapter.ts", "features/settings/settings-view.ts", "store/state-store.ts", "store/app-state.ts", "features/tracks/track-list-ui.ts", "features/home/home-view.ts", "features/search/search-state.ts", "features/search/search-view.ts", "features/library/library-state.ts", "features/library/library-view.ts", "shared/focus-trap.ts", "features/pages/pages-state.ts", "features/pages/pages-view.ts", "features/pages/page-selection.ts", "shared/track-utils.ts", "platform/runtime-api.ts", "platform/main-window-dom.ts", "shared/controller-runtime.ts", "features/playback/playback-policy.ts", "features/playback/playback-notice.ts", "features/playback/playback-diagnostics.ts", "features/home/home.ts", "features/library/library-ui.ts", "features/pages/video-pages.ts", "features/search/search.ts", "features/playback/playback-core.ts", "app/main.ts", "features/settings/appearance.ts"]));
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
