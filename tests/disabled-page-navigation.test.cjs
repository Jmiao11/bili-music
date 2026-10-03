const { sourceSlice } = require("./helpers/source-slice.cjs");
const assert = require("node:assert/strict");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const core = readFileSync(path.join(__dirname, "../ui/playback-core.js"), "utf8").replace(/\r\n/g, "\n");
const trackUtils = readFileSync(path.join(__dirname, "../ui/track-utils.js"), "utf8");
const policy = readFileSync(require('node:path').join(__dirname, '../ui/playback-policy.js'), 'utf8');
const pageSelection = readFileSync(path.join(__dirname, "../ui/page-selection.js"), "utf8");
const lookupSource = pageSelection + sourceSlice(policy, "ui/playback-policy.js", "function readShuffleCollectionPrefs(", "function shouldRecoverAudio(");
const navigationSource = sourceSlice(core, "ui/playback-core.js", "function advancePageWithinCurrentBv(", "function playNext(");
const trackSource = sourceSlice(core, "ui/playback-core.js", "async function loadCurrentTrack(", "async function resumePendingPlayback(");
const bvid = "BV1GF4X6MEb1";
const pages = [1, 2, 3, 4].map((cid) => ({ cid, page: cid, part: `P${cid}`, durationSeconds: 10 }));

test("page lookup includes its start index and scans in either direction", () => {
  const context = vm.createContext({});
  vm.runInContext(lookupSource, context);
  const find = vm.runInContext("findEnabledPageIndex", context);
  assert.equal(find(pages, 0, 1, (page) => page.cid === 1), 1);
  assert.equal(find(pages, 3, -1, (page) => page.cid === 3), 3);
  assert.equal(find(pages, 1, 1, (page) => page.cid === 2 || page.cid === 3), 3);
  assert.equal(find(pages, 0, 1, () => false), 0);
});

test("page lookup returns -1 at either edge and when every page is disabled", () => {
  const context = vm.createContext({});
  vm.runInContext(lookupSource, context);
  const find = vm.runInContext("findEnabledPageIndex", context);
  assert.equal(find(pages, pages.length, 1, () => false), -1);
  assert.equal(find(pages, -1, -1, () => false), -1);
  assert.equal(find(pages, 0, 1, () => true), -1);
});

test("random page lookup selects uniformly among enabled pages", () => {
  const context = vm.createContext({});
  vm.runInContext(lookupSource, context);
  const pick = vm.runInContext("pickRandomEnabledPageIndex", context);
  assert.equal(pick(pages, (page) => page.cid === 2, () => 0), 0);
  assert.equal(pick(pages, (page) => page.cid === 2, () => 0.9999), 3);
  assert.equal(pick(pages, (page) => page.cid !== 2, () => 0.9999), 1);
  assert.equal(pick(pages, () => true, () => 0), -1);
  assert.equal(pick([], () => false, () => 0), -1);
  assert.equal(pick([pages[0]], () => false, () => 0.9999), 0);
});

test("random page round excludes current and disabled pages, including pages disabled later", () => {
  const context = vm.createContext({});
  vm.runInContext(lookupSource, context);
  const build = vm.runInContext("buildRandomPageRound", context);
  const take = vm.runInContext("takeRandomPageFromRound", context);
  const remaining = Array.from(build(pages, 0, (page) => page.cid === 4));
  assert.deepEqual(remaining, [1, 2]);
  const first = take(remaining, () => false, () => 0);
  assert.equal(first.index, 1);
  assert.deepEqual(Array.from(first.remaining), [2]);
  const disabledLater = take(first.remaining, (index) => index === 2, () => 0.9999);
  assert.equal(disabledLater.index, -1);
  assert.deepEqual(Array.from(disabledLater.remaining), []);
  assert.equal(take([], () => false, () => 0).index, -1);
  assert.equal(take([1, 2, 3], () => false, () => 0.9999).index, 3);
});

