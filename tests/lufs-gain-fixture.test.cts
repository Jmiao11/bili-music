const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const { readFileSync }: import("./helpers/module-syntax.cts").Contract = require("./helpers/module-syntax.cts");
const path: typeof import("node:path") = require("node:path");
const { test }: typeof import("node:test") = require("node:test");
const vm: typeof import("node:vm") = require("node:vm");
const { sourceSlice }: import("./helpers/source-slice.cts").Contract = require("./helpers/source-slice.cts");

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
