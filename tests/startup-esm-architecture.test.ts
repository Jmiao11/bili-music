import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { readFileSync } from "./helpers/module-syntax.ts";
import { maskCommentsAndStrings, topLevelStatements } from "./helpers/js-source.ts";

const controllers = ["window-controls.ts", "dynamic-background.ts", "lyrics.ts", "mascot.ts", "mini-player-host.ts"];
function checkInitializer(source: string) {
  for (const statement of topLevelStatements(source)) {
    assert.match(statement.code, /^(?:function|const|let)\b/, "controllers only declare bindings at module evaluation");
    if (/^(?:const|let)\b/.test(statement.code)) {
      assert.doesNotMatch(maskCommentsAndStrings(statement.code), /\b(?:window|document|Date|Math)\s*\.|\bnew\b|\w+\s*\(/, "top-level data declarations cannot access platform or call functions");
    }
  }
}
test("five startup ESM controllers have no module evaluation effects", () => {
  for (const file of controllers) checkInitializer(readFileSync(path.join(import.meta.dirname, "../ui", file), "utf8"));
});
test("startup ESM guard rejects direct effects and platform initializers", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../ui/lyrics.ts"), "utf8");
  for (const bad of ["initializeLyrics();", "const node = document.querySelector('#audio');", "window.BiliLyrics = {};"]) {
    assert.throws(() => checkInitializer(source + "\n" + bad));
  }
});
test("main HTML keeps one ESM entry and only sidebar remains classic", () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, "../ui/index.html"), "utf8");
  const tags = [...html.matchAll(/<script\b([^>]*)>/g)].filter(tag => /\bsrc=/.test(tag[1]));
  assert.deepEqual(tags.map(tag => tag[1].trim()), ['src="./sidebar.js"', 'type="module" src="app.ts"']);
});
