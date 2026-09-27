const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const lookupSource = source.slice(
  source.indexOf("function isPageDisabled("),
  source.indexOf("function setFavoriteButtonState("),
);
const navigationSource = source.slice(
  source.indexOf("function advancePageWithinCurrentBv("),
  source.indexOf("function playNext("),
);
const trackSource = source.slice(
  source.indexOf("async function loadCurrentTrack("),
  source.indexOf("async function resumePendingPlayback("),
);
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

function navigationContext(disabledCids, loopMode = "sequence") {
  const loads = [];
  const handlers = {};
  const state = {
    queue: [{ bvid }], currentIndex: 0, currentPages: pages,
    currentPageIndex: 0, currentDisplayTrack: {}, loopMode,
    activeAudioVersion: 7, requestVersion: 7, activeAudioUrl: "audio-url", audioActivatedAt: 0,
  };
  const context = vm.createContext({
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
  vm.runInContext(source.slice(
    source.indexOf('previousButton.addEventListener("click"'),
    source.indexOf('resumePlayPauseButton?.addEventListener("click"'),
  ), context);
  handlers.next();
  assert.equal(state.currentPageIndex, 3);
  handlers.previous();
  assert.equal(state.currentPageIndex, 0);
  assert.equal(loads.length, 2);
});

test("natural end skips disabled pages, while single loop repeats the current page", () => {
  const { context, state, loads, handlers } = navigationContext([1, 2, 3]);
  vm.runInContext(source.slice(
    source.indexOf('audio.addEventListener("ended"'),
    source.indexOf('audio.addEventListener("timeupdate"'),
  ), context);
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
  vm.runInContext(source.slice(
    source.indexOf("function playbackFailureMessage("),
    source.indexOf("function unavailableTrackLocations("),
  ) + lookupSource + trackSource, context);
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
