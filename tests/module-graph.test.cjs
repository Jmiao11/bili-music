const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { collectBusinessScripts } = require("./helpers/module-graph.cjs");

test("the entry and union retain the approved complete business file set", () => {
  const root = path.join(__dirname, "../ui");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const original = [...html.matchAll(/<script\b[^>]*\ssrc=["'](?:\.\/)?([^"']+)["'][^>]*>/g)].map((match) => match[1]);
  const graph = collectBusinessScripts(root);
  assert.deepEqual(graph.entries, ["app.js"]);
  assert.deepEqual(new Set(graph.files), new Set([...original, "page-selection.ts", "track-utils.ts", "runtime-api.ts", "player-dom.ts", "player-state.ts", "playback-policy.ts", "playback-notice.js", "playback-diagnostics.js", "home.js", "library-ui.js", "video-pages.js", "search.js", "playback-core.js", "main.js", "appearance.js"]));
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
