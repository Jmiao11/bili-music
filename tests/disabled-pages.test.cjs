const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const helper = source.slice(
  source.indexOf("function isPageDisabled("),
  source.indexOf("function setFavoriteButtonState("),
);
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
