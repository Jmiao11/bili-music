import assert from "node:assert/strict";
import { createControllerContext as createSessionContext } from "./helpers/controller-context.ts";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { createApplicationStore } from "../ui/store/app-state.ts";
import { moduleDeclarations, stripModuleSyntax } from "./helpers/module-syntax.ts";

type FixtureEvent = { type: string; detail?: unknown; prevented: boolean; immediate: boolean; preventDefault(): void; stopImmediatePropagation(): void };
class DisplayNode {
  value = "0"; max = "0"; textContent = ""; dataset: Record<string, string> = {}; attributes = new Map<string, string>(); progress = "";
  currentTime = 0; duration = NaN; paused = true; ended = false; playbackRate = 1; currentSrc = "fixture"; volume = 1; src = "fixture";
  operations: string[] = []; rejectPlay = false;
  listeners = new Map<string, { callback: (event: FixtureEvent) => unknown; capture: boolean }[]>();
  style = { setProperty: (_key: string, value: string) => { this.progress = value; } };
  classList = { contains: () => false };
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  addEventListener(type: string, callback: (event: FixtureEvent) => unknown, capture = false) { const list = this.listeners.get(type) ?? []; list.push({ callback, capture }); this.listeners.set(type, list); }
  removeEventListener() {}
  async fire(type: string, fields = {}) {
    const event: FixtureEvent = { type, prevented: false, immediate: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediate = true; }, ...fields };
    for (const capture of [true, false]) for (const handler of this.listeners.get(type) ?? []) { if (handler.capture !== capture) continue; await handler.callback(event); if (event.immediate) return event; }
    return event;
  }
  click() { this.operations.push("click"); void this.fire("click"); }
  async play() { this.operations.push("play"); if (this.rejectPlay) throw Error("unavailable"); this.paused = false; await this.fire("play"); }
  pause() { this.operations.push("pause"); this.paused = true; void this.fire("pause"); }
  load() {}
}

async function fixture() {
  const ui = path.join(import.meta.dirname, "../ui"), source = fs.readFileSync(path.join(ui, "features/settings/appearance.ts"), "utf8"), nodes = new Map<string, DisplayNode>();
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new DisplayNode()); return nodes.get(id)!; };
  const windowNode = new DisplayNode(), handlers = new Map<string, (details: Record<string, number>) => void>(), positions: unknown[] = [], navigation: string[] = [];
  const session = { metadata: null as unknown, playbackState: "none", setPositionState(value: unknown) { positions.push(JSON.parse(JSON.stringify(value))); }, setActionHandler(name: string, callback: (details: Record<string, number>) => void) { handlers.set(name, callback); } };
  const store = createApplicationStore({ invoke: async () => null, setTimeout: () => 0, clearTimeout() {}, report() {} });
  const context = createSessionContext({ document: { documentElement: node("root"), querySelector: node, querySelectorAll: () => [] },
    window: { __TAURI__: { core: { invoke: async () => null } }, addEventListener: windowNode.addEventListener.bind(windowNode), recordPlaybackDiag() {} },
    navigator: { mediaSession: session }, MediaMetadata: class { constructor(data: object) { Object.assign(this, data); } },
    getApplicationStore: () => store, choosePlaylistAndAdd() {}, showLoudnessNormalizationDialog() {}, syncImmersiveTrack() {}, console,
    pendingResume: false, resumeInProgress: false, resumes: 0, resumePendingPlayback() { context.resumes++; },
    playPrevious() { navigation.push("previous"); }, playNext() { navigation.push("next"); }, retreatPageWithinCurrentBv: () => false, advancePageWithinCurrentBv: () => false });
  // Explicitly load actual state/view/media dependencies from the appearance import graph, including future display modules.
  for (const declaration of moduleDeclarations(source, "ui/features/settings/appearance.ts")) if (declaration.kind === "import" && /(?:playback-.*-(?:state|view)|media-adapter)\.ts$/.test(declaration.specifier)) {
    Object.assign(context, await import(pathToFileURL(path.join(ui, "features/settings", declaration.specifier)).href));
  }
  const erased = stripModuleSyntax(source, "ui/features/settings/appearance.ts");
  vm.runInContext(erased.slice(0, erased.indexOf("function startAppearance()")), context);
  // Immersive cover/queue rendering is outside this fixture; time, buttons and Media Session remain real.
  context.syncImmersiveTrack = () => {};
  const core = stripModuleSyntax(fs.readFileSync(path.join(ui, "features/playback/playback-core.ts"), "utf8"), "ui/features/playback/playback-core.ts");
  vm.runInContext(core.slice(core.indexOf("function initPlaybackResume()"), core.indexOf("function initPlaybackPersistenceAndCache()")), context);
  context.resumePlayPauseButton = node("#play-pause-button"); context.initPlaybackResume();
  context.previousButton = node("#previous-button"); context.nextButton = node("#next-button");
  const main = stripModuleSyntax(fs.readFileSync(path.join(ui, "app/main.ts"), "utf8"), "ui/app/main.ts");
  vm.runInContext(main.slice(main.indexOf('installPlaybackCallbacks({'), main.indexOf("initPlaybackResume();")), context);
  vm.runInContext(erased.slice(erased.indexOf('window.addEventListener("bilibili-music-trackchange", (event) => {', erased.indexOf("function startAppearance()")), erased.indexOf("initializeAccentColor();", erased.indexOf("function startAppearance()"))), context);
  vm.runInContext("updateProgress(0); updatePlayPauseButton(); registerMediaSessionActionHandlers();", context);
  const audio = node("#audio"), flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { node, audio, session, handlers, positions, navigation, context, store, flush, track: (detail: unknown) => windowNode.fire("bilibili-music-trackchange", { detail }) };
}

