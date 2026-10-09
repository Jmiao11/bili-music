import { createSessionContext as createQueueContext } from "./helpers/playback-session-fixture.ts";
import { sourceSlice } from "./helpers/source-slice.ts";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const appearance = readFileSync(path.join(import.meta.dirname, "../ui/appearance.ts"), "utf8");
const main = readFileSync(path.join(import.meta.dirname, "../ui/main.ts"), "utf8");
const core = readFileSync(path.join(import.meta.dirname, "../ui/playback-core.ts"), "utf8").replace(/\r\n/g, "\n");
const policy = readFileSync(path.join(import.meta.dirname, "../ui/playback-policy.ts"), "utf8");
const code = sourceSlice(core, "ui/playback-core.ts", "let cacheRequestPromise", "let recoveryPromise")
  + sourceSlice(appearance, "ui/appearance.ts", "const VOLUME_KEY", "const root =")
  + sourceSlice(appearance, "ui/appearance.ts", "function clampNumber(", "function isShortcutModifierCode(")
  + sourceSlice(appearance, "ui/appearance.ts", "function applyVolume(", "function startAppearance()", {"endAfterStart":true})
  + sourceSlice(core, "ui/playback-core.ts", "function emitCurrentTrackChanged(", "function resetRandomRemaining(")
  + sourceSlice(policy, "ui/playback-policy.ts", "// 与 src-tauri/", "\n}", { endAfterStart: true, includeEnd: true }) + "\n\n"
  + sourceSlice(core, "ui/playback-core.ts", "function refreshTrackLoudness(", "async function loadCurrentTrack(");
const cacheListenerCode = sourceSlice(core, "ui/playback-core.ts", "audio.addEventListener(\"timeupdate\"", "\n}\n", { startLastBefore: "if (getSessionSnapshot().cacheRequestedForCurrentTrack) return;", endAfterStart: true }) + "\n\n"
  + sourceSlice(main, "ui/main.ts", "audio.addEventListener(\"timeupdate\", analyzeCurrentTrackAtThreshold);", ";", { endAfterStart: true, includeEnd: true });
const endedHandlerCode = sourceSlice(main, "ui/main.ts", "audio.addEventListener(\"ended\", (event) => {", "initPlaybackPersistenceAndCache();", {"endAfterStart":true});
const settingKey = "bilibili-music.loudness-normalization";
const volumeKey = "bilibili-music.volume";
const applyNormalizationCode = sourceSlice(appearance, "ui/appearance.ts", "function applyLoudnessNormalization(", "function initializeLoudnessNormalization(");
const loudnessToggleListeners = sourceSlice(appearance, "ui/appearance.ts", "loudnessNormalizationToggle.addEventListener(\"change\"", "progressSlider.addEventListener(\"pointerdown\"");
const loudnessDialogCode = sourceSlice(core, "ui/playback-core.ts", "function showLoudnessNormalizationDialog(", "function waitForAudioMetadata(");

