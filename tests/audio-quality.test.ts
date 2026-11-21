import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import vm from "node:vm";
import { createApplicationStore } from "../ui/store/app-state.ts";
import { createControllerContext } from "./helpers/controller-context.ts";
import { sourceSlice } from "./helpers/source-slice.ts";
import { shouldRecoverAudio } from "../ui/features/playback/playback-policy.ts";

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
  const recover = sourceSlice(source, "ui/features/playback/playback-core.ts", "async function replaceAudioAndSeek(", "function getQualitySourceSwap(");
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

const qualitySource = readFileSync(new URL("../ui/features/playback/playback-core.ts", import.meta.url), "utf8");
const coreFile = "ui/features/playback/playback-core.ts";
const qualityFlow = sourceSlice(qualitySource, coreFile, "let recoveryPromise", "function getRequestSnapshot(")
  + sourceSlice(qualitySource, coreFile, "function recoveryAttemptsFor(", "function refreshTrackLoudness(");
const oldUrl = "http://127.0.0.1/audio/first-quality";
const qualityInfo = (audioId: number | null, audioUrl = "http://127.0.0.1/audio/other-quality", isFallback = false) => ({ audioId, audioUrl, isFallback });

function qualityFixture({ audioId = 30280 as number | null, fallback = false } = {}) {
  const calls: { args: Record<string, unknown>; resolve(value: unknown): void; reject(error: unknown): void }[] = [];
  const notices: string[] = [], loads: string[] = [], gains: (number | null)[] = [];
  const search = { playbackBusy: false };
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let plays = 0, timerId = 0;
  const audio = Object.assign(new EventTarget(), {
    src: oldUrl, currentTime: 19, duration: 100, paused: true, ended: false, readyState: 1,
    error: null as { code: number } | null,
    load() {
      loads.push(this.src);
      this.currentTime = 0;
      this.readyState = 0;
      this.error = null;
      this.dispatchEvent(new Event("emptied"));
    },
    async play() { ++plays; this.paused = false; },
  });
  Object.defineProperty(audio, "currentSrc", { get: () => audio.src });
  const context = createControllerContext({
    audio, Event, DOMException, HTMLMediaElement: { HAVE_METADATA: 1 }, MAX_AUDIO_RECOVERIES: 2,
    playerState: { requestVersion: 7, activeAudioVersion: 7, activeAudioUrl: oldUrl, audioActivatedAt: 0, currentIndex: 0, queue: [{ bvid: "BV1xx411c7mD" }] },
    recoveryVersion: 7, recoveryAttempts: 1, playingAudioVersion: 7,
    playRecordedForCurrentTrack: true, cacheRequestedForCurrentTrack: true, loudnessAnalyzedForCurrentTrack: true,
    currentVideoPage: () => ({ cid: 42, page: 2, part: "P2", durationSeconds: 100 }),
    currentAudioCacheCid: () => 42, getSearchSnapshot: () => search,
    window: {
      recordPlaybackDiag() {},
      setTimeout(callback: () => void, delay: number) { timers.set(++timerId, { callback, delay }); return timerId; },
      clearTimeout(id: number) { timers.delete(id); },
    }, performance: { now: () => 0 },
    refreshTrackLoudness: () => gains.push(context.getApplicationStore().getState().playbackDisplay.audioQuality.audioId),
    showPlaybackNotice: (message: string) => notices.push(message),
    shouldRecoverAudio,
    invoke(command: string, args: Record<string, unknown>) {
      assert.equal(command, "prepare_audio");
      return new Promise<unknown>((resolve, reject) => calls.push({ args, resolve, reject }));
    },
  });
  const store = context.getApplicationStore() as ReturnType<typeof createApplicationStore>;
  store.actions.playbackDisplay.setAudioQuality({ preference: "highest", audioId, isFallback: fallback });
  vm.runInContext(qualityFlow, context);
  audio.addEventListener("error", context.handleAudioRecoveryError);
  const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
  const metadata = () => { audio.readyState = 1; audio.dispatchEvent(new Event("loadedmetadata")); };
  const error = () => { audio.error = { code: 2 }; audio.dispatchEvent(new Event("error")); };
  const choose = (quality: CommandContract.AudioQuality): Promise<void> => {
    store.actions.settings.setAudioQuality(quality);
    return context.switchCurrentAudioQuality(quality);
  };
  const expire = () => {
    const timer = [...timers.values()][0];
    assert.equal(timer?.delay, 10_000);
    timer.callback();
  };
  const intent = () => context.getQualitySwitchIntent();
  const toggle = (): Promise<void> => context.getPlaybackCommands().togglePlayPause();
  return { calls, notices, loads, audio, gainIds: gains, search, store, flush, metadata, error, choose, timers, expire, intent, toggle, playCount: () => plays };
}