test("playback display media events synchronize both bars without touching lists", async () => {
  const h = await fixture(); h.audio.duration = 3661; h.audio.currentTime = 61.8;
  for (const event of ["timeupdate", "durationchange", "loadedmetadata"]) {
    await h.audio.fire(event);
    for (const prefix of ["", "immersive-"]) { assert.equal(h.node("#" + prefix + "current-time").textContent, "1:01"); assert.equal(h.node("#" + prefix + "duration").textContent, "1:01:01"); assert.equal(h.node("#" + prefix + "progress-slider").value, "61.8"); }
  }
  h.audio.paused = false; await h.audio.fire("play");
  for (const prefix of ["", "immersive-"]) { assert.equal(h.node("#" + prefix + "play-pause-button").dataset.playing, "true"); assert.equal(h.node("#" + prefix + "play-pause-button").attributes.get("aria-label"), "暂停"); }
  h.audio.paused = true; await h.audio.fire("pause"); assert.equal(h.node("#play-pause-button").dataset.playing, "false"); assert.equal(h.node("#immersive-play-pause-button").attributes.get("aria-label"), "播放");
  assert.equal(h.node("#results").listeners.size, 0); assert.equal(h.node("#results").textContent, "");
});

test("playback display dragging either progress slider preserves preview until change and seeks exactly", async () => {
  for (const prefix of ["", "immersive-"]) {
    const h = await fixture(); h.audio.duration = 100; h.audio.currentTime = 10; await h.audio.fire("durationchange");
    const slider = h.node("#" + prefix + "progress-slider"); await slider.fire("pointerdown"); slider.value = "43.5"; await slider.fire("input");
    h.audio.currentTime = 12; const positions = h.positions.length; await h.audio.fire("timeupdate");
    assert.equal(slider.value, "43.5"); assert.equal(h.node("#current-time").textContent, "0:43"); assert.equal(h.node("#immersive-current-time").textContent, "0:43"); assert.equal(h.positions.length, positions);
    await slider.fire("change"); assert.equal(h.audio.currentTime, 43.5); h.audio.currentTime = 44; await h.audio.fire("timeupdate"); assert.equal(slider.value, "44");
  }
});

test("playback display unknown duration and emptied reset preserve old formatting and dragging rules", async () => {
  const h = await fixture(); h.audio.currentTime = 75; await h.audio.fire("timeupdate"); assert.equal(h.node("#current-time").textContent, "0:00"); assert.equal(h.node("#duration").textContent, "0:00"); assert.equal(h.node("#progress-slider").max, "0"); assert.equal(h.positions.length, 0);
  h.node("#progress-slider").value = "50"; await h.node("#progress-slider").fire("change"); assert.equal(h.audio.currentTime, 75);
  h.audio.duration = 100; await h.node("#progress-slider").fire("pointerdown"); h.audio.currentTime = 20; await h.audio.fire("durationchange"); assert.equal(h.node("#progress-slider").value, "20");
  h.audio.paused = true; h.audio.duration = NaN; await h.audio.fire("emptied"); assert.equal(h.node("#progress-slider").value, "0"); assert.equal(h.node("#immersive-current-time").textContent, "0:00"); assert.equal(h.session.playbackState, "none");
  h.audio.duration = 100; h.audio.currentTime = 3; await h.audio.fire("timeupdate"); assert.equal(h.node("#progress-slider").value, "3");
});