type Query = { command: string; args: Record<string, unknown>; resolve(value: unknown): void; reject(reason?: unknown): void };
type Animation = { callbacks: Map<number, (timestamp: number) => void>; cancelled: number[]; nextId: number; now: number; runNext(now: number): number };
function setup(stored?: Map<string, unknown>, options?: { controlledAnimation?: boolean }): { app: import("node:vm").Context; queries: Query[]; warnings: unknown[][]; progress: unknown[]; stored: Map<string, unknown>; state: { requestVersion: number; queue: { bvid: string }[]; currentIndex: number; currentPages: { cid: number }[]; activeAudioVersion: number; activeAudioUrl: string; audioActivatedAt: number }; animation: Animation; emitTimeUpdate(): void; emitEnded(): void };
function setup(stored = new Map(), { controlledAnimation = false } = {}) {
  const queries: { command: string; args: Record<string, unknown>; resolve(value: unknown): void; reject(reason?: unknown): void }[] = [];
  const warnings: unknown[][] = [];
  const progress: unknown[] = [];
  const state = {
    requestVersion: 1,
    queue: [{ bvid: "BV1GF4X6MEb1" }],
    currentIndex: 0,
    currentPages: [{ cid: 1 }],
    activeAudioVersion: 1,
    activeAudioUrl: "http://127.0.0.1/audio/11111111111111111111111111111111",
    audioActivatedAt: 0,
  };
  const timeupdateListeners: ((...args: unknown[]) => unknown)[] = [];
  const endedListeners: ((...args: unknown[]) => unknown)[] = [];
  const playerAudio = {
    volume: 1, duration: 100, currentTime: 0, currentSrc: state.activeAudioUrl, ended: false,
    addEventListener: (type: string, listener: (...args: unknown[]) => unknown) => {
      if (type === "timeupdate") timeupdateListeners.push(listener);
      if (type === "ended") endedListeners.push(listener);
    },
  };
  const animation: { callbacks: Map<number, (timestamp: number) => void>; cancelled: number[]; nextId: number; now: number; runNext?: (now: number) => number } = { callbacks: new Map(), cancelled: [], nextId: 1, now: 0 };
  const requestAnimationFrame: (callback: (timestamp: number) => void) => number = controlledAnimation
    ? callback => {
        const id = animation.nextId++;
        animation.callbacks.set(id, callback);
        return id;
      }
    : callback => {
        const id = animation.nextId++;
        animation.now += 250;
        callback(animation.now);
        return id;
      };
  const cancelAnimationFrame: (id: number) => void = id => {
    animation.cancelled.push(id);
    animation.callbacks.delete(id);
  };
  animation.runNext = now => {
    const entry = animation.callbacks.entries().next().value;
    if (entry === undefined) throw new Error("Scheduled animation frame is missing");
    const [id, callback] = entry;
    animation.callbacks.delete(id);
    callback(now);
    return id;
  };
  const context = createQueueContext({
    playerAudio, audio: playerAudio, volumeSlider: { value: "1" }, loudnessNormalizationToggle: { checked: false },
    playerState: state, currentVideoPage: () => state.currentPages[0], currentAudioCacheCid: () => state.currentPages[0]?.cid,
    currentTrackSnapshot: () => ({
      bvid: state.queue[state.currentIndex]?.bvid ?? "", title: "test", uploader: "test",
      thumbnailUrl: "https://example.test/cover.jpg", durationSeconds: 100,
    }),
    advancePageWithinCurrentBv: () => false, playNext() {},
    window: { dispatchEvent() {} }, Event, CustomEvent: class { declare type: string; declare detail: unknown; constructor(type: string, init: { detail?: unknown }) { this.type = type; this.detail = init.detail; } },
    updateRangeProgress: (_: unknown, value: unknown) => progress.push(value),
    localStorage: { getItem: (key => stored.get(key) ?? null) as (key: string) => string | null, setItem: (key: string, value: unknown) => stored.set(key, value) },
    console: { warn: (...args: unknown[]) => warnings.push(args), debug() {} },
    invoke: (command: string, args: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => queries.push({ command, args, resolve, reject })),
    requestAnimationFrame, cancelAnimationFrame,
  });
  vm.runInContext(code, context);
  vm.runInContext(cacheListenerCode, context);
  vm.runInContext(endedHandlerCode, context);
  context.initializeLoudnessNormalization();
  return {
    app: context, queries, warnings, progress, stored, state, animation,
    emitTimeUpdate: () => timeupdateListeners.forEach(listener => listener()),
    emitEnded: () => endedListeners.forEach(listener => listener({ timeStamp: 1 })),
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

function setupLoudnessDialogToggle(checked: boolean) {
  const listeners: ((...args: unknown[]) => unknown)[] = [];
  const calls: string[] = [];
  const loudnessNormalizationToggle = {
    checked,
    addEventListener(type: string, listener: (...args: unknown[]) => unknown) {
      if (type === "change") listeners.push(listener);
    },
  };
  const context = createQueueContext({
    LOUDNESS_NORMALIZATION_KEY: settingKey,
    loudnessNormalizationToggle,
    setNormalizationGain: () => calls.push("gain"),
    refreshTrackLoudness() {},
    localStorage: { setItem() {} },
    console: { warn() {} },
    showLoudnessNormalizationDialog: () => calls.push("dialog"),
  });
  vm.runInContext(
    `let loudnessNormalizationEnabled = false;\n${applyNormalizationCode}\n${loudnessToggleListeners}`,
    context,
  );
  return {
    calls,
    toggle: loudnessNormalizationToggle,
    dispatchChange() {
      for (const listener of listeners) listener();
    },
  };
}

type FakeElement = { tagName: string; className: string; textContent: string; type: string; children: FakeElement[]; listeners: Record<string, (...args: unknown[]) => unknown>; focused: boolean; append(...children: FakeElement[]): void; addEventListener(type: string, listener: (...args: unknown[]) => unknown): void; focus(): void };
function fakeElement(tagName: string): FakeElement {
  return {
    tagName,
    className: "",
    textContent: "",
    type: "",
    children: [],
    listeners: {},
    focused: false,
    append(...children: FakeElement[]) {
      this.children.push(...children);
    },
    addEventListener(type: string, listener: (...args: unknown[]) => unknown) {
      this.listeners[type] = listener;
    },
    focus() {
      this.focused = true;
    },
  };
}

test("LUFS formula matches Rust target, attenuation, floor and absent values", () => {
  const { app } = setup();
  const floor = 10 ** (-12 / 20);
  assert.equal(app.lufsToGain(-14), 1);
  assert.equal(app.lufsToGain(-12), 10 ** (-2 / 20));
  assert.equal(app.lufsToGain(-30), 1);
  assert.equal(app.lufsToGain(0), floor);
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) assert.equal(app.lufsToGain(value), 1);
  for (let lufs = -200; lufs <= 200; lufs += 0.5) {
    const gain = app.lufsToGain(lufs);
    assert.ok(gain >= floor && gain <= 1);
    // -12 dB 精确为 0.251188643…；四位小数才是 0.2512。
    assert.ok(Number(gain.toFixed(4)) >= 0.2512);
  }
});

test("effective volume multiplies gain without moving or persisting the slider", () => {
  const { app, stored, progress } = setup();
  app.applyVolume(0.8);
  app.applyLoudnessNormalization(true);
  const before = [...stored];
  const progressCount = progress.length;
  app.setNormalizationGain(0.5);
  assert.equal(app.playerAudio.volume, 0.4);
  assert.equal(app.volumeSlider.value, "0.8");
  assert.equal(stored.get(volumeKey), "0.8");
  assert.deepEqual([...stored], before);
  assert.equal(progress.length, progressCount);
  app.applyVolume(0.6);
  assert.equal(app.playerAudio.volume, 0.3);
  assert.equal(app.volumeSlider.value, "0.6");
  assert.equal(stored.get(volumeKey), "0.6");
});

test("normalization defaults off and disabled refresh never queries", () => {
  const { app, queries, stored } = setup();
  assert.equal(app.isLoudnessNormalizationEnabled(), false);
  assert.equal(stored.has(settingKey), false);
  app.applyVolume(0.7);
  app.setNormalizationGain(0.3);
  app.refreshTrackLoudness();
  assert.equal(app.playerAudio.volume, 0.7);
  assert.equal(queries.length, 0);
});

test("toggle applies current cached loudness and disabling restores user volume immediately", async () => {
  const { app, queries, stored } = setup();
  app.applyVolume(0.8);
  app.applyLoudnessNormalization(true);
  assert.equal(queries[0].command, "get_track_loudness");
  assert.equal(queries[0].args.key, "BV1GF4X6MEb1:1");
  queries[0].resolve(-8);
  await settle();
  assert.equal(app.playerAudio.volume, 0.8 * 10 ** (-6 / 20));
  app.applyLoudnessNormalization(false);
  assert.equal(app.playerAudio.volume, 0.8);
  assert.equal(app.volumeSlider.value, "0.8");
  assert.equal(stored.get(settingKey), "false");
});

test("rapid track changes discard late results, including while next track is resolving", async () => {
  const { app, queries, state } = setup();
  app.applyLoudnessNormalization(true);
  state.requestVersion++;
  state.currentPages = [{ cid: 2 }];
  app.refreshTrackLoudness();
  queries[1].resolve(-12);
  await settle();
  const current = app.playerAudio.volume;
  queries[0].resolve(0);
  await settle();
  assert.equal(app.playerAudio.volume, current);
  app.refreshTrackLoudness();
  state.requestVersion++;
  queries[2].resolve(0);
  await settle();
  assert.equal(app.playerAudio.volume, 1);
});

test("disabling invalidates pending queries even when enabled again", async () => {
  const { app, queries } = setup();
  app.applyLoudnessNormalization(true);
  app.applyLoudnessNormalization(false);
  queries[0].resolve(0);
  await settle();
  assert.equal(app.playerAudio.volume, 1);
  app.applyLoudnessNormalization(true);
  app.applyLoudnessNormalization(false);
  app.applyLoudnessNormalization(true);
  queries[2].resolve(-12);
  await settle();
  queries[1].resolve(0);
  await settle();
  assert.equal(app.playerAudio.volume, 10 ** (-2 / 20));
});

test("missing cid, absent measurement and query failure keep unity gain and warn", async () => {
  const { app, queries, state, warnings } = setup();
  state.currentPages = [];
  app.applyLoudnessNormalization(true);
  assert.equal(queries.length, 0);
  state.currentPages = [{ cid: 1 }];
  app.refreshTrackLoudness();
  queries[0].resolve(null);
  await settle();
  assert.equal(app.playerAudio.volume, 1);
  app.refreshTrackLoudness();
  queries[1].reject(Error("synthetic read failure"));
  await settle();
  assert.equal(app.playerAudio.volume, 1);
  assert.equal(warnings.length, 3);
});

test("only stored true enables normalization on initialization", () => {
  for (const value of ["false", "invalid", "1"]) {
    const { app, queries } = setup(new Map([[settingKey, value]]));
    assert.equal(app.isLoudnessNormalizationEnabled(), false);
    assert.equal(queries.length, 0);
  }
  const { app, queries } = setup(new Map([[settingKey, "true"]]));
  assert.equal(app.loudnessNormalizationToggle.checked, true);
  assert.equal(queries.length, 1);
});

test("threshold analysis starts once at the threshold and does not repeat", () => {
  const { app, queries } = setup(new Map([[settingKey, "true"]]));
  app.audio.currentTime = 29;
  app.analyzeCurrentTrackAtThreshold();
  assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0);
  app.audio.currentTime = 30;
  app.analyzeCurrentTrackAtThreshold();
  app.analyzeCurrentTrackAtThreshold();
  assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 1);
});

