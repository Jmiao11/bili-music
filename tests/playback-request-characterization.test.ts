import { legacyPlaybackNodeNames } from "./helpers/playback-root-fixture.ts";
import assert from "node:assert/strict";
import { createSessionContext } from "./helpers/playback-session-fixture.ts";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { createApplicationStore } from "../ui/app-state.ts";
import { moduleDeclarations, stripModuleSyntax } from "./helpers/module-syntax.ts";

const track = (n: number) => ({ bvid: "BV" + String(n).padStart(10, "0"), title: "曲目" + n, uploader: "作者", thumbnailUrl: "", durationSeconds: 80 });
// src-tauri/src/guest_playurl.rs:47-53 VideoPage, serde camelCase, seconds.
const pages = (count = 1) => Array.from({ length: count }, (_, i) => ({ page: i + 1, cid: 11 * (i + 1), part: "P" + (i + 1), durationSeconds: 80 }));
// src-tauri/src/resolve.rs:76-84 AudioResponse: serde camelCase, seconds and proxy URL.
const info = (n: number) => ({ audioUrl: new URL("/audio/" + String(n).padStart(32, "0"), "http://127.0.0.1").href, title: "曲目" + n, uploader: "作者", thumbnailUrl: "", durationSeconds: 80 });
class RequestNode {
  textContent = ""; hidden = false; disabled = false; value = ""; title = ""; checked = false;
  style = { setProperty() {} }; classList = { toggle() {} }; dataset = {};
  listeners = new Map<string, ((event: { timeStamp: number }) => unknown)[]>();
  addEventListener(type: string, handler: (event: { timeStamp: number }) => unknown) { const list = this.listeners.get(type) ?? []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type: string, handler: (event: { timeStamp: number }) => unknown) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(h => h !== handler)); }
  setAttribute() {} querySelectorAll() { return []; }
  fire(type: string, timeStamp = 100) { for (const handler of [...this.listeners.get(type) ?? []]) handler({ timeStamp }); }
}
async function fixture({ count = 3, pageCount = 1, mode = "sequence", shuffle = false } = {}) {
  const ui = path.join(import.meta.dirname, "../ui"), source = fs.readFileSync(path.join(ui, "playback-core.ts"), "utf8");
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(ui, "player-dom.ts"), "utf8"))![1].split(",").map(n => n.trim()).filter(Boolean).concat(legacyPlaybackNodeNames);
  const nodes = Object.fromEntries(names.map(n => [n, new RequestNode()]));
  const pending: { resolve(value: unknown): void; reject(reason: unknown): void }[] = [], commands: string[] = [], events: string[] = [], notices: string[] = [], writes: boolean[] = [];
  const audio = Object.assign(new RequestNode(), { paused: true, ended: false, currentTime: 0, duration: 80, currentSrc: "", readyState: 1, error: { code: 2 },
    pause() { this.paused = true; }, load() {}, removeAttribute() { this.currentSrc = ""; }, async play() { this.paused = false; } });
  Object.defineProperty(audio, "src", { get: () => audio.currentSrc, set: (value: string) => { audio.currentSrc = value; writes.push(true); } });
  const invoke = (command: string) => { commands.push(command); return command === "prepare_audio" ? new Promise<unknown>((resolve, reject) => pending.push({ resolve, reject })) : Promise.resolve(command === "get_video_pages" ? pages(pageCount) : null); };
  const store = createApplicationStore({ invoke: invoke as Parameters<typeof createApplicationStore>[0]["invoke"], setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const context = createSessionContext({ ...nodes, audio, invoke, getApplicationStore: () => store, performance: { now: () => 100 }, HTMLMediaElement: { HAVE_METADATA: 1 },
    window: { recordPlaybackDiag() {}, dispatchEvent: (event: { type: string }) => events.push(event.type) }, CustomEvent: class { type: string; constructor(type: string, _options: unknown) { this.type = type; } },
    console: { error() {}, warn() {}, debug() {} }, document: { querySelectorAll: () => [] }, localStorage: { getItem: () => null },
    getSearchSnapshot: () => ({ requestVersion: 0, results: [] }), getLibrarySnapshot: () => store.getState().library, clearLibraryUnavailable: () => false,
    markLibraryUnavailable() {}, renderLibraryViews() {}, renderSearchResults() {}, updateLibraryHighlights() {},
    clearPlaybackNotice() {}, showPlaybackNotice: (text: string) => notices.push(text), setSearchPlaybackBusy() {},
    isLoudnessNormalizationEnabled: () => false, setNormalizationGain() {} });
  for (const declaration of moduleDeclarations(source, "ui/playback-core.ts")) if (declaration.kind === "import" && /(?:state|policy|selection|utils|view)\.ts$/.test(declaration.specifier)) Object.assign(context, await import(pathToFileURL(path.join(ui, declaration.specifier)).href));
  for (const file of ["player-state.ts", "settings-adapter.ts", "playback-policy.ts"]) vm.runInContext(stripModuleSyntax(fs.readFileSync(path.join(ui, file), "utf8"), "ui/" + file), context);
  vm.runInContext(stripModuleSyntax(source, "ui/playback-core.ts"), context);
  const main = stripModuleSyntax(fs.readFileSync(path.join(ui, "main.ts"), "utf8"), "ui/main.ts");
  vm.runInContext(main.slice(main.indexOf('audio.addEventListener("ended", (event) => {'), main.indexOf("initPlaybackPersistenceAndCache();")), context);
  context.initPlaybackAudioIdentity(); audio.addEventListener("error", context.handleAudioRecoveryError);
  store.actions.playbackQueue.replaceQueue(Array.from({ length: count }, (_, i) => track(i + 1)));
  store.actions.playbackQueue.selectIndex(0, false, null);
  for (let i = 0; i < ["sequence", "list", "single"].indexOf(mode); i++) store.actions.playbackQueue.cycleLoop([{ id: "sequence" }, { id: "list" }, { id: "single" }]);
  store.actions.playbackQueue.changeShuffle(shuffle, () => 0); vm.runInContext("Math.random = () => 0", context);
  const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
  const request = () => vm.runInContext('typeof getRequestSnapshot === "function" ? getRequestSnapshot() : playerState', context) as { requestVersion: number; activeAudioVersion: number; audioActivatedAt: number; consecutiveResolveFailures: number };
  const start = async (index = 0) => { store.actions.playbackQueue.selectIndex(index, false, null); const running = context.loadCurrentTrack(); await flush(); return { running }; };
  const finish = async (index: number, success: boolean) => { if (success) pending[index].resolve(info(index + 1)); else pending[index].reject("request failed"); await flush(); };
  return { context, store, nodes, audio, pending, commands, events, notices, writes, flush, request, start, finish };
}

for (const success of [true, false]) test(`request late ${success ? "success" : "failure"} after A to B is discarded without effects`, async () => {
  const h = await fixture(); const a = await h.start(), b = await h.start(1);
  const eventCount = h.events.length; await h.finish(0, success); await a.running;
  assert.equal(h.writes.length, 0); assert.equal(h.events.length, eventCount); assert.equal(h.request().consecutiveResolveFailures, 0);
  await h.finish(1, true); await b.running; assert.equal(h.writes.length, 1); assert.equal(h.audio.currentSrc === info(2).audioUrl, true);
});
for (const success of [true, false]) test(`request cancelled ${success ? "success" : "failure"} has no media or counter effects`, async () => {
  const h = await fixture(); const a = await h.start(); const version = h.request().requestVersion;
  await h.context.cancelCurrentPlayback(); const eventCount = h.events.length; await h.finish(0, success); await a.running;
  assert.equal(h.request().requestVersion, version + 1); assert.equal(h.request().activeAudioVersion, -1); assert.equal(h.request().audioActivatedAt, Infinity);
  assert.equal(h.audio.currentSrc === "", true); assert.equal(h.writes.length, 0); assert.equal(h.events.length, eventCount); assert.equal(h.request().consecutiveResolveFailures, 0);
});
test("request activation timestamp filters ended and error while playing preserves its existing source guard", async () => {
  const h = await fixture(); const first = await h.start(); await h.finish(0, true); await first.running;
  assert.equal(h.request().audioActivatedAt, 100); h.audio.ended = true;
  const version = h.request().requestVersion; h.audio.fire("ended", 99); assert.equal(h.request().requestVersion, version);
  h.audio.fire("playing", 100); const before = h.pending.length; h.audio.fire("error", 99); await h.flush(); assert.equal(h.pending.length, before);
  h.audio.fire("error", 100); await h.flush(); assert.equal(h.pending.length, before + 1);
  await h.finish(1, true); assert.equal(h.request().audioActivatedAt, 100);
  const currentSource = h.audio.currentSrc; h.audio.currentSrc = "previous-source";
  vm.runInContext("playingAudioVersion = -1", h.context); h.audio.fire("playing", 101); assert.equal(vm.runInContext("playingAudioVersion", h.context), -1);
  h.audio.fire("error", 101); h.audio.fire("ended", 101); await h.flush(); assert.equal(h.pending.length, before + 1); assert.equal(h.request().requestVersion, version);
  h.audio.currentSrc = currentSource; h.audio.fire("playing", 100); assert.equal(vm.runInContext("playingAudioVersion", h.context), version);
  h.audio.fire("ended", 100); await h.flush(); assert.equal(h.request().requestVersion, version + 1);
});
for (const options of [{ mode: "sequence" }, { mode: "list" }, { shuffle: true }, { pageCount: 2 }]) test(`request failure skips according to existing navigation ${JSON.stringify(options)} and success clears count`, async () => {
  const h = await fixture(options); const first = await h.start(); await h.finish(0, false); await first.running;
  assert.equal(h.request().consecutiveResolveFailures, 1); assert.equal(h.pending.length, 2);
  if (options.pageCount) { assert.equal(h.store.getState().playbackQueue.currentIndex, 0); assert.equal(h.store.getState().playbackQueue.currentPageIndex, 1); }
  else assert.equal(h.store.getState().playbackQueue.currentIndex > 0, true);
  assert.equal(h.notices.at(-1)?.endsWith("，已自动跳过。"), true);
  await h.finish(1, true); assert.equal(h.request().consecutiveResolveFailures, 0); assert.equal(h.audio.paused, false);
});
test("request fifth consecutive failure brakes with exact notice and manual selection resets count", async () => {
  const h = await fixture({ count: 2, mode: "list" }); await h.start();
  for (let i = 0; i < 5; i++) { assert.equal(h.pending.length, i + 1); await h.finish(i, false); assert.equal(h.request().consecutiveResolveFailures, i + 1); }
  assert.equal(h.audio.paused, true); assert.equal(h.nodes.status.textContent, "队列中多首无法播放，已停止。"); assert.equal(h.notices.at(-1), "队列中多首无法播放，已停止。");
  await h.flush(); assert.equal(h.pending.length, 5); assert.equal(h.commands.filter(c => c === "prepare_audio").length, 5);
  h.context.playQueueIndex(0); await h.flush(); assert.equal(h.request().consecutiveResolveFailures, 0); assert.equal(h.pending.length, 6);
  await h.finish(5, true); assert.equal(h.request().consecutiveResolveFailures, 0);
});
test("request last sequential failure stops with existing end notice and invalid active identity", async () => {
  const h = await fixture({ count: 1 }); const first = await h.start(); await h.finish(0, false); await first.running;
  assert.equal(h.pending.length, 1); assert.equal(h.request().consecutiveResolveFailures, 1); assert.equal(h.audio.paused, true);
  assert.equal(h.nodes.status.textContent, "音频源暂时连不上，队列中没有可继续播放的内容。");
  assert.equal(h.request().activeAudioVersion, -1); assert.equal(h.request().audioActivatedAt, Infinity); assert.equal(h.audio.currentSrc === "", true);
});