test("shuffle collection preferences accept only exact stored values", () => {
  const context = vm.createContext({});
  vm.runInContext(lookupSource, context);
  const normalize = context.normalizeShuffleCollectionPrefs;
  assert.deepEqual({ ...normalize("random", "all") }, { order: "random", limit: 0 });
  for (const [stored, limit] of [["1", 1], ["3", 3], ["5", 5], ["10", 10]]) {
    assert.deepEqual({ ...normalize("sequential", stored) }, { order: "sequential", limit });
  }
  for (const value of [null, "", "RANDOM", "Sequential", "garbage"]) {
    assert.equal(normalize(value, "all").order, "random");
  }
  for (const value of [null, "", "ALL", "03", "2", 3]) {
    assert.equal(normalize("random", value).limit, 0);
  }
});

function navigationContext(disabledCids, loopMode = "sequence") {
  const loads = [];
  const handlers = {};
  const state = {
    queue: [{ bvid }], currentIndex: 0, currentPages: pages,
    currentPageIndex: 0, currentDisplayTrack: {}, loopMode, history: [],
    activeAudioVersion: 7, requestVersion: 7, activeAudioUrl: "audio-url", audioActivatedAt: 0,
  };
  const context = vm.createContext({
    randomPageRound: null,
    playerState: state,
    libraryState: { disabledPages: new Map([[bvid.toLowerCase(), new Set(disabledCids)]]) },
    hasMultipleCurrentPages: () => true,
    loadCurrentTrack: (options) => loads.push(options),
    updatePlayerPagesButton() {},
    clearPendingResume() {}, clearPlaybackNotice() {},
    playNext: () => { throw Error("unexpected queue navigation"); },
    playPrevious: () => { throw Error("unexpected queue navigation"); },
    previousButton: { addEventListener: (_, handler) => { handlers.previous = handler; } },
    nextButton: { addEventListener: (_, handler) => { handlers.next = handler; } },
    audio: { ended: true, currentSrc: "audio-url", addEventListener: (_, handler) => { handlers.ended = handler; } },
    currentVideoPage: () => state.currentPages[state.currentPageIndex],
    isLoudnessNormalizationEnabled: () => false,
  });
  vm.runInContext(lookupSource + navigationSource, context);
  return { context, state, loads, handlers };
}

test("manual next and previous skip consecutive disabled pages", () => {
  const { context, state, loads, handlers } = navigationContext([2, 3]);
  vm.runInContext(sourceSlice(source, "ui/main.js", "previousButton.addEventListener(\"click\"", "initPlaybackResume();"), context);
  handlers.next();
  assert.equal(state.currentPageIndex, 3);
  handlers.previous();
  assert.equal(state.currentPageIndex, 0);
  assert.equal(loads.length, 2);
});

test("natural end skips disabled pages, while single loop repeats the current page", () => {
  const { context, state, loads, handlers } = navigationContext([1, 2, 3]);
  vm.runInContext(sourceSlice(source, "ui/main.js", "audio.addEventListener(\"ended\"", "initPlaybackPersistenceAndCache();"), context);
  handlers.ended({ timeStamp: 1 });
  assert.equal(state.currentPageIndex, 3);
  assert.equal(loads.length, 1);

  state.loopMode = "single";
  handlers.ended({ timeStamp: 2 });
  assert.equal(state.currentPageIndex, 3);
  assert.equal(loads.length, 2);
});

test("failed-page advancement skips disabled pages even in single loop", () => {
  const { context, state } = navigationContext([2, 3], "single");
  assert.equal(context.advancePageWithinCurrentBv({ automatic: true, skipFailed: true }), true);
  assert.equal(state.currentPageIndex, 3);
});