test("threshold analysis waits for cache request regardless of its result", async () => {
  for (const succeeds of [true, false]) {
    const { app, queries, emitTimeUpdate } = setup(new Map([[settingKey, "true"]]));
    app.audio.currentTime = 30;
    emitTimeUpdate();
    const cache = queries.find(query => query.command === "cache_track_audio");
    assert.ok(cache);
    assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0);
    if (succeeds) cache.resolve("cached");
    else cache.reject(Error("synthetic cache failure"));
    await settle();
    assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 1);
  }
});

test("threshold analysis starts immediately without a cache request", () => {
  const { app, queries, state, emitTimeUpdate } = setup(new Map([[settingKey, "true"]]));
  state.activeAudioVersion = -1;
  app.audio.currentTime = 30;
  emitTimeUpdate();
  assert.equal(queries.filter(query => query.command === "cache_track_audio").length, 0);
  assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 1);
});

test("track switch while cache is pending drops the old analysis", async () => {
  const { app, queries, state, emitTimeUpdate } = setup(new Map([[settingKey, "true"]]));
  app.audio.currentTime = 30;
  emitTimeUpdate();
  const cache = queries.find(query => query.command === "cache_track_audio");
  if (cache === undefined) throw new Error("Expected cache is missing");
  state.requestVersion++;
  app.emitCurrentTrackChanged();
  cache.resolve("cached");
  await settle();
  assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0);
});

