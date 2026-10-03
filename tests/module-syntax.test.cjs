const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { moduleDeclarations, stripModuleSyntax, readFileSync } = require("./helpers/module-syntax.cjs");
const { collectBusinessScripts } = require("./helpers/module-graph.cjs");

test("module syntax stripping preserves ordinary source bytes", () => {
  const ui = path.join(__dirname, "../ui");
  for (const name of collectBusinessScripts(ui).ordinary) {
    const file = path.join(ui, name);
    assert.equal(readFileSync(file, "utf8"), fs.readFileSync(file, "utf8"), name);
  }
});

function assertModuleLines(source) {
  const original = source.split(/\r?\n/);
  const stripped = stripModuleSyntax(source).split(/\r?\n/);
  const syntaxLines = new Set();
  for (const declaration of moduleDeclarations(source)) {
    const first = source.slice(0, declaration.start).split("\n").length - 1;
    const last = source.slice(0, declaration.end).split("\n").length - 1;
    for (let line = first; line <= last; line++) syntaxLines.add(line);
  }
  assert.equal(stripped.length, original.length);
  for (let line = 0; line < original.length; line++) {
    assert.equal(stripped[line], syntaxLines.has(line) ? "" : original[line], `line ${line + 1}`);
  }
}

test("module stripping changes only declaration lines and preserves every other line", () => {
  const source = 'import { a } from "./a.js";\n\nconst text = "import is text";\nimport {\n  b,\n  c\n} from "./b.js";\n// unchanged comment\nconst x = a + b + c;\n\nexport {\n x\n};\n';
  assertModuleLines(source);
  assertModuleLines(source.replace(/\n/g, "\r\n"));
  const ui = path.join(__dirname, "../ui");
  for (const name of collectBusinessScripts(ui).modules) {
    assertModuleLines(fs.readFileSync(path.join(ui, name), "utf8"));
  }
});

test("single and multiline named declarations and side-effect imports preserve lines", () => {
  const source = 'import { a, b } from "./a.js";\nimport {\n  c,\n  d\n} from "./b.js";\nimport "./main.js";\nconst x = 1;\nexport {\n x\n};\n';
  const stripped = stripModuleSyntax(source);
  assert.equal(stripped, "\n\n\n\n\n\nconst x = 1;\n\n\n\n");
  assert.equal(stripped.split("\n").length, source.split("\n").length);
  assert.deepEqual(moduleDeclarations(source).map((item) => item.names), [["a", "b"], ["c", "d"], [], ["x"]]);
  assert.equal(stripModuleSyntax('// import nope\nconst x = "export default x";\n'), '// import nope\nconst x = "export default x";\n');
});

test("forbidden or unsupported module syntax fails closed", () => {
  for (const source of [
    'import x from "./x.js";', 'import * as x from "./x.js";',
    'import { x as y } from "./x.js";', 'import { x } from "x";',
    'import("./x.js");', 'import.meta.url;', 'export default x;',
    'export function f() {}', 'export const x = 1;', 'export * from "./x.js";',
    'export { x as y };', 'export { x } from "./x.js";',
  ]) assert.throws(() => stripModuleSyntax(source), /Unsupported module syntax/);
});

test("empty export list preserves source lines without relaxing import syntax", () => {
  assert.deepEqual(moduleDeclarations("export {};\n").map((item) => item.names), [[]]);
  assert.equal(stripModuleSyntax("export {};\n"), "\n");
  assertModuleLines("const x = 1;\nexport {};\n");
  assertModuleLines("const x = 1;\r\nexport {};\r\n");
  for (const source of ['import {} from "./x.js";', 'export {,};', 'export {} from "./x.js";']) {
    assert.throws(() => stripModuleSyntax(source), /Unsupported module syntax/);
  }
});
