import nodePath from "node:path";
import { sourceSlice } from "./helpers/source-slice.ts";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(path.join(import.meta.dirname, "../ui/main.ts"), "utf8");
const policy = readFileSync(nodePath.join(import.meta.dirname, '../ui/playback-policy.ts'), 'utf8');
const pageSelection = readFileSync(path.join(import.meta.dirname, "../ui/page-selection.ts"), "utf8");
const helper = pageSelection + sourceSlice(policy, "ui/playback-policy.ts", "function readShuffleCollectionPrefs(", "function shouldRecoverAudio(");
const context = vm.createContext({ Map, Set });
vm.runInContext(helper, context);

test("disabled page lookup ignores BV letter case", () => {
  const disabled = new Map([["bv1gf4x6meb1", new Set([123])]]);
  context.disabled = disabled;
  assert.equal(vm.runInContext('isPageDisabled(disabled, "BV1GF4X6MEb1", 123)', context), true);
  assert.equal(vm.runInContext('isPageDisabled(disabled, "Bv1Gf4X6MeB1", 456)', context), false);
});

test("disabled page lookup returns false for an unknown video", () => {
  context.disabled = new Map();
  assert.equal(vm.runInContext('isPageDisabled(disabled, "BV1GF4X6MEb1", 123)', context), false);
});
