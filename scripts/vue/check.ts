import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { compileTemplate, parse } from "vue/compiler-sfc";
import { checkVueInfrastructureFiles } from "./infra-guard.ts";

const fixture = "tests/fixtures/vue/ToolchainSmoke.vue";
const readerFixture = "tests/fixtures/vue/StoreReader.vue";
const vueImports: Record<string, string[]> = {
  "scripts/vue/check.ts": ["vue/compiler-sfc"],
  "tests/dom/vue-smoke.dom.ts": ["vue"],
  "tests/dom/pages-runtime.ts": ["vue"],
  "tests/fixtures/vue/infra.ts": ["vue"],
  "ui/vue/use-app-state.ts": ["vue"],
  "ui/vue/sync-region.ts": ["vue"],
};
function inspect(source: string, file: string, visit: (node: ts.Node) => void) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function walk(node: ts.Node) { visit(node); ts.forEachChild(node, walk); }
  walk(tree);
}

function checkImports(source: string, file: string) {
  inspect(source, file, node => {
    let specifier: string | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) specifier = argument.text;
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifier = node.argument.literal.text;
    if (!specifier) return;
    if (specifier === "vue" || specifier.startsWith("vue/")) assert.ok(vueImports[file]?.includes(specifier), `Unregistered Vue import: ${file} -> ${specifier}`);
    if (specifier.endsWith(".vue")) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const product = file.startsWith("ui/") && target.startsWith("ui/components/");
      // The smoke test uses Vite's entry API; only infrastructure can import this exact fixture.
      const testFixture = file === "tests/dom/vue-smoke.dom.ts" && target === fixture;
      assert.ok(product || testFixture, `Unregistered SFC import: ${file} -> ${target}`);
      assert.ok(ts.isImportDeclaration(node) && node.importClause?.name, `SFC import must be a default import: ${file}`);
    }
  });
}

function checkSfc(source: string, file: string) {
  const { descriptor, errors } = parse(source, { filename: file });
  assert.equal(errors.length, 0, `${file}: invalid SFC`);
  assert.equal(descriptor.script?.src, undefined, `${file}: external script forbidden`);
  assert.equal(descriptor.scriptSetup?.src, undefined, `${file}: external script forbidden`);
  const sources = [descriptor.script?.content, descriptor.scriptSetup?.content].filter((source): source is string => source !== undefined);
  if (descriptor.template) {
    const template = compileTemplate({ source: descriptor.template.content, filename: file, id: file });
    assert.equal(template.errors.length, 0, `${file}: invalid template`);
    sources.push(template.code);
  }
  for (const source of sources) inspect(source, file, node => {
    if (ts.isIdentifier(node)) assert.ok(!["window", "__TAURI__", "invoke", "actions"].includes(node.text), `${file}: forbidden component access: ${node.text}`);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) assert.ok(!["window", "__TAURI__", "invoke", "actions"].includes(node.argumentExpression.text), `${file}: forbidden component access`);
  });
  for (const script of [descriptor.script, descriptor.scriptSetup]) if (script) checkImports(script.content, file);
}

function checkRepository(root: string) {
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const file = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!["node_modules", "dist", "target", ".git"].includes(entry.name)) visit(absolute);
      } else if (file.endsWith(".vue")) {
        assert.ok(file.startsWith("ui/components/") || file === fixture || file === readerFixture, `Unregistered SFC file: ${file}`);
        checkSfc(fs.readFileSync(absolute, "utf8"), file);
      } else if (file.endsWith(".ts")) checkImports(fs.readFileSync(absolute, "utf8"), file);
    }
  }
  visit(root);
}

// Guard self-checks run after installation; no third-party dependency enters node --test.
assert.throws(() => checkImports('import { ref } from "vue";', "ui/app.ts"), /Unregistered Vue import/);
assert.throws(() => checkImports('import X from "../tests/fixtures/vue/ToolchainSmoke.vue";', "ui/app.ts"), /Unregistered SFC import/);
assert.doesNotThrow(() => checkImports('import X from "./components/X.vue";', "ui/app.ts"));
for (const expression of ["window.location", "window.__TAURI__", "invoke('x')", "actions.update()", "globalThis['window']"]) {
  assert.throws(() => checkSfc(`<script setup lang="ts">${expression};</script><template><button /></template>`, fixture), /forbidden component access/);
  assert.throws(() => checkSfc(`<template><button>{{ ${expression} }}</button></template>`, fixture), /forbidden component access/);
}
checkRepository(path.resolve(import.meta.dirname, "../.."));
checkVueInfrastructureFiles(path.resolve(import.meta.dirname, "../.."));
console.log("PASS Vue import and SFC content guards");
