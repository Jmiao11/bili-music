const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { sourceSlice } = require("./helpers/source-slice.cjs");

test("LUFS gain matches the shared Rust/JS fixture", () => {
  const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
  const code = sourceSlice(source, "ui/main.js", "function lufsToGain(", "function refreshTrackLoudness(");
  const context = vm.createContext({});
  vm.runInContext(code, context);
  const cases = JSON.parse(readFileSync(path.join(__dirname, "fixtures/lufs-gain.json"), "utf8"));
  for (const { lufs, gain } of cases) {
    const input = typeof lufs === "string" ? Number(lufs) : lufs;
    assert.ok(Math.abs(context.lufsToGain(input) - gain) < 1e-12, String(lufs));
  }
});
