const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const path: typeof import("node:path") = require("node:path");
const { test }: typeof import("node:test") = require("node:test");
const { readFileSync }: import("./helpers/module-syntax.cts").Contract = require("./helpers/module-syntax.cts");
const { maskCommentsAndStrings, topLevelStatements }: import("./helpers/js-source.cts").Contract = require("./helpers/js-source.cts");

test("main initializes playback notice once after diagnostics and before search listeners", () => {
  const source = readFileSync(path.join(__dirname, "../ui/main.ts"), "utf8");
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
