const { sourceSlice } = require("./helpers/source-slice.cjs");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const pageSelection = readFileSync(path.join(__dirname, "../ui/page-selection.js"), "utf8");
const slice = (start, end) => sourceSlice(source, "ui/main.js", start, end);

test("queue switches remember the departed cid and pass a history cid to track loading", () => {
  const loads = [];
  const state = {
    queue: [{ bvid: "BV1" }, { bvid: "BV2" }], currentIndex: 0,
    currentPages: [{ cid: 11 }, { cid: 12 }], currentPageIndex: 1,
    history: [], consecutiveResolveFailures: 0,
  };
  const context = vm.createContext({
    playerState: state, randomPageRound: null,
    currentVideoPage: () => state.currentPages.length > 1 ? state.currentPages[state.currentPageIndex] : null,
    clearPendingResume() {}, clearPlaybackNotice() {},
    resetCurrentPageState() { state.currentPages = []; state.currentPageIndex = 0; },
    updatePlayerPagesButton() {}, markRandomIndexPlayed() {}, updateQueueUi() {},
    emitCurrentTrackChanged() {}, loadCurrentTrack: (options) => loads.push(options),
  });
  vm.runInContext(slice("function playQueueIndex(", "function takeRandomNext()"), context);
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
    shuffle: true, history: [],
  };
  const context = vm.createContext({
    playerState: state, randomPageRound: null,
    libraryState: { disabledPages: new Map() },
    hasMultipleCurrentPages: () => true,
    currentVideoPage: () => pages[state.currentPageIndex],
    updatePlayerPagesButton() {}, loadCurrentTrack() {},
  });
  vm.runInContext(pageSelection + slice("function readShuffleCollectionPrefs(", "function setFavoriteButtonState(")
    + slice("function advancePageWithinCurrentBv(", "function retreatPageWithinCurrentBv("), context);
  vm.runInContext("Math.random = () => 0", context);
  assert.equal(context.advancePageWithinCurrentBv(), true);
  assert.equal(state.history[0].index, 0);
  assert.equal(state.history[0].cid, 11);
  assert.equal(state.history[0].pageLevel, true);
  state.shuffle = false;
  assert.equal(context.advancePageWithinCurrentBv(), true);
  assert.equal(state.history.length, 1);
});

test("previous accepts numeric history, restores a page in place, and forwards missing cids", () => {
  const calls = [];
  const round = { bvid: "BV1", remaining: [2] };
  const state = {
    currentIndex: 1, currentPages: [{ cid: 11 }, { cid: 12 }],
    currentPageIndex: 1, currentDisplayTrack: {}, history: [2], shuffle: true,
  };
  const context = vm.createContext({
    playerState: state, randomPageRound: round,
    playQueueIndex: (index, options) => calls.push({ index, options }),
    updatePlayerPagesButton() {}, loadCurrentTrack: (options) => calls.push({ load: options }),
  });
  vm.runInContext(slice("function playPrevious()", "searchForm.addEventListener("), context);
  context.playPrevious();
  assert.equal(calls[0].index, 2);
  assert.equal(calls[0].options.historyCid, null);

  state.history.push({ index: 1, cid: 11, pageLevel: true });
  context.playPrevious();
  assert.equal(state.currentPageIndex, 0);
  assert.equal(state.currentDisplayTrack, null);
  assert.equal(calls[1].load.keepPage, true);
  assert.equal(context.randomPageRound, round);

  state.history.push({ index: 1, cid: 999, pageLevel: true });
  context.playPrevious();
  assert.equal(calls[2].index, 1);
  assert.equal(calls[2].options.historyCid, 999);

  state.history.push({ index: 0, cid: 12 });
  context.playPrevious();
  assert.equal(calls[3].index, 0);
  assert.equal(calls[3].options.historyCid, 12);
});

test("random previous skips page retreat while sequential previous keeps it", () => {
  const handlers = {};
  const state = { shuffle: true };
  const calls = [];
  const context = vm.createContext({
    playerState: state,
    previousButton: { addEventListener: (_, handler) => { handlers.previous = handler; } },
    retreatPageWithinCurrentBv: () => { calls.push("retreat"); return true; },
    playPrevious: () => calls.push("history"),
    clearPendingResume() {}, clearPlaybackNotice() {},
  });
  vm.runInContext(slice('previousButton.addEventListener("click"', 'nextButton.addEventListener("click"'), context);
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
  const handlers = {};
  const queueCalls = [];
  const context = vm.createContext({
    playerState: state, randomPageRound: { bvid: "BV1", remaining: [] },
    libraryState: { disabledPages: new Map() },
    shuffleToggle: { checked: false, addEventListener: (_, handler) => { handlers.shuffle = handler; } },
    previousButton: { addEventListener: (_, handler) => { handlers.previous = handler; } },
    hasMultipleCurrentPages: () => true,
    updatePlayerPagesButton() {}, loadCurrentTrack() {},
    playQueueIndex: (index, options) => queueCalls.push({ index, options }),
    clearPendingResume() {}, clearPlaybackNotice() {}, updateQueueUi() {},
  });
  vm.runInContext(pageSelection + slice("function readShuffleCollectionPrefs(", "function setFavoriteButtonState(")
    + slice("function retreatPageWithinCurrentBv()", "function playNext(")
    + slice("function playPrevious()", "searchForm.addEventListener(")
    + slice('previousButton.addEventListener("click"', 'nextButton.addEventListener("click"')
    + slice('shuffleToggle.addEventListener("change"', 'favoriteCurrentButton?.addEventListener("click"'), context);
  handlers.shuffle();
  assert.equal(state.shuffle, false);
  assert.equal(state.history.length, 2);
  assert.equal(state.history[0], 0);
  assert.equal(state.history[1].cid, 99);

  handlers.previous();
  assert.equal(state.currentPageIndex, 0);
  assert.equal(queueCalls.length, 0);
  handlers.previous();
  assert.equal(queueCalls[0].index, 0);
  assert.equal(queueCalls[0].options.historyCid, 99);
});
