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
  "page-selection.js",
  "track-utils.js",
  "home.js",
  "library-ui.js",
  "video-pages.js",
  "search.js",
  "main.js",
  "appearance.js",
  "lyrics.js",
  "mascot.js",
  "mini-player-host.js",
];
const splitScripts = ["page-selection.js", "track-utils.js", "home.js", "library-ui.js", "video-pages.js", "search.js"];

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

test("split scripts contain only top-level function declarations and comments", () => {
  for (const script of splitScripts) {
    const source = readFileSync(path.join(ui, script), "utf8");
    let position = 0;
    while (position < source.length) {
      const trivia = /^(?:\s+|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)/.exec(source.slice(position));
      if (trivia) { position += trivia[0].length; continue; }
      assert.match(source.slice(position), /^(?:async\s+)?function\s+[\w$]+\s*\(/, `${script}: unexpected top-level code`);
      let end = source.indexOf("}", position);
      for (; end >= 0; end = source.indexOf("}", end + 1)) {
        try { new vm.Script(source.slice(position, end + 1)); break; } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
      assert.ok(end >= 0, `${script}: incomplete function declaration`);
      position = end + 1;
    }
  }
});
