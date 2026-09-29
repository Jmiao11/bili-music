const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const ui = path.join(__dirname, "../ui");
const html = readFileSync(path.join(ui, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
  .map((match) => match[1].replace(/^\.\//, ""));
const expected = [
  "sidebar.js",
  "window-controls.js",
  "dynamic-background.js",
  "main.js",
  "appearance.js",
  "lyrics.js",
  "mascot.js",
  "mini-player-host.js",
];

test("main-window script list and files match the approved order", () => {
  assert.deepEqual(scripts, expected);
  for (const script of scripts) assert.ok(existsSync(path.join(ui, script)), `missing ${script}`);
});

test("main-window scripts have no conflicting lexical declarations", () => {
  const source = scripts.map((script) => readFileSync(path.join(ui, script), "utf8")).join("\n");
  new vm.Script(source);
});

test("main-window scripts have no duplicate top-level function names", () => {
  const seen = new Map();
  // Only unindented declarations are scanned; functions inside IIFEs are intentionally excluded.
  for (const script of scripts) {
    const source = readFileSync(path.join(ui, script), "utf8");
    for (const match of source.matchAll(/^(?:async\s+)?function\s+([\w$]+)\s*\(/gm)) {
      assert.ok(!seen.has(match[1]), `${match[1]} declared in ${seen.get(match[1])} and ${script}`);
      seen.set(match[1], script);
    }
  }
});
