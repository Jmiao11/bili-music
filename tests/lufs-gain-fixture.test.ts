import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { sourceSlice } from "./helpers/source-slice.ts";

test("LUFS gain matches the shared Rust/JS fixture", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../ui/features/playback/playback-policy.ts"), "utf8");
  const code = sourceSlice(source, "ui/features/playback/playback-policy.ts", "function lufsToGain(", "\n}", { endAfterStart: true, includeEnd: true }) + "\n\n";
  const context = vm.createContext({});
  vm.runInContext(code, context);
  const cases = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/lufs-gain.json"), "utf8"));
  for (const { lufs, gain } of cases) {
    const input = typeof lufs === "string" ? Number(lufs) : lufs;
    assert.ok(Math.abs(context.lufsToGain(input) - gain) < 1e-12, String(lufs));
  }
});
