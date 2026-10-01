const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { maskCommentsAndStrings, topLevelStatements } = require("./helpers/js-source.cjs");

const ui = path.join(__dirname, "../ui");
const read = (file) => readFileSync(path.join(ui, file), "utf8");
const html = read("index.html");
const scripts = [...html.matchAll(/<script\b[^>]*\ssrc=["']\.\/([^"']+)["'][^>]*>/g)].map((match) => match[1]);

test("initial trackchange listener files retain their positions around main", () => {
  const listeners = scripts.filter((file) => {
    const source = read(file);
    const code = maskCommentsAndStrings(source);
    return [...source.matchAll(/(?:window\.addEventListener\(|listen\(window,)\s*["']bilibili-music-trackchange["']/g)]
      .some((match) => code.slice(match.index, match.index + 6).trim());
  });
  assert.deepEqual(listeners, ["dynamic-background.js", "main.js", "appearance.js", "mascot.js", "mini-player-host.js"]);
  const main = scripts.indexOf("main.js");
  assert.ok(scripts.indexOf("dynamic-background.js") < main);
  for (const file of ["appearance.js", "mascot.js", "mini-player-host.js"]) assert.ok(scripts.indexOf(file) > main);
});

test("main ends with the synchronous initial trackchange dispatch", () => {
  assert.equal(topLevelStatements(read("main.js")).at(-1).text.trim(), "emitCurrentTrackChanged();");
});

test("document lifecycle dependencies retain their current file inventory", () => {
  const files = readdirSync(ui).filter((file) => file.endsWith(".js")).sort();
  const inventory = { readyState: [], currentScript: [], DOMContentLoaded: [], load: [] };
  for (const file of files) {
    const source = read(file);
    const code = maskCommentsAndStrings(source);
    for (const property of ["readyState", "currentScript"]) {
      if (new RegExp(`document\\s*\\.\\s*${property}\\b`).test(code)) inventory[property].push(file);
    }
    for (const event of ["DOMContentLoaded", "load"]) {
      const pattern = new RegExp(`\\.addEventListener\\(\\s*["']${event}["']`, "g");
      if ([...source.matchAll(pattern)].some((match) => code[match.index] === ".")) inventory[event].push(file);
    }
    if (/\.onload\s*=/.test(code) && !inventory.load.includes(file)) inventory.load.push(file);
  }
  assert.deepEqual(inventory, {
    readyState: [], currentScript: [], DOMContentLoaded: ["main.js", "sidebar.js"], load: ["dynamic-background.js"],
  });
});

test("the sole inline script stays in head and only sets the platform", () => {
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((match) => !/\bsrc\s*=/.test(match[1]));
  assert.equal(inline.length, 1);
  assert.ok(inline[0].index < html.indexOf("</head>"));
  assert.equal(inline[0][2].trim(), 'document.documentElement.dataset.platform = /Macintosh|Mac OS X/i.test(navigator.userAgent) ? "macos" : "windows";');
});
