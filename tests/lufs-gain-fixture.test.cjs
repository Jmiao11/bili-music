const assert = require("node:assert/strict");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { sourceSlice } = require("./helpers/source-slice.cjs");

test("LUFS gain matches the shared Rust/JS fixture", () => {
  const source = readFileSync(path.join(__dirname, "../ui/playback-policy.ts"), "utf8");
  const code = sourceSlice(source, "ui/playback-policy.ts", "function lufsToGain(", "\n}", { endAfterStart: true, includeEnd: true }) + "\n\n";
  const context = vm.createContext({});
  vm.runInContext(code, context);
  const cases = JSON.parse(readFileSync(path.join(__dirname, "fixtures/lufs-gain.json"), "utf8"));
  for (const { lufs, gain } of cases) {
    const input = typeof lufs === "string" ? Number(lufs) : lufs;
    assert.ok(Math.abs(context.lufsToGain(input) - gain) < 1e-12, String(lufs));
  }
});
