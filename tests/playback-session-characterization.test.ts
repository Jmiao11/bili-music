import { legacyPlaybackNodeNames } from "./helpers/playback-root-fixture.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { wirePlaybackMessagesContext } from "./helpers/playback-messages-fixture.ts";
import { createApplicationStore } from "../ui/app-state.ts";
import { moduleDeclarations, stripModuleSyntax } from "./helpers/module-syntax.ts";

const track = (n: number) => ({ bvid: "BV" + String(n).padStart(10, "0"), title: "曲目" + n, uploader: "作者", thumbnailUrl: "cover-image", durationSeconds: 80 });
// src-tauri/src/guest_playurl.rs:47-53 VideoPage, serde camelCase, seconds.
const pages = (count = 1) => Array.from({ length: count }, (_, i) => ({ page: i + 1, cid: 11 * (i + 1), part: "P" + (i + 1), durationSeconds: 80 }));
// src-tauri/src/resolve.rs:76-84 AudioResponse: serde camelCase, seconds and proxy URL.
const info = (n: number) => ({ audioUrl: new URL("/audio/" + String(n).padStart(32, "0"), "http://127.0.0.1").href, title: "曲目" + n, uploader: "作者", thumbnailUrl: "cover-image", durationSeconds: 80 });
class RequestNode {
  textContent = ""; hidden = false; disabled = false; value = ""; title = ""; checked = false;
  style = { setProperty() {} }; classList = { toggle() {} }; dataset = {};
  listeners = new Map<string, ((event: { timeStamp: number }) => unknown)[]>();
  addEventListener(type: string, handler: (event: { timeStamp: number }) => unknown) { const list = this.listeners.get(type) ?? []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type: string, handler: (event: { timeStamp: number }) => unknown) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(h => h !== handler)); }
  setAttribute() {} querySelectorAll() { return []; }
  fire(type: string, timeStamp = 100) { return Promise.all([...this.listeners.get(type) ?? []].map(handler => handler({ timeStamp, preventDefault() {} } as { timeStamp: number }))); }
}

test("session page results update the current list and discard a superseded request", async () => {
  const h = await fixture({ deferPages: true }); const a = await h.start(), b = await h.start(1);
  h.pageRequests[0].resolve(pages(3)); await h.flush(); await a.running;
  assert.equal((h.session().currentPages as unknown[]).length, 0); assert.equal(h.pending.length, 0);
  h.pageRequests[1].resolve(pages(2)); await h.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(h.session().currentPages)), pages(2)); assert.equal(h.pending.length, 1);
  await h.finish(0, true); await b.running;
});

test("session same identity still broadcasts without resetting triggers and switching P resets them", async () => {
  const h = await fixture({ pageCount: 2 }); const loading = await h.start(); await h.finish(0, true); await loading.running;
  h.context.initPlaybackRecord(); h.audio.currentTime = 30; await h.audio.fire("timeupdate"); await h.flush();
  const before = h.details.filter(e => e.type === "bilibili-music-trackchange").length;
  h.context.emitCurrentTrackChanged(); h.context.emitCurrentTrackChanged();
  assert.equal(h.details.filter(e => e.type === "bilibili-music-trackchange").length, before + 2);
  assert.equal(h.session().playRecordedForCurrentTrack, true);
  h.store.actions.playbackQueue.selectPage(1); h.context.emitCurrentTrackChanged();
  assert.equal(h.session().playRecordedForCurrentTrack, false);
  const payload = h.details.filter(e => e.type === "bilibili-music-trackchange").at(-1)!.detail;
  assert.deepEqual(Object.keys(payload).sort(), ["bvid", "durationSeconds", "hasCurrent", "thumbnailUrl", "title", "uploader"]);
  assert.equal(payload.hasCurrent, true); assert.equal(payload.bvid, track(1).bvid);
  assert.equal(Object.keys(payload).some(key => /audioUrl|cookie|buvid|b_nut/i.test(key)), false);
  assert.equal(Object.values(payload).some(value => typeof value === "string" && value === h.audio.currentSrc), false);
});