test("random mode with multiple queue items plays every other page once before leaving", () => {
  const { context, state, loads } = navigationContext([]);
  state.shuffle = true;
  state.queue.push({ bvid: "BV1rW4y1Q7o7" });
  vm.runInContext("Math.random = () => 0", context);
  assert.equal(context.advancePageWithinCurrentBv(), true);
  assert.equal(state.currentPageIndex, 1);
  assert.equal(context.advancePageWithinCurrentBv({ automatic: true }), true);
  assert.equal(state.currentPageIndex, 2);
  assert.equal(context.advancePageWithinCurrentBv({ automatic: true, skipFailed: true }), true);
  assert.equal(state.currentPageIndex, 3);
  assert.equal(context.advancePageWithinCurrentBv(), false);
  assert.equal(loads.length, 3);
});

test("a randomly selected start page stays out of its first page round", () => {
  const { context, state } = navigationContext([]);
  state.shuffle = true;
  state.queue.push({ bvid: "BV1rW4y1Q7o7" });
  state.currentPageIndex = context.pickRandomEnabledPageIndex(pages, () => false, () => 0.6);
  assert.equal(state.currentPageIndex, 2);
  vm.runInContext("Math.random = () => 0", context);
  const visited = [];
  for (let step = 0; step < 3; step += 1) {
    assert.equal(context.advancePageWithinCurrentBv(), true);
    visited.push(state.currentPageIndex);
  }
  assert.deepEqual(visited, [0, 1, 3]);
  assert.equal(context.advancePageWithinCurrentBv(), false);
});

test("random mode still repeats the current page in automatic single loop", () => {
  const { context, state, loads } = navigationContext([], "single");
  state.shuffle = true;
  state.currentPageIndex = 2;
  assert.equal(context.advancePageWithinCurrentBv({ automatic: true }), true);
  assert.equal(state.currentPageIndex, 2);
  assert.equal(loads.length, 1);
  assert.equal(loads[0].keepPage, true);
  state.queue.push({ bvid: "BV1rW4y1Q7o7" });
  assert.equal(context.advancePageWithinCurrentBv({ automatic: true }), true);
  assert.equal(state.currentPageIndex, 2);
  assert.equal(loads.length, 2);
});

test("single-item random queue advances each enabled page once, then exits the round", () => {
  const { context, state, loads } = navigationContext([]);
  state.shuffle = true;
  vm.runInContext("Math.random = () => 0", context);
  assert.equal(context.advancePageWithinCurrentBv(), true);
  assert.equal(state.currentPageIndex, 1);
  state.currentDisplayTrack = {};
  context.libraryState.disabledPages.get(bvid.toLowerCase()).add(3);
  assert.equal(context.advancePageWithinCurrentBv({ automatic: true, skipFailed: true }), true);
  assert.equal(state.currentPageIndex, 3);
  assert.equal(context.advancePageWithinCurrentBv(), false);
  assert.equal(state.currentPageIndex, 3);
  assert.equal(loads.length, 2);
  assert.equal(state.currentDisplayTrack, null);
});

test("single-item random queue discards a round belonging to another BV", () => {
  const { context, state } = navigationContext([]);
  state.shuffle = true;
  context.randomPageRound = { bvid: "BV1rW4y1Q7o7", remaining: [] };
  vm.runInContext("Math.random = () => 0", context);
  assert.equal(context.advancePageWithinCurrentBv(), true);
  assert.equal(context.randomPageRound.bvid, bvid);
  assert.equal(state.currentPageIndex, 1);
});

test("random collection limit counts the opening page and stops after the chosen total", () => {
  for (const [limit, successfulMoves] of [["1", 0], ["3", 2], ["10", 3]]) {
    const { context, state } = navigationContext([]);
    state.shuffle = true;
    context.localStorage = { getItem: (key) => key.endsWith("limit") ? limit : "random" };
    vm.runInContext("Math.random = () => 0", context);
    for (let step = 0; step < successfulMoves; step += 1) {
      assert.equal(context.advancePageWithinCurrentBv({ automatic: true, skipFailed: true }), true);
    }
    assert.equal(context.advancePageWithinCurrentBv(), false);
    assert.equal(state.history.length, successfulMoves);
  }
});

