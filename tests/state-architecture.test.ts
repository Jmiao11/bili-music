import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

const stateModuleFiles = ["playback-messages-state.ts", "playback-mini-view.ts", "playback-request-state.ts", "playback-session-state.ts", "playback-queue-state.ts", "playback-display-state.ts", "playback-settings-state.ts", "settings-state.ts", "page-selection.ts", "state-store.ts", "app-state.ts", "search-state.ts", "library-state.ts", "pages-state.ts", "track-utils.ts"];

function assertStateModule(source: string, file: string): void {
  const code = maskCommentsAndStrings(source);
  assert.doesNotMatch(code, /\b(?:window|document|navigator|localStorage|sessionStorage|Window|Document|Element|HTMLElement|HTML\w*Element|Node|EventTarget|MutationObserver|ResizeObserver|IntersectionObserver|__TAURI__|Tauri\w*)\b/, `${file}: state cannot reference platform globals or DOM types`);
  for (const match of source.matchAll(/\b(?:import|export)\b[^;]*?["']([^"']+)["']/g)) {
    assert.ok(["./playback-messages-state.ts", "./app-state.ts", "./playback-request-state.ts", "./playback-session-state.ts", "./playback-queue-state.ts", "./playback-display-state.ts", "./playback-settings-state.ts", "./settings-state.ts", "./page-selection.ts", "./state-store.ts", "./track-utils.ts", "./search-state.ts", "./library-state.ts", "./pages-state.ts"].includes(match[1]), `${file}: forbidden state dependency ${match[1]}`);
  }
}

test("state modules are registered and contain no DOM or Tauri dependencies", () => {
  const root = path.join(import.meta.dirname, "..");
  const config = JSON.parse(fs.readFileSync(path.join(root, "scripts/typecheck/tsconfig.main.json"), "utf8"));
  for (const file of stateModuleFiles) {
    assertStateModule(fs.readFileSync(path.join(root, "ui", file), "utf8"), file);
    assert.ok([...config.files, ...config.include].includes(`../../ui/${file}`), `${file}: missing type project registration`);
  }
});

test("state architecture guard rejects document references and DOM types and platform imports", () => {
  for (const source of ["document.title;", "window.location;", "type Bad = HTMLElement;", "type Bad = Document;", 'import { invoke } from "./runtime-api.ts";', 'import { x } from "@tauri-apps/api/core";']) {
    assert.throws(() => assertStateModule(source, "counterexample.ts"));
  }
  assert.doesNotThrow(() => assertStateModule('// document\nconst message = "document";\ntype State = { count: number };', "valid.ts"));
});
function assertHomeRenderer(source: string): void {
  const code = maskCommentsAndStrings(source);
  assert.doesNotMatch(code, /\b(?:invoke|playListItem|createApplicationStore)\b|\.\s*actions\b/, "renderer cannot call actions or platform commands");
  for (const match of source.matchAll(/\bimport\b[^;]*?["']([^"']+)["']/g)) {
    assert.ok(["./app-state.ts", "./player-dom.ts"].includes(match[1]), `renderer dependency is not readonly: ${match[1]}`);
  }
}

test("home renderer reads snapshots and delegates user interaction without actions or invoke", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "../ui/home-view.ts"), "utf8");
  assertHomeRenderer(source);
  for (const bad of ["store.actions.setHomeMode('ranking');", "invoke('get_music_ranking');", 'import { playListItem } from "./playback-core.ts";']) {
    assert.throws(() => assertHomeRenderer(bad));
  }
});
function assertSearchSnapshotReads(source: string): void {
  const code = maskCommentsAndStrings(source);
  const origins = new Set<string>();
  const root = String.raw`(?:getSearchSnapshot\s*\(\s*\)|\w+\.getState\s*\(\s*\)\.search)`;
  let changed = true;
  while (changed) {
    changed = false;
    const known = origins.size ? `|(?:${[...origins].join("|")})\\b` : "";
    const aliases = new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*=\s*(?:${root}${known})(?:\s*\.[\w$]+|\s*\[[^\]]+\])*\s*[;,]`, "g");
    for (const match of code.matchAll(aliases)) if (!origins.has(match[1])) { origins.add(match[1]); changed = true; }
  }
  const bases = `(?:${root}${origins.size ? "|\\b(?:" + [...origins].join("|") + ")\\b" : ""})`;
  const paths = String.raw`(?:\s*\.[\w$]+|\s*\[[^\]]+\])`;
  const targets = `${bases}${paths}*`;
  assert.doesNotMatch(code, new RegExp(String.raw`${bases}${paths}+\s*(?:=(?!=|>)|\+=|-=|\+\+|--)`), "snapshot assignment is forbidden");
  assert.doesNotMatch(code, new RegExp(String.raw`\b(?:Object\.assign|Reflect\.set)\s*\(\s*${targets}\s*,`), "snapshot alias mutation is forbidden");
  assert.doesNotMatch(code, new RegExp(String.raw`${targets}\s*\.\s*(?:push|pop|splice|shift|unshift|sort|reverse|set|add|delete|clear)\s*\(`), "snapshot collection mutation is forbidden");
}

test("search snapshot guard rejects direct and aliased metadata writes", () => {
  const root = path.join(import.meta.dirname, "../ui");
  for (const file of ["main.ts", "playback-core.ts", "search.ts", "search-view.ts"]) assertSearchSnapshotReads(fs.readFileSync(path.join(root, file), "utf8"));
  for (const bad of [
    'getSearchSnapshot().page = 2;',
    'getSearchSnapshot().results.push(video);',
    'const video = getSearchSnapshot().results[index]; Object.assign(video, metadata);',
    'const search = getSearchSnapshot(); const rows = search.results; const video = rows[index]; Object.assign(video, metadata);',
    'const search = store.getState().search; Reflect.set(search, "page", 2);',
  ]) assert.throws(() => assertSearchSnapshotReads(bad), bad);
  assert.doesNotThrow(() => assertSearchSnapshotReads('const search = getSearchSnapshot(); Object.assign(queueVideo, metadata); const copy = { ...search.results[0], ...metadata };'));
});

test("search renderer is readonly and exclusively owns the search submit button", () => {
  const root = path.join(import.meta.dirname, "../ui");
  const source = fs.readFileSync(path.join(root, "search-view.ts"), "utf8");
  const code = maskCommentsAndStrings(source);
  assert.doesNotMatch(code, /\b(?:invoke|getSearchActions|createApplicationStore)\b|\.\s*actions\b/);
  for (const match of source.matchAll(/\bimport\b[^;]*?["']([^"']+)["']/g)) assert.ok(["./track-utils.ts", "./search-state.ts", "./player-dom.ts"].includes(match[1]));
  for (const file of fs.readdirSync(root).filter(name => name.endsWith(".ts") && name !== "search-view.ts")) {
    assert.doesNotMatch(maskCommentsAndStrings(fs.readFileSync(path.join(root, file), "utf8")), /\bsearchButton\s*\.\s*(?:disabled|textContent)\s*=/, `${file}: search submit button belongs to renderer`);
  }
});
