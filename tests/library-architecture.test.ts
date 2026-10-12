import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

function readonlyLibrary(source: string, names: string[] = []): void {
  const code = maskCommentsAndStrings(source), origins = new Set<string>(names);
  const root = String.raw`(?:getLibrarySnapshot\s*\(\s*\)|\w+\.getState\s*\(\s*\)\.library)`;
  let changed = true;
  while (changed) {
    changed = false;
    const bases = root + (origins.size ? "|\\b(?:" + [...origins].join("|") + ")\\b" : "");
    for (const match of code.matchAll(new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*=\s*(?:${bases})(?:\s*\.[\w$]+|\s*\[[^\]]+\])*\s*[;,]`, "g"))) if (!origins.has(match[1])) { origins.add(match[1]); changed = true; }
  }
  const targets = "(?:" + root + (origins.size ? "|\\b(?:" + [...origins].join("|") + ")\\b" : "") + ")(?:\\s*\\.[\\w$]+|\\s*\\[[^\\]]+\\])*";
  assert.doesNotMatch(code, new RegExp(targets + String.raw`\s*\.[\w$]+\s*(?:=(?!=|>)|\+=|-=|\+\+|--)`));
  assert.doesNotMatch(code, new RegExp(String.raw`\b(?:Object\.assign|Reflect\.set)\s*\(\s*${targets}\s*,`));
  assert.doesNotMatch(code, new RegExp(targets + String.raw`\s*\.\s*(?:push|pop|splice|shift|unshift|sort|reverse|set|add|delete|clear)\s*\(`));
}

test("library renderer reads snapshots without actions platform imports or snapshot writes", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "../ui/library-view.ts"), "utf8");
  assert.doesNotMatch(maskCommentsAndStrings(source), /\b(?:invoke|getLibraryActions|getApplicationStore)\b|\.\s*actions\b/);
  for (const match of source.matchAll(/^import\b[^;]*?["']([^"']+)["']/gm)) assert.ok(["./focus-trap.ts", "./track-utils.ts", "./library-state.ts", "./player-dom.ts", "./components/LibraryModalBody.vue", "./vue/sync-region.ts"].includes(match[1]));
  readonlyLibrary(source, ["state", "libraryState"]);
});

test("library snapshot guard rejects collection and nested alias mutations", () => {
  for (const source of ['getLibrarySnapshot().selectedPlaylistId = "a";', 'const library = getLibrarySnapshot(); library.favorites.push(track);', 'const rows = getLibrarySnapshot().playlists; const playlist = rows[0]; Object.assign(playlist, changed);', 'getLibrarySnapshot().unavailableBvids.set(bvid, reason);', 'state.session.busy = true;']) assert.throws(() => readonlyLibrary(source, ["state"]), source);
  assert.doesNotThrow(() => readonlyLibrary('const values = new Map(getLibrarySnapshot().unavailableBvids); values.set(bvid, reason);'));
  for (const file of ["library-ui.ts", "playback-core.ts", "main.ts", "video-pages.ts"]) {
    const source = fs.readFileSync(path.join(import.meta.dirname, "../ui", file), "utf8");
    readonlyLibrary(source);
  }
});
