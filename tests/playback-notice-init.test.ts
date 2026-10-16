import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { readFileSync } from "./helpers/module-syntax.ts";
import { maskCommentsAndStrings, topLevelStatements } from "./helpers/js-source.ts";

test("main initializes playback notice once after diagnostics and before search listeners", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../ui/app/main.ts"), "utf8");
  const code = maskCommentsAndStrings(source);
  assert.equal([...code.matchAll(/\binitPlaybackNotice\s*\(/g)].length, 1);
  assert.equal([...code.matchAll(/\binitPlaybackDiagnostics\s*\(/g)].length, 1);
  const init = topLevelStatements(source).find((statement) => statement.text.trim() === "initPlaybackNotice();");
  assert.ok(init);
  const diagnostics = topLevelStatements(source).find((statement) => /^initPlaybackDiagnostics\(\);$/.test(statement.code));
  const search = topLevelStatements(source).find((statement) => /^initPlaybackSearch\(\);$/.test(statement.code));
  assert.ok(diagnostics);
  assert.ok(search);
  assert.ok(diagnostics.end < init.start);
  assert.ok(init.end < search.start);
});
