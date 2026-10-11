import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sourceImports, testGroups } from "../scripts/tests/groups.ts";

test("test groups cover every test and before-install imports use only built-ins or local modules", () => {
  const groups = testGroups(path.resolve(import.meta.dirname, ".."));
  assert.ok(groups.before.includes("tests/typecheck.test.ts"));
  assert.deepEqual(groups.after, ["tests/dom/pages-characterization.dom.ts", "tests/dom/pages-real-dom.dom.ts", "tests/dom/vue-smoke.dom.ts"]);
  assert.equal(new Set([...groups.before, ...groups.after]).size, groups.before.length + groups.after.length);
});

test("test grouping rejects misplaced tests and transitive third-party imports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-test-groups-"));
  try {
    fs.mkdirSync(path.join(root, "tests/dom"), { recursive: true });
    fs.writeFileSync(path.join(root, "tests/dom/vue-smoke.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/pages-real-dom.dom.ts"), "");
    fs.writeFileSync(path.join(root, "tests/dom/pages-characterization.dom.ts"), "");
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
