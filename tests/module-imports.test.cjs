const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { collectBusinessScripts } = require("./helpers/module-graph.cjs");
const { moduleDeclarations } = require("./helpers/module-syntax.cjs");
const { topLevelNames, references } = require("./helpers/module-bindings.cjs");
const { maskCommentsAndStrings } = require("./helpers/js-source.cjs");

const moduleOrder = ["page-selection.js", "track-utils.js", "runtime-api.js", "player-dom.js", "player-state.js", "playback-policy.js", "playback-notice.js", "playback-diagnostics.js", "home.js", "library-ui.js", "video-pages.js", "search.js", "main.js", "appearance.js"];

// Every collision was inspected: all occurrences resolve to these local bindings.
const localCollisions = new Map([
  ["track-utils.js:result", "unavailableTrackLocations local Map"],
  ["playback-policy.js:result", "shuffled local array"],
  ["home.js:title", "showHomeNotice parameter"],
  ["library-ui.js:result", "toggle, purge and favorite-import local results"],
  ["library-ui.js:title", "openLibraryModal parameter and purge row local element"],
  ["video-pages.js:currentTrack", "openPagesModal local currentPlayableTrack result"],
  ["appearance.js:status", "refreshYtDlpAvailability local response"],
  ["appearance.js:result", "testAiConnection and import button local responses"],
]);

test("modules import every cross-module binding and have no unused imports", () => {
  const ui = path.join(__dirname, "../ui");
  const { modules } = collectBusinessScripts(ui);
  const sources = new Map(modules.map((file) => [file, fs.readFileSync(path.join(ui, file), "utf8")]));
  const owners = new Map();
  for (const [file, source] of sources) {
    for (const name of topLevelNames(source)) {
      assert.ok(!owners.has(name), `duplicate ${name}`);
      owners.set(name, file);
    }
  }
  for (const [file, source] of sources) {
    const declarations = moduleDeclarations(source);
    const imports = declarations.filter((item) => item.kind === "import");
    const providers = imports.map((item) => moduleOrder.indexOf(item.specifier.slice(2)));
    assert.ok(providers.every((index) => index >= 0), `${file}: known relative provider`);
    assert.deepEqual(providers, [...providers].sort((a, b) => a - b), `${file}: original script import order`);
    const imported = new Set(imports.flatMap((item) => item.names));
    const used = references(source);
    for (const name of used) {
      if (!owners.has(name) || owners.get(name) === file || localCollisions.has(`${file}:${name}`)) continue;
      assert.ok(imported.has(name), `${file}: missing import ${name} from ${owners.get(name)}`);
    }
    for (const item of imports) {
      assert.deepEqual(item.names, [...item.names].sort(), `${file}: sorted import names`);
      for (const name of item.names) {
        assert.equal(owners.get(name), item.specifier.slice(2), `${file}: owner of ${name}`);
        assert.ok(used.has(name), `${file}: unused import ${name}`);
      }
    }
    const exports = declarations.filter((item) => item.kind === "export");
    const consumers = [...sources].flatMap(([, other]) => moduleDeclarations(other)
      .filter((item) => item.kind === "import" && item.specifier === `./${file}`).flatMap((item) => item.names));
    if (file !== "app.js") {
      assert.equal(exports.length, 1, `${file}: sole export list`);
      assert.deepEqual(exports[0].names, [...new Set(consumers)].sort(), `${file}: export only used names`);
    }
  }
  for (const [collision, reason] of localCollisions) {
    const [file, name] = collision.split(":");
    assert.ok(references(sources.get(file)).has(name), `${collision}: stale collision entry (${reason})`);
    const code = maskCommentsAndStrings(sources.get(file));
    const binding = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b|\\bfunction\\s+[\\w$]+\\s*\\([^)]*\\b${name}\\b[^)]*\\)`);
    assert.match(code, binding, `${collision}: reviewed local binding must remain`);
  }
});
