const assert = require("node:assert/strict");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const path = require("node:path");
const { test } = require("node:test");
const { topLevelStatements } = require("./helpers/js-source.cjs");

test("appearance only declares bindings and app starts it once after importing main", () => {
  const source = readFileSync(path.join(__dirname, "../ui/appearance.js"), "utf8");
  const statements = topLevelStatements(source);
  for (const statement of statements) {
    assert.match(statement.code, /^(?:const|let|class|(?:async\s+)?function)\b/);
  }
  assert.equal(statements.filter((statement) => /^function startAppearance\(/.test(statement.code)).length, 1);
  const app = require("node:fs").readFileSync(path.join(__dirname, "../ui/app.js"), "utf8");
  assert.equal(app, 'import "./main.js";\nimport { startAppearance } from "./appearance.js";\nstartAppearance();\n');
});