for (const [name, audioId, isFallback] of [["yt-dlp", null, true], ["durl", null, false]] as const) {
  test(`active ${name} only saves the quality preference`, async () => {
    const h = qualityFixture({ audioId, fallback: isFallback });
    await h.choose("64k");
    assert.equal(h.store.getState().settings.audioQuality, "64k");
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.loads, []);
  });
}

for (const [name, audioId, isFallback] of [["same actual ID", 30280, false], ["empty ID", null, true]] as const) {
  test(`a quality result with ${name} leaves the current source and marks in place`, async () => {
    const h = qualityFixture();
    const switching = h.choose("64k");
    h.calls[0].resolve(qualityInfo(audioId, undefined, isFallback));
    await switching;
    assert.equal(h.store.getState().settings.audioQuality, "64k");
    assert.equal(h.audio.src, oldUrl);
    assert.deepEqual(h.loads, []);
    assert.equal(h.store.getState().playbackSession.cacheRequestedForCurrentTrack, true);
    assert.equal(h.store.getState().playbackSession.loudnessAnalyzedForCurrentTrack, true);
  });
}

test("loading, pending resume and recovery only save quality, with no delayed switch", async () => {
  const h = qualityFixture();
  h.search.playbackBusy = true;
  await h.choose("64k");
  h.search.playbackBusy = false;
  h.store.actions.playbackSession.setPendingResume({ positionSeconds: 19, page: 2, cid: 42 });
  await h.choose("132k");
  assert.equal(h.store.getState().settings.audioQuality, "132k");
  h.store.actions.playbackSession.setPendingResume(null);
  await h.flush();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.loads, []);

  h.error();
  await h.flush();
  assert.equal(h.calls.length, 1);
  await h.choose("192k");
  assert.equal(h.store.getState().settings.audioQuality, "192k");
  h.calls[0].resolve(qualityInfo(30280)); await h.flush();
  h.metadata(); await h.flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.store.getState().playbackDisplay.audioQuality.audioId, 30280);
});

test("selecting the current preference invalidates a pending request, and only the latest result applies", async () => {
  const h = qualityFixture();
  const oldest = h.choose("64k");
  await h.choose("highest");
  h.calls[0].resolve(qualityInfo(30216));
  await oldest;
  assert.deepEqual(h.loads, []);

  const older = h.choose("64k");
  const latest = h.choose("132k");
  const latestUrl = "http://127.0.0.1/audio/latest-quality";
  h.calls[2].resolve(qualityInfo(30232, latestUrl)); await h.flush();
  h.metadata(); await latest;
  h.calls[1].resolve(qualityInfo(30216)); await older;
  assert.deepEqual(h.loads, [latestUrl]);
});

test("a second media handoff waits for the one already started and keeps the paused position", async () => {
  const h = qualityFixture();
  const first = h.choose("132k");
  h.calls[0].resolve(qualityInfo(30232)); await h.flush();
  const last = h.choose("64k");
  assert.equal(h.calls.length, 1);
  h.metadata(); await first; await h.flush();
  assert.equal(h.audio.currentTime, 19);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].args.quality, "64k");
  h.calls[1].resolve(qualityInfo(30216, "http://127.0.0.1/audio/last-quality")); await h.flush();
  h.metadata(); await last;
  assert.equal(h.audio.currentTime, 19);
  assert.equal(h.store.getState().playbackDisplay.audioQuality.audioId, 30216);
  assert.equal(h.playCount(), 0);
});

test("navigation during a media handoff prevents late metadata from seeking or resuming", async () => {
  const h = qualityFixture();
  h.audio.paused = false;
  const switching = h.choose("64k");
  h.calls[0].resolve(qualityInfo(30216)); await h.flush();
  assert.equal(h.timers.size, 1);
  const version = h.store.actions.playbackRequest.beginRequest();
  assert.equal(h.timers.size, 0);
  assert.equal(getEventListeners(h.audio, "loadedmetadata").length, 0);
  const other = "http://127.0.0.1/audio/next-track";
  h.store.actions.playbackRequest.activateAudio(version, other, 0);
  h.audio.src = other;
  h.audio.load();
  h.audio.currentTime = 4;
  h.metadata(); await switching;
  assert.equal(h.audio.src, other);
  assert.equal(h.audio.currentTime, 4);
  assert.equal(h.playCount(), 0);
  assert.deepEqual(h.notices, []);
});

