import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

const fields = ["currentPages", "lastEmittedTrackIdentity", "playRecordedForCurrentTrack", "cacheRequestedForCurrentTrack", "pendingResume", "resumeInProgress", "lastPlaybackStateSavedAt", "recoveryVersion", "recoveryAttempts", "playingAudioVersion", "playbackIntended", "pendingPastedBvPages", "loudnessQueryVersion", "loudnessAnalyzedForCurrentTrack"];
function assertSessionOwnership(source: string) {
  const code = maskCommentsAndStrings(source);
  assert.doesNotMatch(code, /\bplayerState\b/);
  assert.doesNotMatch(code, new RegExp(String.raw`(?<![\w.])(?:${fields.slice(2).join("|")})\b`));
}
test("session ownership rejects all legacy data reads and writes and removes the player object", () => {
  const ui = path.join(import.meta.dirname, "../ui");
  for (const file of ["playback-core.ts", "main.ts", "player-state.ts", "video-pages.ts"]) assertSessionOwnership(fs.readFileSync(path.join(ui, file), "utf8"));
  for (const field of fields) for (const example of [`playerState.${field};`, `playerState.${field} = input;`]) assert.throws(() => assertSessionOwnership(example));
  for (const field of fields.slice(2)) for (const example of [field + ";", field + " = input;"]) assert.throws(() => assertSessionOwnership(example));
});
test("session state has no platform handles clocks randomness or sensitive URL data", () => {
  const app = fs.readFileSync(path.join(import.meta.dirname, "../ui/playback-session-state.ts"), "utf8");
  const factory = app;
  assert.doesNotMatch(maskCommentsAndStrings(fs.readFileSync(path.join(import.meta.dirname, "../ui/app-state.ts"), "utf8")), /\bfunction\s+(?:initialPlaybackSessionState|createPlaybackSessionActions)\s*\(/);
  assert.doesNotMatch(maskCommentsAndStrings(factory), /\b(?:Date|performance|Math|window|document|invoke|audio|Promise|AbortController|setTimeout|requestAnimationFrame|activeAudioUrl)\b/);
});
