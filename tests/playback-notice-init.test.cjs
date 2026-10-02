const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const { maskCommentsAndStrings, topLevelStatements } = require("./helpers/js-source.cjs");

test("main initializes playback notice once after diagnostics and before search listeners", () => {
  const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
  const code = maskCommentsAndStrings(source);
  assert.equal([...code.matchAll(/\binitPlaybackNotice\s*\(/g)].length, 1);
  const init = topLevelStatements(source).find((statement) => statement.text.trim() === "initPlaybackNotice();");
  assert.ok(init);
  const diagnostics = topLevelStatements(source).find((statement) => /^window\.recordPlaybackDiag\s*=/.test(statement.code));
  const search = topLevelStatements(source).find((statement) => /^searchForm\.addEventListener\(/.test(statement.code));
  assert.ok(diagnostics);
  assert.ok(search);
  assert.ok(diagnostics.end < init.start);
  assert.ok(init.end < search.start);
});