test("session record threshold and identity deduplication retain the exact track argument", async () => {
  const h = await fixture({ pageCount: 2 }); const loading = await h.start(); await h.finish(0, true); await loading.running;
  h.context.initPlaybackRecord(); h.audio.currentTime = 29; await h.audio.fire("timeupdate");
  assert.equal(h.commands.filter(c => c === "record_play").length, 0);
  h.audio.currentTime = 30; await h.audio.fire("timeupdate"); await h.audio.fire("timeupdate");
  assert.equal(h.commands.filter(c => c === "record_play").length, 1);
  // src-tauri/src/library/history.rs:144 record_play(TrackSnapshotInput), camelCase fields.
  const argument = h.calls.find(c => c.command === "record_play")!.args.track;
  assert.deepEqual(JSON.parse(JSON.stringify(argument)), { ...track(1), title: "P1", hasCurrent: true });
  h.context.emitCurrentTrackChanged(); await h.audio.fire("timeupdate");
  assert.equal(h.commands.filter(c => c === "record_play").length, 1);
  h.store.actions.playbackQueue.selectPage(1); h.context.emitCurrentTrackChanged(); await h.audio.fire("timeupdate");
  assert.equal(h.commands.filter(c => c === "record_play").length, 2);
});

for (const cacheResult of ["cached", "disabled", "already_cached"]) test(`session cache ${cacheResult} keeps frontend invocation and backend preflight result semantics`, async () => {
  const h = await fixture({ cacheResult }); const loading = await h.start(); await h.finish(0, true); await loading.running;
  h.context.initPlaybackPersistenceAndCache(); h.audio.currentTime = 29; await h.audio.fire("timeupdate"); await h.flush();
  assert.equal(h.commands.filter(c => c === "cache_track_audio").length, 0);
  h.audio.currentTime = 30; await h.audio.fire("timeupdate"); await h.flush(); await h.audio.fire("timeupdate");
  assert.equal(h.commands.filter(c => c === "cache_track_audio").length, 1);
  assert.equal(h.calls.find(c => c.command === "cache_track_audio")!.args.audioUrl === h.audio.currentSrc, true);
  assert.equal(h.events.includes("bilibili-music-audio-cache-updated"), cacheResult === "cached");
  assert.equal(h.session().cacheRequestedForCurrentTrack, true);
});

test("session loudness analysis waits for threshold and discards obsolete query and analysis results", async () => {
  const h = await fixture({ normalization: true }); const loading = await h.start(); await h.finish(0, true); await loading.running;
  h.context.refreshTrackLoudness(); const before = h.gains.length;
  h.loudness[0].resolve(-25); await h.flush(); assert.equal(h.gains.length, before);
  h.loudness[1].resolve(-8); await h.flush(); assert.equal(h.gains.at(-1)! < 1, true);
  h.audio.currentTime = 29; h.context.analyzeCurrentTrackAtThreshold(); assert.equal(h.commands.filter(c => c === "analyze_track_loudness").length, 0);
  h.audio.currentTime = 30; h.context.analyzeCurrentTrackAtThreshold(); h.context.analyzeCurrentTrackAtThreshold();
  assert.equal(h.commands.filter(c => c === "analyze_track_loudness").length, 1);
  assert.equal(h.calls.find(c => c.command === "analyze_track_loudness")!.args.audioUrl === h.audio.currentSrc, true);
  h.store.actions.playbackRequest.beginRequest(); const count = h.gains.length; h.loudness[2].resolve(-30); await h.flush();
  assert.equal(h.gains.length, count); assert.equal(h.session().loudnessAnalyzedForCurrentTrack, true);
});

test("session startup restore retains queue selection pending P and position until the resume load", async () => {
  const saved = { version: 1, queue: [track(1), track(2)].map(t => ({ ...t, addedAt: "" })), currentIndex: 1, positionSeconds: 35, page: 2, cid: 22, savedAt: 1700000000 };
  const h = await fixture({ count: 0, pageCount: 2, saved }); await h.context.restorePlaybackState();
  assert.equal(h.store.getState().playbackQueue.currentIndex, 1); assert.equal(h.store.getState().playbackQueue.queue.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(h.session().pendingResume)), { positionSeconds: 35, page: 2, cid: 22 });
  assert.equal(h.nodes.resumeProgressSlider.value, "35"); assert.equal(h.nodes.status.textContent, "已恢复上次播放，点击播放继续。");
  assert.equal(h.pending.length, 0); h.context.savePlaybackState();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c => c.command === "save_playback_state")!.args.state)), saved);
  const resuming = h.context.resumePendingPlayback(); await h.flush(); assert.equal(h.pending.length, 1);
  assert.equal(h.calls.find(c => c.command === "prepare_audio")!.args.cid, 22);
  await h.finish(0, true); await resuming;
  assert.equal(h.store.getState().playbackQueue.currentPageIndex, 1); assert.equal(h.audio.currentTime, 35); assert.equal(h.session().resumeInProgress, false);
});

