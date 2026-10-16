import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { stripTypes } from "./helpers/typescript-source.ts";
import { stripModuleSyntax } from "./helpers/module-syntax.ts";
import { sourceSlice } from "./helpers/source-slice.ts";
import { collectModuleGraph } from "./helpers/module-graph.ts";
import { topLevelNames, references } from "./helpers/module-bindings.ts";
import { topLevelStatements } from "./helpers/js-source.ts";
import { loadNativeModules } from "./helpers/native-module-loader.ts";

function fixture(t: import("node:test").TestContext, files: Record<string, string>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bili-ts-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), source);
  return directory;
}

test("TS erasure preserves lines, runtime tokens and the erase/module/slice VM pipeline", () => {
  const source = 'import type { Label } from "./types.ts";\ninterface Options { value: number; }\nfunction score(value: number): number { return value + 1; }\n// end runtime\nexport { score };\n';
  for (const text of [source, source.replace(/\n/g, "\r\n")]) {
    const erased = stripTypes(text, "sample.ts");
    assert.equal(erased.split("\n").length, text.split("\n").length);
    const runtime = stripModuleSyntax(text, "sample.ts");
    assert.equal(runtime.split("\n").length, text.split("\n").length);
    const slice = sourceSlice(text, "sample.ts", "function score(", "// end runtime");
    assert.equal(slice, sourceSlice(erased, "sample.js", "function score(", "// end runtime"));
    const context = vm.createContext({});
    vm.runInContext(slice, context);
    assert.equal(vm.runInContext("score(41)", context), 42);
    assert.deepEqual([...topLevelNames(text, "sample.ts")], ["score"]);
    assert.ok(references(text, "sample.ts").has("value"));
    assert.equal(topLevelStatements(runtime, "sample.ts").length, 1);
  }
});

test("mixed JS/TS graph excludes pure type imports and type exports", (t) => {
  const directory = fixture(t, {
    "app.js": 'import { score } from "./leaf.ts";\nexport { score };\n',
    "leaf.ts": 'import type { Missing } from "./not-a-runtime-file.ts";\ntype Label = number;\nfunction score(value: number) { return value + 1; }\nexport type { Label };\nexport { score };\n',
  });
  assert.deepEqual(collectModuleGraph(directory, ["app.js"]), ["app.js", "leaf.ts"]);
});

test("TS rejects code-generating syntax, decorators and explicit any", () => {
  for (const source of ["enum E { A }", "namespace N { export const value = 1; }", "class C { constructor(public value: number) {} }", "@sealed class C {}", "let value: any;", "const value = 1 as any;"]) {
    (assert.throws as (block: () => unknown, error: undefined, message: string) => void)(() => stripTypes(source, "sample.ts"), undefined, source);
  }
  assert.doesNotThrow(() => stripTypes('const text: string = "any"; // any in comments\nexport { text };', "sample.ts"));

});

test("native JS/TS loading executes .ts directly without loading pure type dependencies", async (t) => {
  const directory = fixture(t, {
    "leaf.ts": 'import type { Missing } from "./not-a-runtime-file.ts";\nfunction score(value: number): number { return value + 1; }\nexport { score };\n',
    "app.js": 'import { score } from "./leaf.ts";\nwindow.tsFixtureResult = score(41);\nexport { score };\n',
  });
  const loaded = await loadNativeModules(directory, ["app.js", "leaf.ts"], "app.js");
  assert.equal(loaded.namespace.score(41), 42);
  assert.deepEqual(loaded.events.map(({ stack, ...event }) => event), [
    { action: "window-set", property: "tsFixtureResult", valueType: "number" },
  ]);
});
