const assert = require("node:assert/strict");
const { test } = require("node:test");
const { references } = require("./helpers/module-bindings.cjs");

test("module bindings recognize spread references outside rest parameters", () => {
  for (const source of [
    "const array = [...name];",
    "const object = {...name};",
    "f(...name);",
    "function f(...args) { return g(...name); }",
  ]) assert.ok(references(source).has("name"), source);
});

test("module bindings still exclude ordinary and optional member names", () => {
  for (const source of ["obj.name;", "obj?.name;"]) {
    assert.ok(!references(source).has("name"), source);
  }
});

test("module bindings exclude spread text in strings and comments", () => {
  assert.ok(!references('const text = "...name"; // ...name\n/* ...name */').has("name"));
});