test("playback Media Session metadata state position and unsupported probes preserve existing outputs", async () => {
  const h = await fixture(); await h.track({ hasCurrent: true, title: "曲目", uploader: "作者", thumbnailUrl: "", bvid: "BV1GF4X6MEb1", durationSeconds: 60 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.session.metadata)), { title: "曲目", artist: "作者", artwork: [] });
  h.audio.duration = 100; h.audio.currentTime = 120; h.audio.playbackRate = NaN; await h.audio.fire("timeupdate"); assert.deepEqual(h.positions.at(-1), { duration: 100, playbackRate: 1, position: 100 });
  h.audio.paused = false; await h.audio.fire("play"); assert.equal(h.session.playbackState, "playing"); h.audio.paused = true; await h.audio.fire("pause"); assert.equal(h.session.playbackState, "paused"); h.audio.ended = true; await h.audio.fire("ended"); assert.equal(h.session.playbackState, "none");
  await h.track({ hasCurrent: false }); assert.equal(h.session.metadata, null); h.context.navigator = {}; assert.doesNotThrow(() => h.context.syncMediaSessionPosition());
});

test("playback Media Session actions retain click forwarding guards and seek boundaries", async () => {
  const h = await fixture(); h.audio.duration = 100; h.handlers.get("play")!({}); await h.flush(); assert.deepEqual(h.audio.operations, ["play"]); h.handlers.get("play")!({}); await h.flush(); assert.deepEqual(h.audio.operations, ["play"]);
  h.handlers.get("pause")!({}); await h.flush(); h.handlers.get("pause")!({}); await h.flush(); assert.deepEqual(h.audio.operations, ["play", "pause"]);
  h.handlers.get("previoustrack")!({}); h.handlers.get("nexttrack")!({}); assert.equal(h.navigation.filter(action => action === "previous").length, 1); assert.equal(h.navigation.filter(action => action === "next").length, 1);
  h.handlers.get("seekto")!({ seekTime: 40 }); assert.equal(h.audio.currentTime, 40); h.handlers.get("seekbackward")!({ seekOffset: 50 }); assert.equal(h.audio.currentTime, 0); h.handlers.get("seekforward")!({ seekOffset: 200 }); assert.equal(h.audio.currentTime, 100);
  h.audio.currentTime = 20; h.handlers.get("seekforward")!({ seekOffset: 0 }); assert.equal(h.audio.currentTime, 30); h.handlers.get("seekbackward")!({}); assert.equal(h.audio.currentTime, 20);
  h.audio.duration = NaN; h.handlers.get("seekto")!({ seekTime: 5 }); assert.equal(h.audio.currentTime, 20);
});

test("playback click reuse preserves source errors and real capture-stage resume interception", async () => {
  const h = await fixture(); await h.node("#immersive-play-pause-button").fire("click"); await h.flush(); assert.deepEqual(h.audio.operations, ["play"]);
  h.context.getSessionActions().setPendingResume(true); const event = await h.node("#play-pause-button").fire("click"); assert.equal(event.prevented, true); assert.equal(event.immediate, true); assert.equal(h.context.resumes, 1); assert.deepEqual(h.audio.operations, ["play"]);
  h.context.getSessionActions().setPendingResume(false); h.context.getSessionActions().setResumeInProgress(true); h.handlers.get("pause")!({}); await h.flush(); assert.equal(h.context.resumes, 2); assert.deepEqual(h.audio.operations, ["play"]);
  h.context.getSessionActions().setResumeInProgress(false); h.audio.currentSrc = ""; await h.node("#play-pause-button").fire("click"); assert.equal(h.node("#status").textContent, "请先从队列中选择一首歌曲。");
  h.audio.currentSrc = "fixture"; h.audio.paused = true; h.audio.rejectPlay = true; await h.node("#play-pause-button").fire("click"); assert.equal(h.node("#status").textContent, "音频暂时无法播放，请稍后重试。");
});
