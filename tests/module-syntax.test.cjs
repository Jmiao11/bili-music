const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { moduleDeclarations, stripModuleSyntax, readFileSync } = require("./helpers/module-syntax.cjs");

test("module syntax stripping preserves ordinary source bytes", () => {
  const ui = path.join(__dirname, "../ui");
  for (const name of fs.readdirSync(ui).filter((name) => name.endsWith(".js"))) {
    const file = path.join(ui, name);
    assert.equal(readFileSync(file, "utf8"), fs.readFileSync(file, "utf8"), name);
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