test("disabling normalization while cache is pending prevents analysis", async () => {
  const { app, queries, emitTimeUpdate } = setup(new Map([[settingKey, "true"]]));
  app.audio.currentTime = 30;
  emitTimeUpdate();
  app.applyLoudnessNormalization(false);
  const cached = queries.find(query => query.command === "cache_track_audio");
  if (cached === undefined) throw new Error("Audio cache request is missing");
  cached.resolve("cached");
  await settle();
  assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0);
});

test("threshold analysis stays off when normalization is disabled", () => {
  const { app, queries } = setup();
  app.audio.currentTime = 30;
  app.analyzeCurrentTrackAtThreshold();
  assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0);
});

test("ended skips loudness analysis when normalization is disabled", () => {
  const { app, queries, emitEnded } = setup();
  app.audio.ended = true;
  emitEnded();
  assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0);
});

test("ended analyzes loudness when normalization is enabled", () => {
  const { app, queries, emitEnded } = setup(new Map([[settingKey, "true"]]));
  app.audio.ended = true;
  emitEnded();
  const analysis = queries.find(query => query.command === "analyze_track_loudness");
  if (analysis === undefined) throw new Error("Expected analysis is missing");
  assert.equal(analysis.args.key, "BV1GF4X6MEb1:1");
  assert.equal(analysis.args.audioUrl, app.playerState.activeAudioUrl);
});

