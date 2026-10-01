const { sourceSlice } = require("./helpers/source-slice.cjs");
const assert = require("node:assert/strict");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const helper = sourceSlice(readFileSync(path.join(__dirname, "../ui/track-utils.js"), "utf8"), "ui/track-utils.js", "function shouldOpenPastedBvPages(", "function displayThumbnailUrl(");
const context = vm.createContext({});
vm.runInContext(helper, context);
const shouldOpen = vm.runInContext("shouldOpenPastedBvPages", context);
const pending = { bvid: "BV1GF4X6MEb1", requestVersion: 7 };

test("failed page loading notices only the current request while keeping single-page fallback", async () => {
  const notices = [];
  const state = { requestVersion: 7, currentPages: [{ cid: 1 }] };
  const app = vm.createContext({
    playerState: state,
    invoke: async () => { throw new Error("view failed"); },
    resetCurrentPageState: () => { state.currentPages = []; },
    showPlaybackNotice: (message) => notices.push(message),
    console: { warn: () => {} },
  });
  vm.runInContext(sourceSlice(source, "ui/main.js", "async function loadPagesForCurrentVideo(", "function emitCurrentTrackChanged("), app);
  const load = vm.runInContext("loadPagesForCurrentVideo", app);
  assert.equal(await load({ bvid: pending.bvid }, 7), true);
  assert.equal(state.currentPages.length, 0);
  assert.deepEqual(notices, ["分P列表获取失败，暂按单个视频播放。"]);
  state.requestVersion = 8;
  assert.equal(await load({ bvid: pending.bvid }, 7), false);
  assert.equal(notices.length, 1);
});

test("matching BV with multiple pages opens", () => {
  assert.equal(shouldOpen(pending, "bv1gf4x6meb1", "BV1GF4X6MEb1", 7, 2), true);
});

test("single-page video does not open", () => {
  assert.equal(shouldOpen(pending, pending.bvid, pending.bvid, 7, 1), false);
});

test("different event or current BV does not open", () => {
  assert.equal(shouldOpen(pending, "BV1rW4y1Q7o7", pending.bvid, 7, 2), false);
  assert.equal(shouldOpen(pending, pending.bvid, "BV1rW4y1Q7o7", 7, 2), false);
});

test("a newer playback request does not open", () => {
  assert.equal(shouldOpen(pending, pending.bvid, pending.bvid, 8, 2), false);
});

test("missing pending marker does not open", () => {
  assert.equal(shouldOpen(null, pending.bvid, pending.bvid, 7, 2), false);
});

function eventContext() {
  const handlers = new Map();
  const playerState = { requestVersion: 7, currentPages: [{}, {}], consecutiveResolveFailures: 0 };
  let currentBvid = pending.bvid;
  let opened = 0;
  const app = vm.createContext({
    playerState,
    window: { addEventListener: (name, handler) => handlers.set(name, handler) },
    currentPlayableTrack: () => ({ bvid: currentBvid }),
    openCurrentPagesModal: () => { opened += 1; },
  });
  vm.runInContext(`let pendingPastedBvPages = null;\n${helper}\n${sourceSlice(source, "ui/main.js", "window.addEventListener(\"bili-track-changed\"", "playerPagesButton?.addEventListener(\"click\"")}`, app);
  return {
    app, handlers, playerState,
    mark: () => vm.runInContext('pendingPastedBvPages = { bvid: "BV1GF4X6MEb1", requestVersion: 7 }', app),
    setCurrent: (bvid) => { currentBvid = bvid; },
    opened: () => opened,
  };
}

test("ready multi-page event opens only once", () => {
  const app = eventContext();
  app.mark();
  app.handlers.get("bili-track-changed")({ detail: { bvid: pending.bvid } });
  app.handlers.get("bili-track-changed")({ detail: { bvid: pending.bvid } });
  assert.equal(app.opened(), 1);
});

test("single-page success, playback failure, and track switch clear the marker", () => {
  const app = eventContext();
  const ready = () => app.handlers.get("bili-track-changed")({ detail: { bvid: pending.bvid } });
  app.mark();
  app.playerState.currentPages = [{}];
  app.handlers.get("bilibili-music-trackchange")();
  app.playerState.currentPages = [{}, {}];
  ready();

  app.mark();
  app.playerState.consecutiveResolveFailures = 1;
  app.handlers.get("bilibili-music-notice-change")();
  app.playerState.consecutiveResolveFailures = 0;
  ready();

  app.mark();
  app.setCurrent("BV1rW4y1Q7o7");
  app.handlers.get("bilibili-music-trackchange")();
  app.setCurrent(pending.bvid);
  ready();
  assert.equal(app.opened(), 0);
});
