import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { createApplicationStore } from "../ui/store/app-state.ts";
import { createControllerContext } from "./helpers/controller-context.ts";
import { sourceSlice } from "./helpers/source-slice.ts";

test("audio quality defaults, restores and persists only its own preference without changing active media", () => {
  const values = new Map<string, string>();
  const calls: string[] = [];
  const store = createApplicationStore({ invoke: async () => { calls.push("invoke"); throw Error("Unexpected IPC"); }, setTimeout: () => 0, clearTimeout() {}, report() {}, settings: {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem() {}, cancelCacheNotice() {}, scheduleCacheNotice() {},
  } }, { freeze: true });
  const key = "bilibili-music.audio-quality";
  assert.equal(store.getState().settings.audioQuality, "highest");
  store.actions.playbackDisplay.setAudioQuality({ preference: "192k", audioId: 30280, isFallback: false });
  const active = store.getState().playbackDisplay;
  for (const quality of ["highest", "192k", "132k", "64k"] as const) {
    store.actions.settings.setAudioQuality(quality);
    assert.equal(values.get(key), quality);
    store.actions.settings.restoreAudioQuality();
    assert.equal(store.getState().settings.audioQuality, quality);
    assert.equal(store.getState().playbackDisplay, active);
  }
  for (const invalid of ["", "unknown", "30280"]) {
    values.set(key, invalid);
    store.actions.settings.restoreAudioQuality();
    assert.equal(store.getState().settings.audioQuality, "highest");
    assert.equal(values.get(key), invalid);
  }
  values.delete(key);
  store.actions.settings.restoreAudioQuality();
  assert.equal(store.getState().settings.audioQuality, "highest");
  assert.deepEqual([...values.keys()], []);
  assert.deepEqual(calls, []);
});

test("audio quality storage failure is reported without touching the active media", () => {
  const store = createApplicationStore({ invoke: async () => { throw Error("Unexpected IPC"); }, setTimeout: () => 0, clearTimeout() {}, report() {}, settings: {
    getItem() { throw Error("read"); }, setItem() { throw Error("write"); }, removeItem() {}, cancelCacheNotice() {}, scheduleCacheNotice() {},
  } });
  store.actions.settings.restoreAudioQuality();
  const before = store.getState().playbackDisplay;
  store.actions.settings.setAudioQuality("64k");
  assert.match(store.getState().settings.view.notice!.text, /音质设置保存失败/);
  assert.equal(store.getState().playbackDisplay, before);
});

test("recovery uses the active actual audio ID despite a changed global preference", async () => {
  const source = readFileSync(new URL("../ui/features/playback/playback-core.ts", import.meta.url), "utf8");
  const recover = sourceSlice(source, "ui/features/playback/playback-core.ts", "async function recoverCurrentAudio(", "function handleAudioRecoveryError(");
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const context = createControllerContext({
    playerState: { requestVersion: 1, activeAudioUrl: "http://local/audio/old", currentIndex: 0, queue: [{ bvid: "BV1xx411c7mD" }] },
    audio: { duration: 120, currentTime: 30, load() {}, play: async () => {} },
    currentVideoPage: () => ({ cid: 42, page: 1, part: "P1", durationSeconds: 120 }), currentAudioCacheCid: () => 42,
    window: { recordPlaybackDiag() {} }, performance: { now: () => 10 }, waitForRecoveryMetadata: async () => true,
    refundRecoveryAttempt() {}, showPlaybackNotice() {},
    invoke: async (command: string, args: Record<string, unknown>) => { calls.push({ command, args }); return { audioUrl: "http://local/audio/new", audioId: 30232, isFallback: false }; },
  });
  context.getApplicationStore().actions.playbackDisplay.setAudioQuality({ preference: "highest", audioId: 30232, isFallback: false });
  context.getApplicationStore().actions.settings.setAudioQuality("64k", false);
  vm.runInContext(recover, context);
  await vm.runInContext('recoverCurrentAudio(1, "http://local/audio/old", 30, true)', context);
  assert.equal(calls[0].args.audioId, 30232);
  assert.equal(calls[0].args.quality, undefined);
  assert.equal(context.getApplicationStore().getState().playbackDisplay.audioQuality.audioId, 30232);
  assert.equal(context.getApplicationStore().getState().settings.audioQuality, "64k");
});

test("a late loudness result for a replaced audio variant cannot change the current gain", async () => {
  const source = readFileSync(new URL("../ui/features/playback/playback-core.ts", import.meta.url), "utf8");
  const analyze = sourceSlice(source, "ui/features/playback/playback-core.ts", "function analyzeCurrentTrackAtThreshold()", "async function loadCurrentTrack(");
  let resolve!: (value: number) => void;
  const result = new Promise<number>(yes => { resolve = yes; });
  const gains: number[] = [], calls: Record<string, unknown>[] = [];
  const context = createControllerContext({
    playerState: { requestVersion: 1, activeAudioUrl: "http://local/audio/old", currentIndex: 0, queue: [{ bvid: "BV1xx411c7mD" }] },
    audio: { duration: 60, currentTime: 31 }, currentVideoPage: () => ({ cid: 42 }), cacheRequestPromise: null,
    isLoudnessNormalizationEnabled: () => true, setNormalizationGain: (gain: number) => gains.push(gain), lufsToGain: () => 0.5,
    invoke: (_command: string, args: Record<string, unknown>) => { calls.push(args); return result; },
    console: { warn() {} },
  });
  context.getApplicationStore().actions.playbackDisplay.setAudioQuality({ preference: "highest", audioId: 30280, isFallback: false });
  vm.runInContext(analyze, context);
  context.analyzeCurrentTrackAtThreshold();
  assert.equal(calls[0].audioId, 30280);
  context.getRequestActions().replaceAudio("http://local/audio/new", 0);
  resolve(-12);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(gains, []);
});
