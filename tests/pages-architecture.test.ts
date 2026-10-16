import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";
function readonlyPages(source: string, names: string[] = []) {
  const code = maskCommentsAndStrings(source), aliases = new Set(names);
  const root = String.raw`(?:getPagesSnapshot\s*\(\s*\)|\w+\.getState\s*\(\s*\)\.pages)`;
  let changed = true;
  while (changed) {
    changed = false; const bases = root + (aliases.size ? "|\\b(?:" + [...aliases].join("|") + ")\\b" : "");
    for (const match of code.matchAll(new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*=\s*(?:${bases})(?:\s*\.[\w$]+|\s*\[[^\]]+\])*\s*[;,]`, "g"))) if (!aliases.has(match[1])) { aliases.add(match[1]); changed = true; }
  }
  const targets = "(?:" + root + (aliases.size ? "|\\b(?:" + [...aliases].join("|") + ")\\b" : "") + ")(?:\\s*\\.[\\w$]+|\\s*\\[[^\\]]+\\])*";
  assert.doesNotMatch(code, new RegExp(targets + String.raw`\s*\.[\w$]+\s*(?:=(?!=|>)|\+=|-=|\+\+|--)`));
  assert.doesNotMatch(code, new RegExp(String.raw`\b(?:Object\.assign|Reflect\.set)\s*\(\s*${targets}\s*,`));
  assert.doesNotMatch(code, new RegExp(targets + String.raw`\s*\.\s*(?:push|pop|splice|shift|unshift|sort|reverse|set|add|delete|clear)\s*\(`));
}
test("pages renderer reads snapshots with callback bindings and no actions or platform commands", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "../ui/features/pages/pages-view.ts"), "utf8");
  assert.doesNotMatch(maskCommentsAndStrings(source), /\b(?:invoke|getPagesActions|getApplicationStore)\b|\.\s*actions\b/);
  readonlyPages(source, ["state"]);
  for (const file of ["features/pages/video-pages.ts", "app/main.ts"]) readonlyPages(fs.readFileSync(path.join(import.meta.dirname, "../ui", file), "utf8"));
});
test("pages snapshot guard rejects direct nested and collection alias writes", () => {
  for (const source of ['getPagesSnapshot().requestVersion++;', 'const pages = getPagesSnapshot(); pages.videoPageCounts.set(bvid, 2);', 'const pages = getPagesSnapshot().modal.pages; pages.push(page);', 'const modal = getPagesSnapshot().modal; Object.assign(modal, data);', 'state.modal.error = "bad";']) assert.throws(() => readonlyPages(source, ["state"]));
  assert.doesNotThrow(() => readonlyPages('const values = new Map(getPagesSnapshot().videoPageCounts); values.set(bvid, 2);'));
});