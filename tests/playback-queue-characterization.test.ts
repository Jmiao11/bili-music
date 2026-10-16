import { legacyPlaybackNodeNames } from "./helpers/playback-root-fixture.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { afterEach, test } from "node:test";
import { wirePlaybackMessagesContext } from "./helpers/playback-messages-fixture.ts";
import { createApplicationStore } from "../ui/store/app-state.ts";
import { moduleDeclarations, stripModuleSyntax } from "./helpers/module-syntax.ts";

const fixtureErrors: unknown[] = [];
afterEach(() => assert.deepEqual(fixtureErrors.splice(0), [], "Queue fixture reported an unexpected error"));

const track = (n: number) => ({ bvid: "BV" + String(n).padStart(10, "0"), title: "曲目" + n, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: "" });
const normalized = (n: number) => ({ ...track(n), playCount: null, pubdate: null });
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
class QueueNode {
  textContent = ""; title = ""; hidden = false; disabled = false; checked = false; value = "0"; max = "0";
  dataset: Record<string, string> = {}; attributes = new Map<string, string>(); classes = new Set<string>();
  listeners = new Map<string, () => unknown>();
  style = { setProperty() {} };
  classList = { toggle: (name: string, on: boolean) => { if (on) this.classes.add(name); else this.classes.delete(name); } };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  querySelectorAll() { return []; }
  addEventListener(name: string, callback: () => unknown) { this.listeners.set(name, callback); }
  fire(name: string) { return this.listeners.get(name)!(); }
}

async function fixture() {
  const ui = path.join(import.meta.dirname, "../ui"), source = fs.readFileSync(path.join(ui, "features/playback/playback-core.ts"), "utf8");
  const calls: { command: string; args: Record<string, unknown> }[] = [], loads: unknown[] = [], notices: string[] = [];
  let saved: unknown = null;
  const invoke = async (command: string, args: Record<string, unknown> = {}) => { calls.push({ command, args: plain(args) }); return command === "get_playback_state" ? saved : []; };
  const store = createApplicationStore({ invoke: invoke as Parameters<typeof createApplicationStore>[0]["invoke"], setTimeout: () => 0, clearTimeout() {}, report(level, message, error) { fixtureErrors.push({ level, message, error }); } }, { onSubscriberError: error => fixtureErrors.push(error) });
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(ui, "platform/player-dom.ts"), "utf8"))![1].split(",").map(x => x.trim()).filter(Boolean).concat(legacyPlaybackNodeNames);
  const nodes = Object.fromEntries(names.map(name => [name, new QueueNode()]));
  const audio = { paused: true, currentSrc: "", currentTime: 0, play: async () => { audio.paused = false; }, pause() {}, load() {} };
  const search = { results: [] as ReturnType<typeof track>[], requestVersion: 8 };
  const context = vm.createContext({ ...nodes, audio, invoke, getApplicationStore: () => store,
    getSearchSnapshot: () => search, getHomeSnapshot: () => ({ mode: "ranking" }), getLibrarySnapshot: () => store.getState().library,
    appendSearchDisplay(videos: ReturnType<typeof track>[], onAppend: (values: ReturnType<typeof track>[]) => void) { const unique = videos.filter(v => !search.results.some(old => old.bvid === v.bvid)); search.results.push(...unique); onAppend(unique); return unique; },
    document: { querySelectorAll: () => [] }, window: { dispatchEvent() {}, recordPlaybackDiag() {} }, CustomEvent: class { constructor(_type: string, _options: unknown) {} },
    Date: { now: () => 1700000000123 }, localStorage: { getItem: () => null }, console: { ...console, error: (...args: unknown[]) => fixtureErrors.push(args), warn: (...args: unknown[]) => fixtureErrors.push(args) },
    clearPlaybackNotice() {}, showPlaybackNotice: (text: string) => notices.push(text), renderLibraryViews() {}, updateLibraryHighlights() {},
    isLoudnessNormalizationEnabled: () => false, setNormalizationGain() {},
  });
  wirePlaybackMessagesContext(context);
  // Load actual pure dependencies; new queue modules are picked up through the real core imports.
  for (const declaration of moduleDeclarations(source, "ui/features/playback/playback-core.ts")) if (declaration.kind === "import" && /(?:state|policy|selection|utils|view)\.ts$/.test(declaration.specifier)) {
    Object.assign(context, await import(pathToFileURL(path.join(ui, "features/playback", declaration.specifier)).href));
  }
  // Each fixture owns the original mutable request state; imported singleton state must not leak between tests.
  vm.runInContext(stripModuleSyntax(fs.readFileSync(path.join(ui, "shared/player-state.ts"), "utf8"), "ui/shared/player-state.ts"), context);
  for (const file of ["features/settings/settings-adapter.ts", "features/playback/playback-policy.ts"]) vm.runInContext(stripModuleSyntax(fs.readFileSync(path.join(ui, file), "utf8"), "ui/" + file), context);
  vm.runInContext(stripModuleSyntax(source, "ui/features/playback/playback-core.ts"), context);
  context.loadCurrentTrack = (options: unknown = {}) => loads.push(plain(options));
  context.initPlaybackModes();
  const snapshot = () => vm.runInContext('typeof getQueueSnapshot === "function" ? getQueueSnapshot() : playerState', context);
  return { context, nodes, audio, store, search, calls, loads, notices, snapshot, restore: (value: unknown) => { saved = value; return context.restorePlaybackState(); } };
}

