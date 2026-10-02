const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { loadNativeModules } = require("./helpers/native-module-loader.cjs");

function fixture(t, sources) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bili-esm-fixture-")));
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const [name, source] of Object.entries(sources)) fs.writeFileSync(path.join(root, name), source);
  return root;
}

test("native loading records evaluation, listeners, dispatch and invocation counts", async (t) => {
  const root = fixture(t, {
    "a.js": 'window.addEventListener("sample", () => {}); export const a = 1;',
    "b.js": 'import { a } from "./a.js"; function start() { window.dispatchEvent(new CustomEvent("sample")); } start(); export { a };',
    "app.js": 'import { a } from "./b.js"; export { a };',
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const loaded = await loadNativeModules(root, ["a.js", "b.js", "app.js"], "app.js");
  assert.equal(loaded.namespace.a, 1);
  assert.deepEqual(loaded.events.map(({ action, type }) => [action, type]), [["listen", "sample"], ["dispatch", "sample"]]);
  assert.match(loaded.events[1].stack, /b\.js/);
  const start = loaded.coverage.flatMap((script) => script.functions).find((fn) => fn.functionName === "start");
  assert.equal(start.ranges[0].count, 1);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "window"), previous);
});

test("native loading rejects missing exports at link time", async (t) => {
  const root = fixture(t, { "a.js": "export const a = 1;", "app.js": 'import { missing } from "./a.js"; export { missing };' });
  await assert.rejects(loadNativeModules(root, ["a.js", "app.js"], "app.js"), /does not provide an export named 'missing'/);
});

test("native loading through a symlinked temporary directory retains all records", async (t) => {
  const root = fixture(t, {
    "a.js": 'window.addEventListener("sample", () => {}); export const a = 1;',
    "b.js": 'import { a } from "./a.js"; function start() { window.dispatchEvent(new CustomEvent("sample")); } start(); export { a };',
    "app.js": 'import { a } from "./b.js"; export { a };',
  });
  const target = path.join(root, "temporary");
  const link = path.join(root, "temporary-link");
  fs.mkdirSync(target);
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  const tmpdir = os.tmpdir;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let loaded;
  try {
    os.tmpdir = () => link;
    loaded = await loadNativeModules(root, ["a.js", "b.js", "app.js"], "app.js");
  } finally {
    os.tmpdir = tmpdir;
  }
  assert.equal(loaded.namespace.a, 1);
  assert.deepEqual(loaded.events.map(({ action, type }) => [action, type]), [["listen", "sample"], ["dispatch", "sample"]]);
  assert.match(loaded.events[1].stack, /b\.js/);
  const start = loaded.coverage.flatMap((script) => script.functions).find((fn) => fn.functionName === "start");
  assert.equal(start.ranges[0].count, 1);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "window"), previous);
});

test("native loading rejects evaluation-time TDZ across a cycle", async (t) => {
  const root = fixture(t, {
    "a.js": 'import { b } from "./b.js"; export const a = b;',
    "b.js": 'import { a } from "./a.js"; export const b = a;',
  });
  await assert.rejects(loadNativeModules(root, ["a.js", "b.js"], "a.js"), /Cannot access 'a' before initialization/);
});