test("a failed quality resolve keeps the old source and never consumes recovery attempts", async () => {
  const h = qualityFixture();
  const switching = h.choose("64k");
  h.calls[0].reject("resolution failed");
  await switching;
  assert.equal(h.audio.src, oldUrl);
  assert.deepEqual(h.loads, []);
  assert.deepEqual(h.notices, ["切换音质失败，继续使用当前音质"]);
  assert.equal(h.store.getState().playbackSession.recoveryAttempts, 1);
});

for (const restored of [true, false]) {
  test(`new media failure tries the old address once and reports ${restored ? "restoration" : "interruption"}`, async () => {
    const h = qualityFixture();
    const switching = h.choose("64k");
    const next = qualityInfo(30216);
    h.calls[0].resolve(next); await h.flush();
    h.error(); await h.flush();
    assert.deepEqual(h.loads, [next.audioUrl, oldUrl]);
    if (restored) h.metadata();
    else h.error();
    await switching;
    assert.deepEqual(h.notices, [restored ? "切换音质失败，已恢复原音质" : "切换音质失败，播放已中断。"]);
    assert.equal(h.calls.length, 1);
    assert.equal(h.store.getState().playbackSession.recoveryAttempts, 1);
    assert.equal(h.store.getState().playbackDisplay.audioQuality.audioId, 30280);
    if (restored) assert.equal(h.audio.currentTime, 19);
  });
}

for (const restored of [true, false]) {
  test(`metadata timeout falls back once and releases the controls after ${restored ? "recovery" : "the second timeout"}`, async () => {
    const h = qualityFixture();
    const switching = h.choose("64k");
    const next = qualityInfo(30216);
    h.calls[0].resolve(next); await h.flush();
    assert.equal(h.timers.size, 1);
    h.expire(); await h.flush();
    assert.deepEqual(h.loads, [next.audioUrl, oldUrl]);
    assert.equal(h.timers.size, 1);
    assert.ok(h.intent());
    if (restored) h.metadata(); else h.expire();
    await switching;
    await h.toggle();
    assert.equal(h.playCount(), 1, "control must play the actual audio after metadata timeout");
    assert.equal(h.intent(), null);
    assert.equal(h.timers.size, 0);
    assert.equal(getEventListeners(h.audio, "loadedmetadata").length, 0);
    assert.equal(getEventListeners(h.audio, "emptied").length, 0);
    assert.equal(getEventListeners(h.audio, "error").length, 1);
    assert.deepEqual(h.notices, [restored ? "切换音质失败，已恢复原音质" : "切换音质失败，播放已中断。"]);
    assert.equal(h.store.getState().playbackSession.recoveryAttempts, 1);
  });
}

test("a newer switch takes over a handoff that times out without inheriting its failure notice", async () => {
  const h = qualityFixture();
  const first = h.choose("132k");
  h.calls[0].resolve(qualityInfo(30232)); await h.flush();
  const latest = h.choose("64k");
  h.expire(); await h.flush();
  h.metadata(); await first; await h.flush();
  assert.equal(h.calls[1].args.quality, "64k");
  h.calls[1].resolve(qualityInfo(30216)); await h.flush();
  h.metadata(); await latest;
  assert.equal(h.store.getState().playbackDisplay.audioQuality.audioId, 30216);
  assert.deepEqual(h.notices, []);
  assert.equal(h.timers.size, 0);
});

test("switching to a cached variant still leaves the last automatic recovery available", async () => {
  const h = qualityFixture();
  const switching = h.choose("64k");
  const cached = qualityInfo(30216, "http://127.0.0.1/audio/cached-quality");
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args)), {
    quality: "64k", bvId: "BV1xx411c7mD", cid: 42, cacheCid: 42, page: 2, part: "P2", durationSeconds: 100,
  });
  h.calls[0].resolve(cached); await h.flush();
  h.metadata(); await switching;
  const session = h.store.getState().playbackSession;
  assert.equal(h.audio.src, cached.audioUrl);
  assert.equal(h.audio.currentTime, 19);
  assert.equal(h.audio.paused, true);
  assert.equal(session.playRecordedForCurrentTrack, true);
  assert.equal(session.cacheRequestedForCurrentTrack, false);
  assert.equal(session.loudnessAnalyzedForCurrentTrack, false);
  assert.deepEqual(h.gainIds, [30216]);

  h.error(); await h.flush();
  assert.equal(h.calls.length, 2, "the last automatic recovery must still run");
  assert.equal(h.calls[1].args.audioId, 30216);
  h.calls[1].resolve(qualityInfo(30216)); await h.flush();
  h.metadata(); await h.flush();
  assert.equal(h.store.getState().playbackSession.recoveryAttempts, 2);
  assert.deepEqual(h.notices, []);
});
