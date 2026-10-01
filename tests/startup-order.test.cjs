const { collectBusinessScripts } = require("./helpers/module-graph.cjs");
const assert = require("node:assert/strict");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const { readdirSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { maskCommentsAndStrings, topLevelStatements } = require("./helpers/js-source.cjs");

const ui = path.join(__dirname, "../ui");
const read = (file) => readFileSync(path.join(ui, file), "utf8");
const html = read("index.html");
const { files: scripts } = collectBusinessScripts(ui);

test("initial trackchange recipients retain their installation phases", () => {
  const listeners = scripts.filter((file) => {
    const source = read(file);
    const code = maskCommentsAndStrings(source);
    return [...source.matchAll(/(?:window\.addEventListener\(|listen\(window,)\s*["']bilibili-music-trackchange["']/g)]
      .some((match) => code.slice(match.index, match.index + 6).trim());
  });
  assert.deepEqual(listeners, ["dynamic-background.js", "main.js", "appearance.js", "mascot.js", "mini-player-host.js"]);
  const tags = [...html.matchAll(/<script\b[^>]*\ssrc=["'](?:\.\/)?([^"']+)["'][^>]*>/g)].map((match) => match[1]);
  const entry = tags.indexOf("app.js");
  assert.ok(tags.indexOf("dynamic-background.js") < entry);
  assert.match(read("dynamic-background.js"), /initializeDynamicBackground\(\);\s*$/);
  for (const file of ["mascot.js", "mini-player-host.js"]) assert.ok(tags.indexOf(file) > entry);
  const appearance = topLevelStatements(read("appearance.js"));
  assert.ok(appearance.every((statement) => /^(?:const|let|class|(?:async\s+)?function)\b/.test(statement.code)));
});

test("main's last executable statement synchronously dispatches initial trackchange", () => {
  const executable = topLevelStatements(read("main.js")).filter((statement) => !/^(?:const|let|class|(?:async\s+)?function)\b/.test(statement.code));
  assert.equal(executable.at(-1).text.trim(), "emitCurrentTrackChanged();");
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

test("bottom classic scripts defer and the sole module entry keeps its position", () => {
  const head = html.slice(0, html.indexOf("</head>"));
  const sidebar = /<script\b([^>]*\bsrc=["']\.\/sidebar\.js["'][^>]*)>/.exec(head);
  assert.ok(sidebar);
  assert.doesNotMatch(sidebar[1], /\bdefer\b/);
  const body = html.slice(html.indexOf("<body"));
  const bodyScripts = [...body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(bodyScripts.length, 6);
  for (const script of bodyScripts) {
    if (/\btype=["']module["']/.test(script[1])) {
      assert.match(script[1], /\bsrc=["']app\.js["']/);
    } else {
      assert.match(script[1], /\bsrc=["']\.\/[^"']+\.js["']/);
      assert.match(script[1], /\bdefer\b/);
    }
    assert.equal(script[2].trim(), "");
  }
});