test("sequential collection order skips disabled pages, records history, and obeys the limit", () => {
  const { context, state } = navigationContext([2]);
  state.shuffle = true;
  context.localStorage = { getItem: (key) => key.endsWith("order") ? "sequential" : "3" };
  assert.equal(context.advancePageWithinCurrentBv(), true);
  assert.equal(state.currentPageIndex, 2);
  assert.equal(context.advancePageWithinCurrentBv({ automatic: true, skipFailed: true }), true);
  assert.equal(state.currentPageIndex, 3);
  assert.equal(context.advancePageWithinCurrentBv(), false);
  assert.deepEqual(Array.from(state.history, ({ cid, pageLevel }) => ({ cid, pageLevel })),
    [{ cid: 1, pageLevel: true }, { cid: 3, pageLevel: true }]);
});

test("a new BV resets the collection visit count", () => {
  const { context, state } = navigationContext([]);
  state.shuffle = true;
  state.queue.push({ bvid: "BV1rW4y1Q7o7" });
  context.localStorage = { getItem: (key) => key.endsWith("limit") ? "3" : "random" };
  context.resetCurrentPageState = () => { state.currentPageIndex = 0; };
  context.markRandomIndexPlayed = () => {};
  context.updateQueueUi = () => {};
  context.emitCurrentTrackChanged = () => {};
  vm.runInContext("Math.random = () => 0", context);
  vm.runInContext(sourceSlice(core, "ui/playback-core.js", "function playQueueIndex(", "function takeRandomNext()"), context);
  assert.equal(context.advancePageWithinCurrentBv(), true);
  assert.equal(context.randomPageRound.playedCount, 2);
  context.playQueueIndex(1);
  assert.equal(context.randomPageRound, null);
  assert.equal(context.advancePageWithinCurrentBv(), true);
  assert.equal(context.randomPageRound.playedCount, 2);
});

test("previous within a BV leaves the collection visit count unchanged", () => {
  const { context, state } = navigationContext([]);
  state.shuffle = true;
  context.localStorage = { getItem: (key) => key.endsWith("limit") ? "3" : "random" };
  vm.runInContext("Math.random = () => 0", context);
  assert.equal(context.advancePageWithinCurrentBv(), true);
  state.history.push({ index: 0, cid: 1, pageLevel: true });
  vm.runInContext(sourceSlice(core, "ui/playback-core.js", "function playPrevious()", "function initPlaybackSearch("), context);
  context.playPrevious();
  assert.equal(state.currentPageIndex, 0);
  assert.equal(context.randomPageRound.playedCount, 2);
  context.localStorage.getItem = (key) => key.endsWith("limit") ? "1" : "random";
  assert.equal(context.advancePageWithinCurrentBv(), false);
});

test("storage read errors use the default random unlimited preference", () => {
  const { context, state } = navigationContext([]);
  state.shuffle = true;
  context.localStorage = { getItem() { throw Error("storage denied"); } };
  vm.runInContext("Math.random = () => 0", context);
  for (let step = 0; step < 3; step += 1) {
    assert.equal(context.advancePageWithinCurrentBv(), true);
  }
  assert.equal(context.advancePageWithinCurrentBv(), false);
  assert.equal(state.currentPageIndex, 3);
});

test("only a random next index requests a random start page", () => {
  const calls = [];
  const state = { currentIndex: 0, shuffle: true, loopMode: "sequence", queue: [{}, {}] };
  const context = vm.createContext({
    playerState: state,
    takeRandomNext: () => 1,
    takeSequentialNext: () => 1,
    playQueueIndex: (index, options) => calls.push({ index, options }),
  });
  vm.runInContext(lookupSource + sourceSlice(core, "ui/playback-core.js", "function playNext(", "function playPrevious("), context);
  assert.equal(context.playNext({ skipFailed: true }), true);
  assert.equal(calls[0].index, 1);
  assert.equal(calls[0].options.randomStartPage, true);
  assert.equal(calls[0].options.preserveFailureStreak, true);

  state.shuffle = false;
  context.playNext();
  assert.equal(calls[1].options.randomStartPage, undefined);

  state.shuffle = true;
  state.loopMode = "single";
  context.playNext({ automatic: true });
  assert.equal(calls[2].options.randomStartPage, undefined);
});

