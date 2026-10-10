import nodeFs from "node:fs";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import { topLevelStatements } from "./helpers/js-source.ts";

test("appearance only declares bindings and app starts it once after importing main", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../ui/appearance.ts"), "utf8");
  const statements = topLevelStatements(source);
  for (const statement of statements) {
    assert.match(statement.code, /^(?:const|let|class|(?:async\s+)?function)\b/);
  }
  assert.equal(statements.filter((statement) => /^function startAppearance\(/.test(statement.code)).length, 1);
  const app = nodeFs.readFileSync(path.join(import.meta.dirname, "../ui/app.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(app, 'import "./main.ts";\nimport { startAppearance } from "./appearance.ts";\nimport { installMiniPlayerBridge } from "./mini-player-bridge.ts";\nstartAppearance();\ninstallMiniPlayerBridge();\n');
});
