const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { topLevelStatements } = require("./helpers/js-source.cjs");

test("appearance declares its bindings before its sole top-level startup call", () => {
  const source = readFileSync(path.join(__dirname, "../ui/appearance.js"), "utf8");
  const statements = topLevelStatements(source);
  assert.equal(statements.at(-1).text.trim(), "startAppearance();");
  for (const statement of statements.slice(0, -1)) {
    assert.match(statement.code, /^(?:const|let|class|(?:async\s+)?function)\b/);
  }
  assert.equal(statements.filter((statement) => /^function startAppearance\(/.test(statement.code)).length, 1);
});