test("random queue navigation starts at the first enabled page for sequential collections", () => {
  const calls = [];
  const context = vm.createContext({
    playerState: { currentIndex: 0, shuffle: true, loopMode: "sequence", queue: [{}, {}] },
    localStorage: { getItem: (key) => key.endsWith("order") ? "sequential" : "all" },
    takeRandomNext: () => 1,
    playQueueIndex: (index, options) => calls.push({ index, options }),
  });
  vm.runInContext(lookupSource + sourceSlice(core, "ui/playback-core.js", "function playNext(", "function playPrevious("), context);
  assert.equal(context.playNext(), true);
  assert.equal(calls[0].index, 1);
  assert.equal(calls[0].options.randomStartPage, undefined);
  context.localStorage.getItem = () => { throw Error("storage denied"); };
  assert.equal(context.playNext(), true);
  assert.equal(calls[1].options.randomStartPage, true);
});

test("entering a queue item and toggling shuffle clear the page round", () => {
  const state = { queue: [{ bvid }, { bvid: "BV1rW4y1Q7o7" }], currentIndex: 0,
    history: [], consecutiveResolveFailures: 0, shuffle: false, randomRemaining: [1] };
  const context = vm.createContext({
    randomPageRound: { bvid, remaining: [1] }, playerState: state,
    clearPendingResume() {}, clearPlaybackNotice() {}, resetCurrentPageState() {},
    updatePlayerPagesButton() {}, markRandomIndexPlayed() {}, updateQueueUi() {},
    emitCurrentTrackChanged() {}, currentVideoPage: () => null,
    loadCurrentTrack() {},
  });
  vm.runInContext(sourceSlice(core, "ui/playback-core.js", "function playQueueIndex(", "function takeRandomNext()"), context);
  context.playQueueIndex(1);
  assert.equal(context.randomPageRound, null);

  let change;
  context.randomPageRound = { bvid, remaining: [1] };
  context.shuffleToggle = { checked: true, addEventListener: (_, handler) => { change = handler; } };
  context.resetRandomRemaining = () => {};
  vm.runInContext(sourceSlice(core, "ui/playback-core.js", "shuffleToggle.addEventListener(\"change\"", "\n}\n", { endAfterStart: true }) + "\n\n", context);
  change();
  assert.equal(context.randomPageRound, null);
  context.randomPageRound = { bvid, remaining: [1] };
  context.shuffleToggle.checked = false;
  change();
  assert.equal(context.randomPageRound, null);
});

function trackContext(disabledCids, videoPages = pages) {
  const prepares = [];
  const notices = [];
  const nextCalls = [];
  const state = {
    currentIndex: 0, queue: [{ bvid }], requestVersion: 0,
    currentPages: [], currentPageIndex: 0, consecutiveResolveFailures: 0,
  };
  const context = vm.createContext({
    playerState: state,
    libraryState: { disabledPages: new Map([[bvid.toLowerCase(), new Set(disabledCids)]]), unavailableBvids: new Map() },
    MAX_CONSECUTIVE_RESOLVE_FAILURES: 5,
    stopAudioElement() {}, searchButton: { disabled: false }, result: { hidden: true },
    status: { textContent: "" }, console: { error() {} }, recoveryPromise: null,
    loadPagesForCurrentVideo: async () => {
      state.currentPages = videoPages;
      state.currentPageIndex = 0;
      return true;
    },
    hasMultipleCurrentPages: () => state.currentPages.length > 1,
    updatePlayerPagesButton() {},
    currentVideoPage: () => state.currentPages[state.currentPageIndex],
    currentAudioCacheCid: () => state.currentPages[state.currentPageIndex]?.cid,
    invoke: (command, args) => {
      if (command !== "prepare_audio") throw Error(`unexpected command: ${command}`);
      prepares.push(args);
      return new Promise(() => {});
    },
    advancePageWithinCurrentBv: () => false,
    playNext: (options) => { nextCalls.push(options); return true; },
    showPlaybackNotice: (message) => notices.push(message),
  });
  vm.runInContext(sourceSlice(trackUtils, "ui/track-utils.js", "function playbackFailureMessage(", "function unavailableTrackLocations(") + lookupSource + trackSource, context);
  return { context, state, prepares, notices, nextCalls };
}

