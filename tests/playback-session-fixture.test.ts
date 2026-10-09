import assert from "node:assert/strict";
import vm from "node:vm";
import { test } from "node:test";
import { createSessionContext } from "./helpers/playback-session-fixture.ts";

const samples = {
  currentPages: [{ page: 1, cid: 11, part: "P1", durationSeconds: 80 }], lastEmittedTrackIdentity: "identity",
  playRecordedForCurrentTrack: true, cacheRequestedForCurrentTrack: true,
  pendingResume: { positionSeconds: 35, page: 2, cid: 22 }, resumeInProgress: true, lastPlaybackStateSavedAt: 1700000000123,
  recoveryVersion: 7, recoveryAttempts: 2, playingAudioVersion: 7, playbackIntended: true,
  pendingPastedBvPages: { bvid: "BV1GF4X6MEb1", requestVersion: 7 }, loudnessQueryVersion: 7, loudnessAnalyzedForCurrentTrack: true,
};
const methods = {
  currentPages: "setCurrentPages", lastEmittedTrackIdentity: "setTrackIdentity", playRecordedForCurrentTrack: "setPlayRecorded",
  cacheRequestedForCurrentTrack: "setCacheRequested", pendingResume: "setPendingResume", resumeInProgress: "setResumeInProgress",
  lastPlaybackStateSavedAt: "setLastSavedAt", recoveryVersion: "setRecoveryVersion", recoveryAttempts: "setRecoveryAttempts",
  playingAudioVersion: "setPlayingVersion", playbackIntended: "setPlaybackIntended", pendingPastedBvPages: "setPendingPastedPages",
  loudnessQueryVersion: "setLoudnessQueryVersion", loudnessAnalyzedForCurrentTrack: "setLoudnessAnalyzed",
};
// VideoPage: src-tauri/src/guest_playurl.rs:47-53; PlaybackState: library/playback_state.rs:18-26.
for (const field of Object.keys(samples) as (keyof typeof samples)[]) {
  test(`session fixture imports ${field} only at the business entry boundary`, () => {
    const player = field === "currentPages" || field === "lastEmittedTrackIdentity";
    const context = createSessionContext({ playerState: {}, expected: samples[field] });
    if (player) context.playerState[field] = structuredClone(samples[field]); else context[field] = structuredClone(samples[field]);
    vm.runInContext(`function inspect() { return getSessionSnapshot().${field}; }`, context);
    assert.deepEqual(structuredClone(context.inspect()), samples[field]);
  });
  test(`session fixture publishes ${field} only at the business exit boundary`, () => {
    const context = createSessionContext({ playerState: {}, expected: samples[field] });
    vm.runInContext(`function change() { getSessionActions().${methods[field]}(expected); }`, context); context.change();
    const value = field === "currentPages" || field === "lastEmittedTrackIdentity" ? context.playerState[field] : context[field];
    assert.deepEqual(structuredClone(value), samples[field]);
  });
}

test("session fixture preserves original promises globals and listener removal", async () => {
  const listeners = new Set<Function>(); const pending = Promise.resolve();
  const context = createSessionContext({ playerState: {}, invoke: () => pending,
    audio: { addEventListener(_name: string, fn: Function) { listeners.add(fn); }, removeEventListener(_name: string, fn: Function) { listeners.delete(fn); } } });
  vm.runInContext('function run() { return invoke(); } function event() {} audio.addEventListener("play", event);', context);
  assert.equal(context.run() === pending, true); await pending; assert.equal(vm.runInContext("typeof Math.random", context), "function");
  vm.runInContext('audio.removeEventListener("play", event);', context); assert.equal(listeners.size, 0);
});


test("session fixture keeps synchronous subscribers inside the current boundary", () => {
  const context = createSessionContext({ playerState: {} });
  vm.runInContext('function notify() { return getSessionSnapshot().recoveryAttempts; } getApplicationStore().subscribe(notify); function inspect() { return getSessionSnapshot().recoveryAttempts; }', context);
  context.recoveryAttempts = 2;
  assert.equal(context.inspect(), 2);
});
