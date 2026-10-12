import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { maskCommentsAndStrings } from "../../tests/helpers/js-source.ts";

const domTests = ["tests/dom/favorite-import.dom.ts", "tests/dom/library-characterization.dom.ts", "tests/dom/library-loudness.dom.ts", "tests/dom/library-modal-actions.dom.ts", "tests/dom/library-modal-input.dom.ts", "tests/dom/library-modal-render.dom.ts", "tests/dom/pages-characterization.dom.ts", "tests/dom/pages-list.dom.ts", "tests/dom/pages-null.dom.ts", "tests/dom/pages-real-dom.dom.ts", "tests/dom/pages-tab.dom.ts", "tests/dom/pages-toggle.dom.ts", "tests/dom/vue-infrastructure.dom.ts", "tests/dom/vue-smoke.dom.ts"];
if (domTests.some(file => !file.startsWith("tests/dom/") || !file.endsWith(".dom.ts"))) throw new Error("DOM test registration must use tests/dom/*.dom.ts to avoid default Node discovery");
function sourceImports(source: string) {
  const code = maskCommentsAndStrings(source);
  return [...source.matchAll(/\b(?:import|export)\s*(?:(?:[^;]*?\bfrom\s*)?["']([^"']+)["']|\(\s*["']([^"']+)["'])/g)]
    .filter(match => /^(?:import|export)\b/.test(code.slice(match.index)))
    .map(match => match[1] || match[2]);
}

function testGroups(root: string) {
  const before: string[] = [], after: string[] = [];
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const file = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!["node_modules", "dist", "target", ".git"].includes(entry.name)) visit(absolute);
      } else if (/\.(?:test|spec|dom)\.ts$/.test(file)) {
        if (domTests.includes(file)) after.push(file);
        else {
          assert.ok(file.startsWith("tests/") && !file.startsWith("tests/dom/") && file.endsWith(".test.ts"), `Ungrouped test: ${file}`);
          before.push(file);
        }
      }
    }
  }
  visit(root);
  assert.deepEqual(after.sort(), domTests, "DOM test inventory differs from registration");
  const visited = new Set<string>();
  function checkImports(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    for (const specifier of sourceImports(fs.readFileSync(file, "utf8"))) {
      assert.ok(specifier.startsWith("node:") || specifier.startsWith("."), `Before-install third-party import: ${path.relative(root, file)} -> ${specifier}`);
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        if (target.endsWith(".ts")) checkImports(target);
      }
    }
  }
  for (const file of before) checkImports(path.join(root, file));
  return { before: before.sort(), after };
}

export { sourceImports, testGroups };