test("queue sources preserve normalized items identity and selected source when starting playback", async () => {
  for (const source of ["search", "ranking", "recommendation", "favorites", "playlist"]) {
    const h = await fixture(); const videos = [track(1), track(2)];
    h.context.playListItem(source, videos, 1, { searchVersion: 8, playlistId: "list-1" });
    const s = h.snapshot(); assert.deepEqual(plain(s.queue), [normalized(1), normalized(2)]); assert.equal(s.queueSource, source); assert.equal(s.currentIndex, 1);
    assert.equal(s.queueSearchVersion, source === "search" ? 8 : null); assert.equal(s.playlistId ?? s.queuePlaylistId ?? null, source === "playlist" ? "list-1" : null);
    assert.deepEqual(plain(s.history), []); assert.equal(h.loads.length, 1);
    h.context.playListItem(source, videos, 1, { searchVersion: 8, playlistId: "list-1" }); assert.equal(h.loads.length, 1); assert.equal(h.audio.paused, false);
  }
});

test("queue direct BV reuse and restored playback retain existing selection and persistence payload", async () => {
  const h = await fixture(); h.context.playBvId(track(1).bvid); assert.equal(h.snapshot().queueSource, "direct"); assert.equal(h.snapshot().currentIndex, 0);
  h.context.playBvId(track(1).bvid.toLowerCase()); assert.equal(h.snapshot().queue.length, 1); assert.equal(h.loads.length, 2);
  const restored = await fixture();
  // src-tauri/src/library/playback_state.rs:18-35 PlaybackState: camelCase fields, seconds, nullable page/cid.
  await restored.restore({ version: 1, queue: [track(1), track(2)], currentIndex: 1, positionSeconds: 12.5, page: 2, cid: 22, savedAt: 1699999999 });
  assert.equal(restored.snapshot().queueSource, "restored"); assert.equal(restored.snapshot().currentIndex, 1); assert.equal(restored.loads.length, 0);
  restored.context.savePlaybackState(); assert.deepEqual(restored.calls.at(-1), { command: "save_playback_state", args: { state: { version: 1, queue: [track(1), track(2)], currentIndex: 1, positionSeconds: 12.5, page: 2, cid: 22, savedAt: 1700000000 } } });
});

test("queue contents remain independent of later source collection edits", async () => {
  for (const source of ["favorites", "playlist"]) {
    const h = await fixture(), videos = [track(1), track(2)]; h.context.playListItem(source, videos, 0, { playlistId: "list-1" });
    videos[0].title = "改名"; videos.reverse(); videos.pop();
    h.store.actions.library.refreshViews();
    assert.deepEqual(plain(h.snapshot().queue), [normalized(1), normalized(2)]); assert.equal(h.snapshot().currentIndex, 0); assert.equal(h.loads.length, 1);
  }
});

