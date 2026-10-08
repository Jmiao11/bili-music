import nodePath from "node:path";
import { sourceSlice } from "./helpers/source-slice.ts";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(path.join(import.meta.dirname, "../ui/main.ts"), "utf8");
const core = readFileSync(path.join(import.meta.dirname, "../ui/playback-core.ts"), "utf8").replace(/\r\n/g, "\n");
const policy = readFileSync(nodePath.join(import.meta.dirname, '../ui/playback-policy.ts'), 'utf8');
const pageSelection = readFileSync(path.join(import.meta.dirname, "../ui/page-selection.ts"), "utf8");
const slice = (start: string, end: string, options?: Parameters<typeof sourceSlice>[4]) => sourceSlice(start.startsWith("function") || start.startsWith("shuffleToggle") ? core : source, start.startsWith("function") || start.startsWith("shuffleToggle") ? "ui/playback-core.ts" : "ui/main.ts", start, end, options) + (end === "\n}\n" ? "\n\n" : "");

test("queue switches remember the departed cid and pass a history cid to track loading", () => {
  const loads: { startPage: { cid: number }; randomStartPage?: boolean }[] = [];
  const state = {
    queue: [{ bvid: "BV1" }, { bvid: "BV2" }], currentIndex: 0,
    currentPages: [{ cid: 11 }, { cid: 12 }], currentPageIndex: 1,
    history: [] as { index: number; cid: number; pageLevel?: boolean }[], consecutiveResolveFailures: 0,
  };
  const context = vm.createContext({
    playerState: state, randomPageRound: null,
    currentVideoPage: () => state.currentPages.length > 1 ? state.currentPages[state.currentPageIndex] : null,
    clearPendingResume() {}, clearPlaybackNotice() {},
    resetCurrentPageState() { state.currentPages = []; state.currentPageIndex = 0; },
    updatePlayerPagesButton() {}, markRandomIndexPlayed() {}, updateQueueUi() {},
    emitCurrentTrackChanged() {}, loadCurrentTrack: (options: { startPage: { cid: number }; randomStartPage?: boolean }) => loads.push(options),
  });
  vm.runInContext("function getLibrarySnapshot() { return libraryState; }\n" + slice("function playQueueIndex(", "function takeRandomNext()"), context);
  context.playQueueIndex(1);
  assert.equal(state.history[0].index, 0);
  assert.equal(state.history[0].cid, 12);
  assert.equal(state.history[0].pageLevel, undefined);

  context.playQueueIndex(0, { recordCurrent: false, historyCid: 12 });
  assert.equal(loads[1].startPage.cid, 12);
  assert.equal(loads[1].randomStartPage, false);
  assert.equal(state.history.length, 1);
});

test("only random page advancement adds a page-level history entry", () => {
  const pages = [{ cid: 11 }, { cid: 12 }, { cid: 13 }];
  const state = {
    queue: [{ bvid: "BV1" }], currentIndex: 0, currentPages: pages,
    currentPageIndex: 0, currentDisplayTrack: {}, loopMode: "sequence",
    shuffle: true, history: [] as { index: number; cid: number; pageLevel?: boolean }[],
  };
  const context = vm.createContext({
    playerState: state, randomPageRound: null,
    libraryState: { disabledPages: new Map() },
    hasMultipleCurrentPages: () => true,
    currentVideoPage: () => pages[state.currentPageIndex],
    updatePlayerPagesButton() {}, loadCurrentTrack() {},
  });
  vm.runInContext("function getLibrarySnapshot() { return libraryState; }\n" + pageSelection + sourceSlice(policy, "ui/playback-policy.ts", "function readShuffleCollectionPrefs(", "function shouldRecoverAudio(")
    + slice("function advancePageWithinCurrentBv(", "function retreatPageWithinCurrentBv("), context);
  vm.runInContext("function getLibrarySnapshot() { return libraryState; }\n" + "Math.random = () => 0", context);
  assert.equal(context.advancePageWithinCurrentBv(), true);
  assert.equal(state.history[0].index, 0);
  assert.equal(state.history[0].cid, 11);
  assert.equal(state.history[0].pageLevel, true);
  state.shuffle = false;
  assert.equal(context.advancePageWithinCurrentBv(), true);
  assert.equal(state.history.length, 1);
});