for (const source of ["missing", "damaged"]) test(`session ${source} playback file follows Rust null fallback without media or persistence`, async () => {
  const h = await fixture({ count: 0, saved: null }); await h.context.restorePlaybackState();
  assert.equal(h.store.getState().playbackQueue.queue.length, 0); assert.equal(h.store.getState().playbackQueue.currentIndex, -1);
  assert.equal(h.session().pendingResume, null); assert.equal(h.pending.length, 0); assert.equal(h.commands.includes("save_playback_state"), false);
});

for (const success of [true, false]) test(`session pasted BV pending pages ${success ? "opens after activation" : "clears after failure"}`, async () => {
  const h = await fixture({ pageCount: 2 }); h.context.initPlaybackSearch(); h.context.initPastedBvPages();
  h.nodes.searchKeyword.value = "BV1GF4X6MEb1"; await h.nodes.searchForm.fire("submit"); await h.flush();
  assert.equal((h.session().pendingPastedBvPages as { bvid: string }).bvid, "BV1GF4X6MEb1");
  assert.equal((h.session().pendingPastedBvPages as { requestVersion: number }).requestVersion, h.request().requestVersion);
  await h.finish(0, success); assert.equal(h.session().pendingPastedBvPages, null);
  assert.equal(h.events.includes("open-pages"), success);
});
async function fixture({ count = 3, pageCount = 1, normalization = false, cacheResult = "disabled", saved = null as unknown, deferPages = false } = {}) {
  const ui = path.join(import.meta.dirname, "../ui"), source = fs.readFileSync(path.join(ui, "playback-core.ts"), "utf8");
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(ui, "player-dom.ts"), "utf8"))![1].split(",").map(n => n.trim()).filter(Boolean).concat(legacyPlaybackNodeNames);
  const nodes = Object.fromEntries(names.map(n => [n, new RequestNode()]));
  const details: { type: string; detail: Record<string, unknown> }[] = [], calls: { command: string; args: Record<string, unknown> }[] = [], gains: number[] = [];
  const pageRequests: { resolve(value: unknown): void }[] = [], loudness: { resolve(value: number | null): void }[] = [];
  const pending: { resolve(value: unknown): void; reject(reason: unknown): void }[] = [], commands: string[] = [], events: string[] = [], notices: string[] = [], writes: boolean[] = [];
  const audio = Object.assign(new RequestNode(), { paused: true, ended: false, currentTime: 0, duration: 80, currentSrc: "", readyState: 1, error: { code: 2 },
    pause() { this.paused = true; }, load() {}, removeAttribute() { this.currentSrc = ""; }, async play() { this.paused = false; } });
  Object.defineProperty(audio, "src", { get: () => audio.currentSrc, set: (value: string) => { audio.currentSrc = value; writes.push(true); } });
  // PlaybackState: src-tauri/src/library/playback_state.rs:16-26,73-88; damaged/missing files return null.
  // Cache results: src-tauri/src/audio_cache.rs:475-477; loudness: library/loudness_store.rs:68, Option<f64>.
  const invoke = (command: string, args: Record<string, unknown> = {}) => {
    commands.push(command); calls.push({ command, args });
    if (command === "prepare_audio") return new Promise<unknown>((resolve, reject) => pending.push({ resolve, reject }));
    if (command === "get_video_pages" && deferPages) return new Promise<unknown>(resolve => pageRequests.push({ resolve }));
    if (command === "get_track_loudness" || command === "analyze_track_loudness") return new Promise<number | null>(resolve => loudness.push({ resolve }));
    return Promise.resolve(command === "get_video_pages" ? pages(pageCount) : command === "get_playback_state" ? saved : command === "cache_track_audio" ? cacheResult : null);
  };
  const store = createApplicationStore({ invoke: invoke as Parameters<typeof createApplicationStore>[0]["invoke"], setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const windowNode = Object.assign(new RequestNode(), { recordPlaybackDiag() {}, dispatchEvent: (event: { type: string; detail: Record<string, unknown> }) => { events.push(event.type); details.push(event); for (const handler of windowNode.listeners.get(event.type) ?? []) Reflect.apply(handler, windowNode, [event]); } });
  const context = vm.createContext({ ...nodes, audio, invoke, getApplicationStore: () => store, Date: { now: () => 1700000000123 }, performance: { now: () => 100 }, HTMLMediaElement: { HAVE_METADATA: 1 },
    Event, window: windowNode, CustomEvent: class { type: string; detail: Record<string, unknown>; constructor(type: string, options: { detail: Record<string, unknown> }) { this.type = type; this.detail = options.detail; } },
    console: { error() {}, warn() {}, debug() {} }, document: { querySelectorAll: () => [] }, localStorage: { getItem: () => null },
    getSearchSnapshot: () => ({ requestVersion: 0, results: [] }), getLibrarySnapshot: () => store.getState().library, clearLibraryUnavailable: () => false,
    markLibraryUnavailable() {}, renderLibraryViews() {}, renderSearchResults() {}, updateLibraryHighlights() {},
    clearPlaybackNotice() {}, showPlaybackNotice: (text: string) => { notices.push(text); void windowNode.fire("bilibili-music-notice-change"); }, setSearchPlaybackBusy() {},
    resetSearchForBv: () => 0, recognizeSearchBv() {}, runSearch() {}, openCurrentPagesModal: () => events.push("open-pages"),
    isLoudnessNormalizationEnabled: () => normalization, setNormalizationGain: (gain: number) => gains.push(gain) });
  for (const declaration of moduleDeclarations(source, "ui/playback-core.ts")) if (declaration.kind === "import" && /(?:state|policy|selection|utils|view)\.ts$/.test(declaration.specifier)) Object.assign(context, await import(pathToFileURL(path.join(ui, declaration.specifier)).href));
  for (const file of ["player-state.ts", "settings-adapter.ts", "playback-policy.ts"]) vm.runInContext(stripModuleSyntax(fs.readFileSync(path.join(ui, file), "utf8"), "ui/" + file), context);
  wirePlaybackMessagesContext(context);
  vm.runInContext(stripModuleSyntax(source, "ui/playback-core.ts"), context);
  const main = stripModuleSyntax(fs.readFileSync(path.join(ui, "main.ts"), "utf8"), "ui/main.ts");
  vm.runInContext(main.slice(main.indexOf('audio.addEventListener("ended", (event) => {'), main.indexOf("initPlaybackPersistenceAndCache();")), context);
  context.initPlaybackAudioIdentity(); audio.addEventListener("error", context.handleAudioRecoveryError);
  store.actions.playbackQueue.replaceQueue(Array.from({ length: count }, (_, i) => track(i + 1)));
  if (count) store.actions.playbackQueue.selectIndex(0, false, null);
  store.actions.playbackQueue.changeShuffle(false, () => 0); vm.runInContext("Math.random = () => 0", context);
  const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
  const request = () => vm.runInContext('typeof getRequestSnapshot === "function" ? getRequestSnapshot() : playerState', context) as { requestVersion: number; activeAudioVersion: number; audioActivatedAt: number; consecutiveResolveFailures: number };
  const start = async (index = 0) => { store.actions.playbackQueue.selectIndex(index, false, null); const running = context.loadCurrentTrack(); await flush(); return { running }; };
  const finish = async (index: number, success: boolean) => { if (success) pending[index].resolve(info(index + 1)); else pending[index].reject("request failed"); await flush(); };
  const session = () => vm.runInContext('typeof getSessionSnapshot === "function" ? getSessionSnapshot() : ({ currentPages: playerState.currentPages, lastEmittedTrackIdentity: playerState.lastEmittedTrackIdentity, pendingPastedBvPages, pendingResume, resumeInProgress, playRecordedForCurrentTrack, cacheRequestedForCurrentTrack, loudnessAnalyzedForCurrentTrack })', context) as Record<string, unknown>;
  return { context, store, nodes, audio, pending, commands, events, notices, writes, flush, request, start, finish, session, details, calls, gains, loudness, pageRequests };
}