test("track change resets threshold analysis for the new track", () => {
  const { app, queries, state } = setup(new Map([[settingKey, "true"]]));
  app.audio.currentTime = 30;
  app.analyzeCurrentTrackAtThreshold();
  state.requestVersion++;
  state.queue = [{ bvid: "BV1NNY96LEwD" }];
  state.currentPages = [{ cid: 41821209264 }];
  app.emitCurrentTrackChanged();
  app.analyzeCurrentTrackAtThreshold();
  assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 2);
});

test("late threshold analysis result does not change gain", async () => {
  const { app, queries, state } = setup(new Map([[settingKey, "true"]]));
  app.audio.currentTime = 30;
  app.analyzeCurrentTrackAtThreshold();
  const analysis = queries.find(query => query.command === "analyze_track_loudness");
  if (analysis === undefined) throw new Error("Expected analysis is missing");
  state.requestVersion++;
  analysis.resolve(0);
  await settle();
  assert.equal(app.playerAudio.volume, 1);
});

test("new normalization fade cancels the old fade and reaches the new target", () => {
  const { app, animation } = setup(new Map([[settingKey, "true"]]), { controlledAnimation: true });
  app.setNormalizationGain(0.5);
  animation.runNext(0);
  animation.runNext(125);
  const oldFrame = animation.callbacks.keys().next().value;
  if (oldFrame === undefined) throw new Error("Expected oldFrame is missing");
  app.setNormalizationGain(0.25);
  assert.ok(animation.cancelled.includes(oldFrame));
  animation.runNext(125);
  animation.runNext(375);
  assert.equal(app.playerAudio.volume, 0.25);
});

test("volume slider cancels a fade and applies immediately without scheduling another", () => {
  const { app, animation, stored } = setup(new Map([[settingKey, "true"]]), { controlledAnimation: true });
  app.setNormalizationGain(0.5);
  const pendingFrame = animation.callbacks.keys().next().value;
  if (pendingFrame === undefined) throw new Error("Expected pendingFrame is missing");
  const nextId = animation.nextId;
  app.applyVolume(0.6);
  assert.ok(animation.cancelled.includes(pendingFrame));
  assert.equal(animation.nextId, nextId);
  assert.equal(app.playerAudio.volume, 0.3);
  assert.equal(stored.get(volumeKey), "0.6");
});

test("checking normalization opens the explanation and unchecking does not", () => {
  const enabled = setupLoudnessDialogToggle(true);
  enabled.dispatchChange();
  assert.equal(enabled.calls.filter(call => call === "dialog").length, 1);

  const disabled = setupLoudnessDialogToggle(false);
  disabled.dispatchChange();
  assert.equal(disabled.calls.includes("dialog"), false);
});

test("normalization gain still applies before the explanation is shown", () => {
  const enabled = setupLoudnessDialogToggle(true);
  enabled.dispatchChange();
  assert.deepEqual(enabled.calls, ["gain", "dialog"]);

  const disabled = setupLoudnessDialogToggle(false);
  disabled.dispatchChange();
  assert.deepEqual(disabled.calls, ["gain"]);
});

test("loudness explanation acknowledge button closes the shared dialog", () => {
  const body = fakeElement("div");
  const opens: { title: string; subtitle: string }[] = [];
  let closes = 0;
  const context = createQueueContext({
    document: { createElement: fakeElement },
    libraryModalBody: body,
    openLibraryModal: (title: string, subtitle: string) => opens.push({ title, subtitle }),
    closeLibraryModal: () => { closes += 1; },
  });
  vm.runInContext(sourceSlice(readFileSync(path.join(import.meta.dirname, "../ui/library-view.ts"), "utf8"), "ui/library-view.ts", "function renderLoudness(", "function renderPurge(") + loudnessDialogCode, context);
  context.openLoudnessModal = () => { context.openLibraryModal("响度归一化", ""); context.renderLoudness({ closeModal: context.closeLibraryModal }); };
  context.showLoudnessNormalizationDialog();

  assert.equal(opens[0].title, "响度归一化");
  assert.equal(body.children.length, 5);
  assert.equal(body.children[1].children[0].textContent, "需要先测量。");
  assert.equal(body.children[2].children[0].textContent, "只会调小，不会调大。");
  const acknowledgeButton = body.children[4].children[0];
  assert.equal(acknowledgeButton.textContent, "知道了");
  assert.equal(acknowledgeButton.focused, true);
  acknowledgeButton.listeners.click();
  assert.equal(closes, 1);
});
