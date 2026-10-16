import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sourceImports, testGroups } from "../scripts/tests/groups.ts";

test("test groups cover every test and before-install imports use only built-ins or local modules", () => {
  const groups = testGroups(path.resolve(import.meta.dirname, ".."));
  assert.ok(groups.before.includes("tests/typecheck.test.ts"));
  assert.deepEqual(groups.after, ["tests/dom/accent-color.dom.ts","tests/dom/controls-settings-characterization.dom.ts","tests/dom/dynamic-background.dom.ts","tests/dom/favorite-import.dom.ts","tests/dom/home-characterization.dom.ts","tests/dom/library-characterization.dom.ts","tests/dom/library-drag-null.dom.ts","tests/dom/library-lists-baseline.dom.ts","tests/dom/library-lists-characterization.dom.ts","tests/dom/library-lists-vue.dom.ts","tests/dom/library-loudness.dom.ts","tests/dom/library-modal-actions.dom.ts","tests/dom/library-modal-focus.dom.ts","tests/dom/library-modal-input.dom.ts","tests/dom/library-modal-inputs-vue.dom.ts","tests/dom/library-modal-render.dom.ts","tests/dom/library-modal-vue.dom.ts","tests/dom/mini-host-loading.dom.ts","tests/dom/mini-player-config.dom.ts","tests/dom/mini-snapshot.dom.ts","tests/dom/pages-characterization.dom.ts","tests/dom/pages-list.dom.ts","tests/dom/pages-null.dom.ts","tests/dom/pages-real-dom.dom.ts","tests/dom/pages-tab.dom.ts","tests/dom/pages-toggle.dom.ts","tests/dom/playback-startup-installation.dom.ts","tests/dom/playback-tree.dom.ts", "tests/dom/playback-ui-characterization.dom.ts","tests/dom/player-skip-video.dom.ts","tests/dom/real-module-startup.dom.ts","tests/dom/root-lists.dom.ts","tests/dom/root-shell.dom.ts","tests/dom/search-characterization.dom.ts","tests/dom/search-restore-characterization.dom.ts","tests/dom/settings-privacy.dom.ts","tests/dom/settings-source-values.dom.ts","tests/dom/shuffle-collection-settings.dom.ts","tests/dom/startup-classic-characterization.dom.ts","tests/dom/tracks-baseline.dom.ts","tests/dom/tracks-vue.dom.ts","tests/dom/vue-smoke.dom.ts"]);
  assert.equal(new Set([...groups.before, ...groups.after]).size, groups.before.length + groups.after.length);
});

test("test grouping rejects misplaced tests and transitive third-party imports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-test-groups-"));
  try {
    fs.mkdirSync(path.join(root, "tests/dom"), { recursive: true });
    fs.writeFileSync(path.join(root, "tests/dom/vue-smoke.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/pages-real-dom.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/pages-null.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/pages-list.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/pages-tab.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/pages-toggle.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/pages-characterization.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-modal-actions.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-modal-input.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-modal-focus.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-modal-inputs-vue.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-modal-render.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-characterization.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-drag-null.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/favorite-import.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-loudness.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-lists-characterization.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-lists-vue.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-lists-baseline.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/library-modal-vue.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/home-characterization.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/search-characterization.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/search-restore-characterization.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/tracks-baseline.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/tracks-vue.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/accent-color.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/dynamic-background.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/mini-host-loading.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/mini-player-config.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/mini-snapshot.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/playback-startup-installation.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/player-skip-video.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/real-module-startup.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/root-shell.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/settings-source-values.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/shuffle-collection-settings.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/startup-classic-characterization.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/root-lists.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/settings-privacy.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/controls-settings-characterization.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/playback-tree.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/playback-ui-characterization.dom.ts"), "");
    const testFile = path.join(root, "tests/sample.test.ts");
    fs.writeFileSync(testFile, 'import "./helper.ts";');
    const helper = path.join(root, "tests/helper.ts");
    fs.writeFileSync(helper, 'import "node:fs";');
    assert.doesNotThrow(() => testGroups(root));
    for (const source of ['import { ref } from "vue";', 'const module = import("jsdom");', 'export { ref } from "vue";']) {
      fs.writeFileSync(helper, source);
      assert.throws(() => testGroups(root), /Before-install third-party import/);
    }
    fs.writeFileSync(helper, "");
    fs.writeFileSync(path.join(root, "tests/dom/wrong.test.ts"), "");
    assert.throws(() => testGroups(root), /Ungrouped test/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("import scanner ignores quoted examples and comments", () => {
  assert.deepEqual(sourceImports('/* import "vue"; */\nconst example = \'import "vue";\';\nimport type { X } from "./x.ts";\nimport "node:fs";'), ["./x.ts", "node:fs"]);
});
