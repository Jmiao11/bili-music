import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Filesystem traversal also works in source archives and before npm ci.
const excludedDirectories = new Set(["node_modules", "dist", "target", ".git"]);
function assertTypeScriptSources(root: string): void {
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) visit(file);
      } else {
        assert.ok(!/\.(?:js|cjs|mjs)$/i.test(entry.name), `Unsupported JS source: ${path.relative(root, file)}`);
      }
    }
  }
  visit(root);
}

test("repository sources use TypeScript outside generated directories", () => {
  const root = path.join(import.meta.dirname, "..");
  assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /^\/target\/$/m);
  assertTypeScriptSources(root);
});

test("source language guard rejects js/cjs/mjs and excludes only generated directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-source-language-"));
  try {
    for (const file of ["source.ts", "tests/sample.cts", "scripts/sample.mts",
      "node_modules/vendor.js", "dist/app.js", "target/generated.cjs", "src-tauri/target/generated.mjs", ".git/generated.js"]) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "");
    }
    assert.doesNotThrow(() => assertTypeScriptSources(root));
    for (const file of ["legacy.js", "tests/legacy.cjs", "scripts/legacy.mjs", "src-tauri/legacy.js"]) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "");
      assert.throws(() => assertTypeScriptSources(root), /Unsupported JS source/);
      fs.unlinkSync(target);
    }
    assert.doesNotThrow(() => assertTypeScriptSources(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