test("default start skips disabled opening pages; explicit startPage still plays one", async () => {
  const { context, state, prepares } = trackContext([1, 2]);
  void context.loadCurrentTrack();
  await new Promise(setImmediate);
  assert.equal(state.currentPageIndex, 2);
  assert.equal(prepares[0].cid, 3);

  void context.loadCurrentTrack({ startPage: pages[0] });
  await new Promise(setImmediate);
  assert.equal(state.currentPageIndex, 0);
  assert.equal(prepares[1].cid, 1);
});

test("missing startPage cid falls back to the first enabled page", async () => {
  const { context, state, prepares } = trackContext([1]);
  void context.loadCurrentTrack({ startPage: { cid: 999 } });
  await new Promise(setImmediate);
  assert.equal(state.currentPageIndex, 1);
  assert.equal(prepares[0].cid, 2);
});

test("missing startPage cid with all pages disabled reports the existing error", async () => {
  const { context, prepares } = trackContext([1, 2, 3, 4]);
  let reportedError;
  context.console.error = (_, error) => { reportedError = error; };
  await context.loadCurrentTrack({ startPage: { cid: 999 } });
  assert.equal(prepares.length, 0);
  assert.match(String(reportedError), /all pages disabled by user/);
});

test("matched startPage still plays a disabled page", async () => {
  const { context, state, prepares } = trackContext([1]);
  void context.loadCurrentTrack({ startPage: { cid: 1 } });
  await new Promise(setImmediate);
  assert.equal(state.currentPageIndex, 0);
  assert.equal(prepares[0].cid, 1);
});

test("random start picks an enabled page while default start keeps the first enabled page", async () => {
  const { context, state, prepares } = trackContext([1, 3]);
  vm.runInContext("Math.random = () => 0.9999", context);
  void context.loadCurrentTrack({ randomStartPage: true });
  await new Promise(setImmediate);
  assert.equal(state.currentPageIndex, 3);
  assert.equal(prepares[0].cid, 4);

  void context.loadCurrentTrack();
  await new Promise(setImmediate);
  assert.equal(state.currentPageIndex, 1);
  assert.equal(prepares[1].cid, 2);
});

test("resume position and missing page metadata bypass default disabled-page selection", async () => {
  const resume = trackContext([1, 2]);
  void resume.context.loadCurrentTrack({ resumePosition: 30 });
  await new Promise(setImmediate);
  assert.equal(resume.prepares[0].cid, 1);

  const missing = trackContext([1, 2, 3, 4], []);
  void missing.context.loadCurrentTrack();
  await new Promise(setImmediate);
  assert.equal(missing.prepares[0].cid, null);
});

test("all-disabled videos use the existing failure counter and stop at five", async () => {
  const { context, state, prepares, notices, nextCalls } = trackContext([1, 2, 3, 4]);
  for (let attempt = 0; attempt < 5; attempt += 1) await context.loadCurrentTrack();
  assert.equal(prepares.length, 0);
  assert.equal(state.consecutiveResolveFailures, 5);
  assert.equal(nextCalls.length, 4);
  assert.equal(nextCalls[0].skipFailed, true);
  assert.equal(notices[0], "该视频的分P都已设为不想听，已自动跳过。");
  assert.equal(notices.at(-1), "队列中多首无法播放，已停止。");
});
