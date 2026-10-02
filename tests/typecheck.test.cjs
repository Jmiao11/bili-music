const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseDiagnostics, diagnosticCounts, compareCounts } = require("../scripts/typecheck/check.cjs");
const { collectBusinessScripts } = require("./helpers/module-graph.cjs");

test("typecheck parses POSIX paths and multiline messages without line-number keys", () => {
  const diagnostics = parseDiagnostics("/repo/ui/a.js(1,2): error TS2339: First line.\n  Second line.\n", "/repo");
  assert.deepEqual(diagnostics, [{ file: "ui/a.js", code: 2339, message: "First line. Second line." }]);
  assert.deepEqual(diagnosticCounts(diagnostics), { "ui/a.js TS2339: First line. Second line.": 1 });
  assert.deepEqual(diagnosticCounts(parseDiagnostics("ui/a.js(99,8): error TS2339: First line.\n  Second line.\n", "/repo")), diagnosticCounts(diagnostics));
});

test("typecheck parses Windows paths and CRLF output", () => {
  assert.deepEqual(parseDiagnostics("C:\\repo\\ui\\a.js(1,2): error TS2304: Missing name.\r\n", "C:\\repo"), [{ file: "ui/a.js", code: 2304, message: "Missing name." }]);
});

test("typecheck rejects new and increased diagnostic counts", () => {
  assert.match(compareCounts({ new: 1 }, {}).join("\n"), /New\/increased/);
  assert.match(compareCounts({ old: 2 }, { old: 1 }).join("\n"), /1 -> 2/);
  assert.deepEqual(compareCounts({ old: 1 }, { old: 1 }), []);
});

test("typecheck reductions require explicit update", () => {
  assert.match(compareCounts({}, { old: 1 }).join("\n"), /--update/);
  assert.deepEqual(compareCounts({}, { old: 1 }, true), []);
  assert.deepEqual(compareCounts({ old: 1 }, { old: 2 }, true), []);
});

test("typecheck update mode rejects growth", () => {
  assert.equal(compareCounts({ new: 1 }, {}, true).length, 1);
  assert.equal(compareCounts({ old: 2 }, { old: 1 }, true).length, 1);
});

test("typecheck rejects unparseable output and out-of-repository paths", () => {
  assert.throws(() => parseDiagnostics("unexpected output\n", "/repo"), /Unparseable/);
  assert.throws(() => parseDiagnostics("  orphan continuation\n", "/repo"), /Unparseable/);
  assert.throws(() => parseDiagnostics("ui/a.js(1,2): error TS2304: Missing.\ngarbage\n", "/repo"), /Unparseable/);
  assert.throws(() => parseDiagnostics("/outside/a.js(1,2): error TS2304: Missing.\n", "/repo"), /outside repository/);
});

test("typecheck projects cover the HTML script graph and isolate mini", () => {
  const root = path.resolve(__dirname, "..");
  const main = JSON.parse(fs.readFileSync(path.join(root, "scripts/typecheck/tsconfig.main.json"), "utf8"));
  const mini = JSON.parse(fs.readFileSync(path.join(root, "scripts/typecheck/tsconfig.mini.json"), "utf8"));
  assert.deepEqual(main.files, collectBusinessScripts(path.join(root, "ui")).files.map((file) => `../../ui/${file}`));
  assert.deepEqual(mini.files, ["../../ui/mini.js"]);
  assert.equal(main.extends, mini.extends);
});
