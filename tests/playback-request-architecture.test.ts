import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

function assertRequestOwnership(source: string) {
  const code = maskCommentsAndStrings(source), aliases = new Set(["playerState"]);
  for (let changed = true; changed;) {
    changed = false;
    for (const match of code.matchAll(new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*=\s*(?:${[...aliases].join("|")})\s*[;,]`, "g"))) if (!aliases.has(match[1])) { aliases.add(match[1]); changed = true; }
  }
  assert.doesNotMatch(code, new RegExp(String.raw`\b(?:${[...aliases].join("|")})\s*(?:\.\s*(?:requestVersion|activeAudioVersion|activeAudioUrl|audioActivatedAt|consecutiveResolveFailures)\b|\[)`));
}
test("request ownership rejects every legacy field read and write including aliases", () => {
  const ui = path.join(import.meta.dirname, "../ui");
  for (const name of fs.readdirSync(ui).filter(name => name.endsWith(".ts"))) assertRequestOwnership(fs.readFileSync(path.join(ui, name), "utf8"));
  const player = maskCommentsAndStrings(fs.readFileSync(path.join(ui, "player-state.ts"), "utf8"));
  assert.doesNotMatch(player, /\b(?:requestVersion|activeAudioVersion|activeAudioUrl|audioActivatedAt|consecutiveResolveFailures)\s*:/);
  for (const field of ["requestVersion", "activeAudioVersion", "activeAudioUrl", "audioActivatedAt", "consecutiveResolveFailures"]) for (const example of [`playerState.${field};`, `playerState.${field} = value;`, `const old = playerState; old.${field};`]) assert.throws(() => assertRequestOwnership(example));
  assert.doesNotThrow(() => assertRequestOwnership("playerState.currentPages; playerState.lastEmittedTrackIdentity;"));
});
test("request state has no platform clock or media operations and no URL projection", () => {
  const ui = path.join(import.meta.dirname, "../ui"), source = fs.readFileSync(path.join(ui, "playback-request-state.ts"), "utf8");
  const request = source;
  assert.doesNotMatch(maskCommentsAndStrings(fs.readFileSync(path.join(import.meta.dirname, "../ui/app-state.ts"), "utf8")), /\bfunction\s+(?:initialPlaybackRequestState|createPlaybackRequestActions)\s*\(/);
  assert.doesNotMatch(maskCommentsAndStrings(request), /\b(?:Date|performance|Math|window|document|invoke|audio|AbortController|Promise|setTimeout)\b/);
  for (const file of ["home-view.ts", "search-view.ts", "library-view.ts", "pages-view.ts", "settings-view.ts", "playback-display-view.ts", "playback-settings-view.ts", "mini-player-host.ts", "playback-diagnostics.ts"]) assert.doesNotMatch(maskCommentsAndStrings(fs.readFileSync(path.join(ui, file), "utf8")), /\b(?:activeAudioUrl|playbackRequest|getRequestSnapshot)\b/);
});
