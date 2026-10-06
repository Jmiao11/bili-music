const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const { readFileSync }: import("./helpers/module-syntax.cts").Contract = require("./helpers/module-syntax.cts");
const path: typeof import("node:path") = require("node:path");
const { test }: typeof import("node:test") = require("node:test");
const { topLevelStatements }: import("./helpers/js-source.cts").Contract = require("./helpers/js-source.cts");

test("appearance only declares bindings and app starts it once after importing main", () => {
  const source = readFileSync(path.join(__dirname, "../ui/appearance.ts"), "utf8");
  const statements = topLevelStatements(source);
  for (const statement of statements) {
    assert.match(statement.code, /^(?:const|let|class|(?:async\s+)?function)\b/);
  }
  assert.equal(statements.filter((statement) => /^function startAppearance\(/.test(statement.code)).length, 1);
  const app = require("node:fs").readFileSync(path.join(__dirname, "../ui/app.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(app, 'import "./main.ts";\nimport { startAppearance } from "./appearance.ts";\nstartAppearance();\n');
});