test("previous accepts numeric history, restores a page in place, and forwards missing cids", () => {
  const calls: ({ index: number; options: { historyCid: number | null } } | { load: { keepPage: boolean } })[] = [];
  const round = { bvid: "BV1", remaining: [2] };
  const state = {
    currentIndex: 1, currentPages: [{ cid: 11 }, { cid: 12 }],
    currentPageIndex: 1, currentDisplayTrack: {}, history: [2] as (number | { index: number; cid: number; pageLevel?: boolean })[], shuffle: true,
  };
  const context = vm.createContext({
    playerState: state, randomPageRound: round,
    playQueueIndex: (index: number, options: { historyCid: number | null }) => calls.push({ index, options }),
    updatePlayerPagesButton() {}, loadCurrentTrack: (options: { keepPage: boolean }) => calls.push({ load: options }),
  });
  vm.runInContext("function getLibrarySnapshot() { return libraryState; }\n" + slice("function playPrevious()", "function initPlaybackSearch("), context);
  context.playPrevious();
  assert.equal((calls[0] as { index: number; options: { historyCid: number | null } }).index, 2);
  assert.equal((calls[0] as { index: number; options: { historyCid: number | null } }).options.historyCid, null);

  state.history.push({ index: 1, cid: 11, pageLevel: true });
  context.playPrevious();
  assert.equal(state.currentPageIndex, 0);
  assert.equal(state.currentDisplayTrack, null);
  assert.equal((calls[1] as { load: { keepPage: boolean } }).load.keepPage, true);
  assert.equal(context.randomPageRound, round);

  state.history.push({ index: 1, cid: 999, pageLevel: true });
  context.playPrevious();
  assert.equal((calls[2] as { index: number; options: { historyCid: number | null } }).index, 1);
  assert.equal((calls[2] as { index: number; options: { historyCid: number | null } }).options.historyCid, 999);

  state.history.push({ index: 0, cid: 12 });
  context.playPrevious();
  assert.equal((calls[3] as { index: number; options: { historyCid: number | null } }).index, 0);
  assert.equal((calls[3] as { index: number; options: { historyCid: number | null } }).options.historyCid, 12);
});

test("random previous skips page retreat while sequential previous keeps it", () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const state = { shuffle: true };
  const calls: string[] = [];
  const context = vm.createContext({
    playerState: state,
    previousButton: { addEventListener: (_: unknown, handler: (...args: unknown[]) => unknown) => { handlers.previous = handler; } },
    retreatPageWithinCurrentBv: () => { calls.push("retreat"); return true; },
    playPrevious: () => calls.push("history"),
    clearPendingResume() {}, clearPlaybackNotice() {},
  });
  vm.runInContext("function getLibrarySnapshot() { return libraryState; }\n" + slice('previousButton.addEventListener("click"', 'nextButton.addEventListener("click"'), context);
  handlers.previous();
  assert.deepEqual(calls, ["history"]);
  state.shuffle = false;
  handlers.previous();
  assert.deepEqual(calls, ["history", "retreat"]);
});

test("turning shuffle off removes page history and previous no longer jumps forward", () => {
  const pages = [{ cid: 11 }, { cid: 12 }, { cid: 13 }];
  const state = {
    queue: [{ bvid: "BV0" }, { bvid: "BV1" }], currentIndex: 1,
    currentPages: pages, currentPageIndex: 1, currentDisplayTrack: {},
    shuffle: true, loopMode: "sequence", randomRemaining: [],
    history: [0, { index: 0, cid: 99 },
      { index: 1, cid: 11, pageLevel: true }, { index: 1, cid: 13, pageLevel: true }],
  };
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const queueCalls: { index: number; options: { historyCid: number } }[] = [];
  const context = vm.createContext({
    playerState: state, randomPageRound: { bvid: "BV1", remaining: [] },
    libraryState: { disabledPages: new Map() },
    shuffleToggle: { checked: false, addEventListener: (_: unknown, handler: (...args: unknown[]) => unknown) => { handlers.shuffle = handler; } },
    previousButton: { addEventListener: (_: unknown, handler: (...args: unknown[]) => unknown) => { handlers.previous = handler; } },
    hasMultipleCurrentPages: () => true,
    updatePlayerPagesButton() {}, loadCurrentTrack() {},
    playQueueIndex: (index: number, options: { historyCid: number }) => queueCalls.push({ index, options }),
    clearPendingResume() {}, clearPlaybackNotice() {}, updateQueueUi() {},
  });
  vm.runInContext("function getLibrarySnapshot() { return libraryState; }\n" + pageSelection + sourceSlice(policy, "ui/playback-policy.ts", "function readShuffleCollectionPrefs(", "function shouldRecoverAudio(")
    + slice("function retreatPageWithinCurrentBv()", "function playNext(")
    + slice("function playPrevious()", "function initPlaybackSearch(")
    + slice('previousButton.addEventListener("click"', 'nextButton.addEventListener("click"')
    + slice('shuffleToggle.addEventListener("change"', "\n}\n", { endAfterStart: true }), context);
  handlers.shuffle();
  assert.equal(state.shuffle, false);
  assert.equal(state.history.length, 2);
  assert.equal(state.history[0], 0);
  assert.equal((state.history[1] as { index: number; cid: number; pageLevel?: boolean }).cid, 99);

  handlers.previous();
  assert.equal(state.currentPageIndex, 0);
  assert.equal(queueCalls.length, 0);
  handlers.previous();
  assert.equal(queueCalls[0].index, 0);
  assert.equal(queueCalls[0].options.historyCid, 99);
});
