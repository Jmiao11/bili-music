import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { htmlIds, checkDomAssertions, checkRepository } from "../scripts/typecheck/dom-assertions.ts";
const html = '<input id="field"><div id="panel"></div>';

test("mounted main HTML supplements the guard without changing mini HTML or its default", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-mounted-dom-guard-"));
  try {
    fs.mkdirSync(path.join(root, "ui/app"), {recursive:true});
    fs.writeFileSync(path.join(root, "ui/index.html"), '<div id="app"></div>');
    fs.writeFileSync(path.join(root, "ui/mini.html"), '<div id="mini"></div>');
    fs.writeFileSync(path.join(root, "ui/app/main.ts"), 'const element = document.getElementById("field")!;');
    fs.writeFileSync(path.join(root, "ui/mini.ts"), 'const element = document.getElementById("mini")!;');
    assert.throws(() => checkRepository(root), /id does not exist.*field/);
    assert.equal(checkRepository(root, html).length, 2);
    fs.writeFileSync(path.join(root, "ui/mini.ts"), 'const element = document.getElementById("field")!;');
    assert.throws(() => checkRepository(root, html), /id does not exist.*field/);
  } finally {
    if (path.dirname(root) !== os.tmpdir()) throw new Error("Unsafe temporary guard cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

test("HTML id parser accepts exact attributes across quoting, whitespace and CRLF", () => {
  const markup = '<div ID="a"></div><input id=\'b\'><p id=c></p><span id = "d"></span>\r\n<section\r\n id\r\n=\r\n"e"\r\n></section>';
  assert.deepEqual([...htmlIds(markup)], ["a", "b", "c", "d", "e"]);
  for (const id of htmlIds(markup)) {
    assert.deepEqual(checkDomAssertions(`const element = document.querySelector("#${id}")!;`, "app/main.ts", markup).errors, []);
  }
});

test("HTML id parser rejects attribute lookalikes, inert content and duplicate ids", () => {
  for (const markup of [
    '<div data-id="missing"></div>', '<div x-id="missing"></div>',
    '<div aria-labelledby="missing"></div>', '<!-- <div id="missing"></div> -->',
    '<script>const text = \'<div id="missing"></div>\';</script>',
    '<style>.x { content: \'<div id="missing"></div>\'; }</style>',
    '<template><div id="missing"></div></template>',
    '<template><template></template><div id="missing"></div></template>',
    '<div title="id=missing"></div>', '<div id="missing"></div><p ID=missing></p>',
  ]) {
    assert.ok(checkDomAssertions('const element = document.querySelector("#missing")!;', "app/main.ts", markup).errors.length, markup);
  }
});

test("DOM assertion selectors must be a single pure id", () => {
  for (const selector of ["#a .b", "#a, #b", "div#a", "#a:hover"]) {
    const result = checkDomAssertions(`const element = document.querySelector("${selector}")!;`, "app/main.ts", '<div id="a"></div><div id="b"></div>');
    assert.ok(result.errors.length, selector);
  }
});

test("DOM assertion ids belong to the corresponding window HTML", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-dom-guard-"));
  try {
    fs.mkdirSync(path.join(root, "ui/app"), {recursive:true});
    fs.writeFileSync(path.join(root, "ui/index.html"), '<div id="main-only"></div>');
    fs.writeFileSync(path.join(root, "ui/mini.html"), '<div id="mini-only"></div>');
    fs.writeFileSync(path.join(root, "ui/mini.js"), 'const element = /** @type {HTMLDivElement} */ (document.getElementById("main-only"));');
    assert.throws(() => checkRepository(root), /id does not exist.*main-only/);
    fs.unlinkSync(path.join(root, "ui/mini.js"));
    fs.writeFileSync(path.join(root, "ui/app/main.ts"), 'const element = document.getElementById("mini-only")!;');
    assert.throws(() => checkRepository(root), /id does not exist.*mini-only/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test("DOM assertion guard checks parenthesized TS DOM casts", () => {
  for (const source of [
    'const input = (document.getElementById("field") as HTMLInputElement);',
    'function init() { const input = (document.querySelector("#field") as HTMLInputElement); }',
    'const input = (document.getElementById("field") as HTMLInputElement);\r\n',
  ]) {
    const result = checkDomAssertions(source, "sample.ts", html);
    assert.deepEqual(result.errors, [], source);
    assert.equal(result.assertions.length, 1);
  }
  for (const source of [
    'const input = (document.getElementById("missing") as HTMLInputElement);',
    'use((document.getElementById("field") as HTMLInputElement));',
    'const input = (document.getElementById(id) as HTMLInputElement);',
    'function init() { start(); const input = (document.getElementById("field") as HTMLInputElement); }',
    ...["#field .b", "#field, #panel", "div#field", "#field:hover", ".field"].map((selector) => `const input = (document.querySelector("${selector}") as HTMLInputElement);`),
  ]) assert.ok(checkDomAssertions(source, "sample.ts", html).errors.length, source);
});

test("TS DOM casts retain the main and mini window mapping", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-dom-ts-cast-"));
  try {
    fs.mkdirSync(path.join(root, "ui/app"), {recursive:true});
    fs.writeFileSync(path.join(root, "ui/index.html"), '<div id="main"></div>');
    fs.writeFileSync(path.join(root, "ui/mini.html"), '<div id="mini"></div>');
    fs.writeFileSync(path.join(root, "ui/mini.ts"), 'const element = (document.getElementById("main") as HTMLDivElement);');
    assert.throws(() => checkRepository(root), /id does not exist.*main/);
    fs.writeFileSync(path.join(root, "ui/mini.ts"), 'const element = (document.getElementById("mini") as HTMLDivElement);');
    assert.equal(checkRepository(root).length, 1);
    fs.writeFileSync(path.join(root, "ui/app/main.ts"), 'const element = (document.getElementById("mini") as HTMLDivElement);');
    assert.throws(() => checkRepository(root), /id does not exist.*mini/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
