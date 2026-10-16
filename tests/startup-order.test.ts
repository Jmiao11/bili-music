import { collectBusinessScripts } from "./helpers/module-graph.ts";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings, topLevelStatements } from "./helpers/js-source.ts";

const ui = path.join(import.meta.dirname, "../ui");
const read = (file: string) => readFileSync(path.join(ui, file), "utf8");
const html = read("index.html");
const { files: scripts } = collectBusinessScripts(ui);

test("initial trackchange recipients retain their installation phases", () => {
  const listeners = scripts.filter((file) => {
    const source = read(file);
    const code = maskCommentsAndStrings(source);
    return [...source.matchAll(/(?:window\.addEventListener\(|listen\(window,)\s*["']bilibili-music-trackchange["']/g)]
      .some((match) => code.slice(match.index, match.index + 6).trim());
  });
  assert.deepEqual(listeners, ["features/settings/dynamic-background.ts", "app/mascot.ts", "features/playback/playback-core.ts", "features/settings/appearance.ts", "mini/mini-player-host.ts"]);
  const appearance = topLevelStatements(read("features/settings/appearance.ts"));
  assert.ok(appearance.every((statement) => /^(?:const|let|class|(?:async\s+)?function)\b/.test(statement.code)));
});

test("main's last executable statement synchronously dispatches initial trackchange", () => {
  const executable = topLevelStatements(read("app/main.ts")).filter((statement) => !/^(?:const|let|class|(?:async\s+)?function)\b/.test(statement.code));
  const last = executable.at(-1);
  if (last === undefined) throw new Error("Main executable statement is missing");
  assert.equal(last.text.trim(), "emitCurrentTrackChanged();");
});

test("document lifecycle dependencies retain their current file inventory", () => {
  const files = readdirSync(ui, { recursive: true }).map(name => String(name).replace(/\\/g, "/")).filter((file) => /\.(?:js|ts)$/.test(file)).sort();
  const inventory: Record<string, string[]> = { readyState: [], currentScript: [], DOMContentLoaded: [], load: [] };
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
    readyState: [], currentScript: [], DOMContentLoaded: ["app/main-window-ready.ts", "app/main.ts", "app/sidebar.ts"], load: ["features/settings/dynamic-background.ts"],
  });
});

test("the sole inline script stays in head and only sets the platform", () => {
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(match => !/\bsrc\s*=/.test(match[1]));
  assert.equal(inline.length, 0);
  assert.match(read("app/startup-platform.ts"), /dataset\.platform/);
});

test("bottom classic scripts defer and the sole module entry keeps its position", () => {
  const head = html.slice(0, html.indexOf("</head>"));
  const sidebar = /<script\b([^>]*\bsrc=["']\.\/sidebar\.js["'][^>]*)>/.exec(head);
  assert.equal(sidebar, null);
  const body = html.slice(html.indexOf("<body"));
  const bodyScripts = [...body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(bodyScripts.length, 1);
  for (const script of bodyScripts) {
    assert.match(script[1], /\btype=["']module["']/);
    assert.match(script[1], /\bsrc=["']app\.ts["']/);
    assert.equal(script[2].trim(), "");
  }
});
