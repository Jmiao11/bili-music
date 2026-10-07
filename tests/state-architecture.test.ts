import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

const stateModuleFiles = ["state-store.ts", "app-state.ts", "track-utils.ts"];

function assertStateModule(source: string, file: string): void {
  const code = maskCommentsAndStrings(source);
  assert.doesNotMatch(code, /\b(?:window|document|navigator|localStorage|sessionStorage|Window|Document|Element|HTMLElement|HTML\w*Element|Node|EventTarget|MutationObserver|ResizeObserver|IntersectionObserver|__TAURI__|Tauri\w*)\b/, `${file}: state cannot reference platform globals or DOM types`);
  for (const match of source.matchAll(/\b(?:import|export)\b[^;]*?["']([^"']+)["']/g)) {
    assert.ok(["./state-store.ts", "./track-utils.ts"].includes(match[1]), `${file}: forbidden state dependency ${match[1]}`);
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
