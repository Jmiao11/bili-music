// Known omissions: destructuring assignments ([a, x] = arr) and for (x of/in …)
// writes are outside this ratchet. After ESM conversion, read-only imports are
// additionally enforced by the JavaScript engine.
const assert = require("node:assert/strict");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const path = require("node:path");
const { test } = require("node:test");
const { maskCommentsAndStrings, topLevelStatements } = require("./helpers/js-source.cjs");

function bareWrites(source, name) {
  const code = maskCommentsAndStrings(source);
  const writes = [];
  for (const match of code.matchAll(new RegExp(`\\b${name}\\b`, "g"))) {
    const before = code.slice(0, match.index).trimEnd();
    if (before.endsWith(".")) continue;
    if (/\b(?:let|const|var)\s*$/.test(code.slice(0, match.index))) continue;
    const after = code.slice(match.index + name.length);
    if (/^\s*(?:=(?!=|>)|\+=|-=|\*\*?=|\/=|%=|<<=|>>>=|>>=|&&=|\|\|=|\?\?=|&=|\|=|\^=|\+\+|--)/.test(after)
        || /(?:\+\+|--)$/.test(before)) writes.push(code.slice(0, match.index).split("\n").length);
  }
  return writes;
}

test("scalar scanner ignores comments, string text and properties but checks interpolation", () => {
  assert.deepEqual(bareWrites('// x = 1\n/* ++x */\n"x++"; `x = 2`; obj.x = 1; obj . x++;', "x"), []);
  for (const expression of ["x = 1", "x += 1", "x -= 1", "++x", "x--", "`value ${x++}`"]) {
    assert.equal(bareWrites(expression, "x").length, 1, expression);
  }
});

test("another file's top-level let permits a new binding but rejects bare assignments", () => {
  const owner = topLevelStatements("let x = 0;");
  assert.match(owner[0].code, /^let\s+x\s*=/);
  for (const declaration of ["const x = 1;", "let x = 1;", "var x = 1;"]) {
    assert.deepEqual(bareWrites(declaration, "x"), []);
  }
  for (const assignment of ["x = 1;", "x += 1;", "x++;", "++x;"]) {
    assert.equal(bareWrites(assignment, "x").length, 1, assignment);
  }
  assert.deepEqual(bareWrites("obj.x = 1;", "x"), []);
});

test("each main-window top-level let is written only by its declaration file", () => {
  const ui = path.join(__dirname, "../ui");
  const html = readFileSync(path.join(ui, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\ssrc=["']\.\/([^"']+)["'][^>]*>/g)].map((match) => match[1]);
  const sources = new Map(scripts.map((file) => [file, readFileSync(path.join(ui, file), "utf8")]));
  const owners = new Map();
  for (const [file, source] of sources) {
    for (const statement of topLevelStatements(source)) {
      if (!/^let\b/.test(statement.code)) continue;
      const declaration = /^let\s+([\w$]+)\s*(?:=|;)/.exec(statement.code);
      assert.ok(declaration, `${file}: unsupported top-level let declaration`);
      assert.ok(!owners.has(declaration[1]), `duplicate scalar ${declaration[1]}`);
      owners.set(declaration[1], file);
    }
  }
  const unexpected = [];
  for (const [name, owner] of owners) {
    for (const [file, source] of sources) {
      if (file === owner) continue;
      for (const line of bareWrites(source, name)) unexpected.push(`${file}:${line}: ${name} belongs to ${owner}`);
    }
  }
  assert.deepEqual(unexpected, []);
});
