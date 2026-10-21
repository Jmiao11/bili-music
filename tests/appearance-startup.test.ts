import nodeFs from "node:fs";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import { topLevelStatements } from "./helpers/js-source.ts";

test("appearance only declares bindings and app starts it once after importing main", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../ui/features/settings/appearance.ts"), "utf8");
  const statements = topLevelStatements(source);
  for (const statement of statements) {
    assert.match(statement.code, /^(?:const|let|class|(?:async\s+)?function)\b/);
  }
  assert.equal(statements.filter((statement) => /^function startAppearance\(/.test(statement.code)).length, 1);
  const app = nodeFs.readFileSync(path.join(import.meta.dirname, "../ui/app.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(app, "import \"./app/root-mount.ts\";\nimport \"./app/startup-before-main.ts\";\nimport \"./app/main.ts\";\nimport { startAppearance } from \"./features/settings/appearance.ts\";\nimport { initializeLyrics } from \"./features/immersive/lyrics.ts\";\nimport { startMiniPlayerHost } from \"./mini/mini-player-host.ts\";\nimport { initializeMainWindowReady } from \"./app/main-window-ready.ts\";\nstartAppearance();\ninitializeLyrics();\nstartMiniPlayerHost();\ninitializeMainWindowReady();\n");
});
