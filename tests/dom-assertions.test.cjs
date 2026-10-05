const test = require("node:test");
const assert = require("node:assert/strict");
const { checkDomAssertions } = require("../scripts/typecheck/dom-assertions.cjs");
const html = '<input id="field"><div id="panel"></div>';

test("DOM assertion guard accepts literal declarations and CRLF without dependencies", () => {
  for (const source of [
    'const input = document.querySelector<HTMLInputElement>("#field")!;',
    'function init() { const input = document.getElementById("field")!; }',
    '(() => { "use strict"; const input = document.getElementById("field")!; })();',
    'const input = /** @type {HTMLInputElement} */ (document.getElementById("field"));',
    'const a = 1;\r\nconst input = document.querySelector("#field")!;\r\n',
  ]) {
    const result = checkDomAssertions(source, source.includes("@type") ? "sample.js" : "sample.ts", html);
    assert.deepEqual(result.errors, [], source);
    assert.equal(result.assertions.length, 1);
    assert.equal(result.assertions[0].id, "field");
  }
  assert.deepEqual(checkDomAssertions('const ok = !flag; const text = "value!";', "sample.ts", html).errors, []);
  assert.deepEqual(checkDomAssertions('type Text = "value!";', "sample.ts", html).errors, []);
});

test("DOM assertion guard rejects every forbidden assertion counterexample", () => {
  for (const source of [
    'const input = document.getElementById("missing")!;',
    'document.getElementById("field")!;',
    'const input = document.getElementById(id)!;',
    'const input = other!;',
    'const input = other!.value;',
    'const text = `${other!}`;',
    'if (ready) { const input = document.getElementById("field")!; }',
    'function init() { start(); const input = document.getElementById("field")!; }',
    'const input = document.querySelector(".panel")!;',
    'const input = /** @type {HTMLInputElement} */ (document.getElementById("missing"));',
    'use(/** @type {HTMLInputElement} */ (document.getElementById("field")));',
    'const input = /** @type {HTMLInputElement} */ (document.getElementById(id));',
    'const input = document.getElementById("missing")!;\r\n',
  ]) {
    assert.ok(checkDomAssertions(source, source.includes("@type") ? "sample.js" : "sample.ts", html).errors.length > 0, source);
  }
});