test("queue loop shuffle controls preserve labels and fixed random draws through round exhaustion", async () => {
  const h = await fixture(); h.context.setQueue([track(1), track(2), track(3)]); h.context.playQueueIndex(0);
  let draws = 0; h.context.draw = () => { draws++; return 0; }; vm.runInContext("Math.random = draw", h.context);
  h.nodes.shuffleToggle.checked = true; h.nodes.shuffleToggle.fire("change"); assert.equal(draws, 1); assert.deepEqual(plain(h.snapshot().randomRemaining), [2, 1]);
  assert.equal(h.context.playNext(), true); assert.equal(h.snapshot().currentIndex, 1); assert.equal(h.context.playNext(), true); assert.equal(h.snapshot().currentIndex, 2);
  assert.equal(h.context.playNext(), false); assert.equal(h.notices.at(-1), "本轮随机播放已结束");
  for (const [mode, label] of [["list", "列表循环"], ["single", "单曲循环"], ["sequence", "关闭循环"]]) {
    h.nodes.loopModeButton.fire("click"); assert.equal(h.snapshot().loopMode, mode); assert.equal(h.nodes.loopModeButton.title, label); assert.equal(h.nodes.loopModeButton.attributes.get("aria-label"), label); assert.equal(h.nodes.loopModeButton.classes.has("is-active"), mode !== "sequence");
  }
  h.nodes.loopModeButton.fire("click"); assert.equal(h.context.playNext(), true); assert.equal(h.snapshot().currentIndex, 0); assert.equal(draws, 2);
  h.nodes.shuffleToggle.checked = false; h.nodes.shuffleToggle.fire("change"); assert.equal(h.snapshot().shuffle, false); assert.deepEqual(plain(h.snapshot().randomRemaining), []);
});

test("queue navigation history and matching search pagination keep random remainder and saved fields", async () => {
  const h = await fixture(); h.context.playListItem("search", [track(1), track(2)], 0, { searchVersion: 8 }); h.search.results = [track(1), track(2)];
  vm.runInContext("Math.random = () => 0", h.context); h.nodes.shuffleToggle.checked = true; h.nodes.shuffleToggle.fire("change");
  h.context.playQueueIndex(1); assert.deepEqual(plain(h.snapshot().history), [{ index: 0, cid: null }]); h.context.playPrevious(); assert.equal(h.snapshot().currentIndex, 0); assert.deepEqual(plain(h.snapshot().history), []);
  assert.equal(h.context.appendSearchResults([track(2), track(3), track(4)]), 2); assert.deepEqual(plain(h.snapshot().queue), [normalized(1), normalized(2), normalized(3), normalized(4)]); assert.deepEqual(plain(h.snapshot().randomRemaining), [3, 2]);
  h.audio.currentTime = 33.25; h.context.savePlaybackState(); assert.deepEqual(h.calls.at(-1), { command: "save_playback_state", args: { state: { version: 1, queue: [track(1), track(2), track(3), track(4)], currentIndex: 0, positionSeconds: 33.25, page: null, cid: null, savedAt: 1700000000 } } });
  h.search.requestVersion++; h.context.appendSearchResults([track(5)]); assert.equal(h.snapshot().queue.length, 4); assert.deepEqual(plain(h.snapshot().randomRemaining), [3, 2]);
});

test("queue random part rounds retain exact draws history and disabled preference filtering", async () => {
  const h = await fixture();
  // src-tauri/src/guest_playurl.rs:47 VideoPage serde camelCase output (cid, page, part, durationSeconds).
  const pages = [1, 2, 3, 4].map(page => ({ page, cid: page * 11, part: "P" + page, durationSeconds: 60 }));
  h.context.playListItem("favorites", [track(1)], 0, { startPage: pages[0], pages });
  await h.store.actions.library.changeDisabledPages(track(1).bvid, 22, true);
  h.nodes.shuffleToggle.checked = true; h.nodes.shuffleToggle.fire("change");
  const sequence = [0.9, 0], used: number[] = []; h.context.draw = () => { const n = sequence.shift()!; used.push(n); return n; }; vm.runInContext("Math.random = draw", h.context);
  assert.equal(h.context.advancePageWithinCurrentBv(), true); assert.equal(h.snapshot().currentPageIndex, 3);
  h.context.playPrevious(); assert.equal(h.snapshot().currentPageIndex, 0);
  assert.equal(h.context.advancePageWithinCurrentBv(), true); assert.equal(h.snapshot().currentPageIndex, 2);
  assert.equal(h.context.advancePageWithinCurrentBv(), false); assert.deepEqual(used, [0.9, 0]);
  h.context.savePlaybackState(); assert.deepEqual(h.calls.at(-1), { command: "save_playback_state", args: { state: { version: 1, queue: [track(1)], currentIndex: 0, positionSeconds: 0, page: 3, cid: 33, savedAt: 1700000000 } } });
});
