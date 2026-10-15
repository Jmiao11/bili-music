import assert from "node:assert/strict";
import * as fs from "./helpers/typescript-source.ts";
import path from "node:path";
import { test } from "node:test";
import { collectBusinessScripts } from "./helpers/module-graph.ts";
import { moduleDeclarations } from "./helpers/module-syntax.ts";
import { topLevelNames, references } from "./helpers/module-bindings.ts";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";
import { vueRendererImports } from "./helpers/vue-renderer-boundary.ts";

const moduleOrder = ["root-mount.ts", "components/App.vue", "root-playback.ts", "vue", "sidebar.ts", "startup-platform.ts", "application-store.ts", "root-lists.ts","window-controls.ts", "dynamic-background.ts", "startup-before-main.ts", "mascot.ts", "lyrics-display-state.ts", "playback-messages-state.ts", "playback-commands.ts", "playback-request-state.ts", "playback-session-state.ts", "playback-queue-state.ts", "playback-display-state.ts","playback-settings-state.ts","media-adapter.ts","settings-state.ts","settings-adapter.ts","pages-state.ts","state-store.ts","app-state.ts","page-selection.ts","track-utils.ts","search-state.ts","library-state.ts","runtime-api.ts","player-dom.ts","components/PagesList.vue","components/LibraryModalBody.vue", "components/PlaylistList.vue", "components/TrackList.vue", "components/TrackRow.vue","vue/sync-region.ts","player-state.ts","playback-policy.ts","playback-notice.ts","playback-diagnostics.ts","track-list-model.ts", "track-list-ui.ts", "home-view.ts","home.ts","focus-trap.ts","pages-view.ts","library-view.ts","library-ui.ts","video-pages.ts","search-view.ts","search.ts","playback-core.ts","main.ts","settings-view.ts","playback-settings-view.ts","playback-display-view.ts","appearance.ts", "playback-mini-view.ts", "lyrics.ts", "mini-player-host.ts", "main-window-ready.ts", "playback-messages-view.ts", "playback-messages.ts"];

// Every collision was inspected: all occurrences resolve to these local bindings.
const localCollisions = new Map([
  ["home.ts:render", "local legacy subscriber or display renderer"],
  ["search.ts:render", "local legacy subscriber or display renderer"],
  ["library-ui.ts:render", "local legacy subscriber or display renderer"],
  ["video-pages.ts:render", "local legacy subscriber or display renderer"],
  ["appearance.ts:render", "local legacy subscriber or display renderer"],
  ["lyrics.ts:render", "local legacy subscriber or display renderer"],

  ["sidebar.ts:root", "document root local to sidebar initialization"],
  ["sidebar.ts:render", "sidebar geometry projection local to initialization"],
  ["application-store.ts:renderRoot", "injected root render callback"],
  ["home.ts:applicationStore", "shared composition store read inside the home getter"],
  ["mini-player-host.ts:audio", "local media event target in host controller"],
  ["appearance.ts:mascotApi", "local initialized mascot API in picker renderer"],
  ["mascot.ts:audio", "local media node inside mascot initializer"],
  ["lyrics.ts:formatDuration", "local lyrics duration formatter inside initializer"],
  ["lyrics.ts:status", "local lyrics resolution status inside initializer"],
  ["lyrics.ts:result", "local search and lyrics command results inside initializer"],
  ["lyrics.ts:invoke", "local Tauri command adapter inside initializer"],
  ["lyrics.ts:audio", "local audio node inside initializer"],
  ["dynamic-background.ts:root", "local document root inside initializer"],
  ["playback-queue-state.ts:result", "shuffled local array"],
  ["settings-state.ts:result", "local command and redaction results"],
  ["settings-state.ts:source", "stream source parameter and response"],
  ["library-state.ts:title", "open modal title parameter"],
  ["library-state.ts:result", "local command/validation results"],
  ["library-view.ts:libraryState", "readonly render function snapshot parameter"],
  ["track-utils.ts:result", "unavailableTrackLocations local Map"],
  ["home-view.ts:title", "showHomeNotice parameter"],
  ["library-ui.ts:result", "toggle, purge and favorite-import local results"],
  ["pages-view.ts:currentTrack", "renderPagesModal readonly player projection"],
  ["appearance.ts:result", "testAiConnection and import button local responses"],
]);

test("modules import every cross-module binding and have no unused imports", () => {
  const ui = path.join(import.meta.dirname, "../ui");
  const { modules } = collectBusinessScripts(ui);
  const sources = new Map(modules.map((file) => [file, fs.readFileSync(path.join(ui, file), "utf8")]));
  const owners = new Map(vueRendererImports.flatMap(entry => entry.name.split(",").map(name => [name.trim(), entry.specifier.startsWith("./") ? entry.specifier.slice(2) : entry.specifier])));
  for (const [file, source] of sources) {
    for (const name of topLevelNames(source, "source.js", "ui/" + file)) {
      assert.ok(!owners.has(name), `duplicate ${name}`);
      owners.set(name, file);
    }
  }
  for (const [file, source] of sources) {
    const declarations = moduleDeclarations(source, "source.js", "ui/" + file);
    const imports = declarations.filter((item) => item.kind === "import");
    const providers = imports.map((item) => moduleOrder.indexOf((item.specifier.startsWith("./") ? item.specifier.slice(2) : item.specifier)));
    assert.ok(providers.every((index) => index >= 0), `${file}: known relative provider`);
    assert.deepEqual(providers, [...providers].sort((a, b) => a - b), `${file}: original script import order`);
    const imported = new Set(imports.flatMap((item) => item.names));
    const used = references(source, "source.js", "ui/" + file);
    for (const name of used) {
      if (!owners.has(name) || owners.get(name) === file || localCollisions.has(`${file}:${name}`)) continue;
      assert.ok(imported.has(name), `${file}: missing import ${name} from ${owners.get(name)}`);
    }
    for (const item of imports) {
      assert.deepEqual(item.names, [...item.names].sort(), `${file}: sorted import names`);
      for (const name of item.names) {
        assert.equal(owners.get(name), (item.specifier.startsWith("./") ? item.specifier.slice(2) : item.specifier), `${file}: owner of ${name}`);
        assert.ok(used.has(name), `${file}: unused import ${name}`);
      }
    }
    const exports = declarations.filter((item) => item.kind === "export");
    const consumers = [...sources].flatMap(([otherFile, other]) => moduleDeclarations(other, "source.js", "ui/" + otherFile)
      .filter((item) => item.kind === "import" && item.specifier === `./${file}`).flatMap((item) => item.names));
    if (file === "video-pages.ts") consumers.push("bindTrackActivation");
    if (file === "application-store.ts") consumers.push("createRootStore");
    if (file === "playback-display-view.ts") consumers.push("projectPlaybackProgress");
    if (file !== "app.ts") {
      assert.equal(exports.length, 1, `${file}: sole export list`);
      assert.deepEqual(exports[0].names, [...new Set(consumers)].sort(), `${file}: export only used names`);
    }
  }
  for (const [collision, reason] of localCollisions) {
    const [file, name] = collision.split(":");
    const source = sources.get(file);
    if (source === undefined) throw new Error(`Collision source is missing: ${file}`);
    assert.ok(references(source, "source.js", "ui/" + file).has(name), `${collision}: stale collision entry (${reason})`);
    const code = maskCommentsAndStrings(source);
    const binding = new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b|\\bfunction\\s+[\\w$]+\\s*\\([^)]*\\b${name}\\b[^)]*\\)`);
    assert.match(code, binding, `${collision}: reviewed local binding must remain`);
  }
});
