const { sourceSlice }: import("./helpers/source-slice.cts").Contract = require("./helpers/source-slice.cts");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const { readFileSync }: import("./helpers/module-syntax.cts").Contract = require("./helpers/module-syntax.cts");
const path: typeof import("node:path") = require("node:path");
const { test }: typeof import("node:test") = require("node:test");
const vm: typeof import("node:vm") = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.ts"), "utf8");
const policy = readFileSync(require('node:path').join(__dirname, '../ui/playback-policy.ts'), 'utf8');
const pageSelection = readFileSync(path.join(__dirname, "../ui/page-selection.ts"), "utf8");
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
