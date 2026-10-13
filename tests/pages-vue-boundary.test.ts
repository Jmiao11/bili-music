import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";
import { collectBusinessScripts } from "./helpers/module-graph.ts";
import { moduleDeclarations, stripModuleSyntax } from "./helpers/module-syntax.ts";
import { installColdRendererBoundary, takeColdRendererAttempts, vueRendererImports } from "./helpers/vue-renderer-boundary.ts";

test("pages renderer imports have two exact compiler boundaries without relaxing other module grammar", () => {
  assert.deepEqual(vueRendererImports.map(entry => [entry.file, entry.specifier, entry.name]), [["track-list-view.ts", "./components/PlaylistList.vue", "PlaylistList"], ["components/TrackList.vue", "./TrackRow.vue", "TrackRow"], ["track-list-view.ts", "./components/TrackList.vue", "TrackList"], ["track-list-view.ts", "./vue/sync-region.ts", "createSyncRegion"], ["pages-view.ts", "./components/PagesList.vue", "PagesList"], ["pages-view.ts", "./vue/sync-region.ts", "createSyncRegion"], ["library-view.ts", "./components/LibraryModalBody.vue", "LibraryModalBody"], ["library-view.ts", "./vue/sync-region.ts", "createSyncRegion"]]);
  const ui = path.join(import.meta.dirname, "../ui");
  const graph = collectBusinessScripts(ui);
  assert.deepEqual(graph.rendererFiles, ["components/PlaylistList.vue", "components/TrackList.vue", "vue/sync-region.ts", "components/PagesList.vue", "components/LibraryModalBody.vue"]);
  for (const file of graph.rendererFiles ?? []) assert.ok(fs.existsSync(path.join(ui, file)));
  assert.deepEqual(fs.readdirSync(path.join(import.meta.dirname, "../ui/components")), ["LibraryModalBody.vue", "PagesList.vue", "PlaylistList.vue", "TrackList.vue", "TrackRow.vue"]);
  const component = fs.readFileSync(path.join(ui, "components/PagesList.vue"), "utf8");
  assert.doesNotMatch(maskCommentsAndStrings(component), /\b(?:window|__TAURI__|invoke|actions)\b/);
  for (const entry of vueRendererImports) {
    assert.equal(moduleDeclarations(entry.declaration, "ui/" + entry.file)[0].specifier, entry.specifier);
    if (entry.name === "PagesList") {
      assert.throws(() => stripModuleSyntax(entry.declaration, "ui/app.ts"), /Unsupported module syntax/);
      assert.throws(() => stripModuleSyntax(entry.declaration.replace("PagesList from", "Other from"), "ui/pages-view.ts"), /Unsupported module syntax/);
      assert.throws(() => stripModuleSyntax(entry.declaration.replace("PagesList.vue", "Other.vue"), "ui/pages-view.ts"), /Unsupported module syntax/);
    }
  }
});

test("installation-free cold entry boundary rejects any attempt to create a Vue region", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-native-esm-boundary-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(root, "pages-view.ts"), vueRendererImports.filter(entry => entry.file === "pages-view.ts").map(entry => entry.declaration).join("\n") + "\nexport { PagesList, createSyncRegion };");
  installColdRendererBoundary();
  const namespace = await import(pathToFileURL(path.join(root, "pages-view.ts")).href);
  assert.throws(() => namespace.createSyncRegion({}, namespace.PagesList), /Cold test attempted to create a Vue region/);
  assert.equal(takeColdRendererAttempts(), 1);
});
