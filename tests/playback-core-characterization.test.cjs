const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const { sourceSlice } = require("./helpers/source-slice.cjs");

const read = (file) => readFileSync(path.join(__dirname, "../ui", file), "utf8");
const main = read("playback-core.js");
const search = read("search.js");
const state = read("player-state.js");
const policy = read("playback-policy.js");
const slice = (start, end) => sourceSlice(main, "ui/playback-core.js", start, end);
const stateCode = sourceSlice(state, "ui/player-state.js", "const playerState =", "const searchState =").replace(/\n\n$/, "\n")
  + sourceSlice(state, "ui/player-state.js", "const searchState =", "const LAST_SEARCH_KEY")
  + sourceSlice(state, "ui/player-state.js", "const homeState =", "const libraryState =")
  + sourceSlice(state, "ui/player-state.js", "const libraryState =", "const favoriteDragState =");
const functions = read("page-selection.ts") + read("track-utils.js")
  + slice("function currentTrackSnapshot()", "function resetRandomRemaining(")
  + sourceSlice(policy, "ui/playback-policy.js", "function shuffled(", "function readShuffleCollectionPrefs(")
  + slice("function resetRandomRemaining(", "function stopAudioElement()")
  + slice("function stopAudioElement()", "function updateQueueUi()")
  + sourceSlice(policy, "ui/playback-policy.js", "function readShuffleCollectionPrefs(", "function shouldRecoverAudio(")
  + slice("function waitForAudioMetadata()", "function recoveryAttemptsFor(")
  + slice("function waitForRecoveryMetadata(", "async function recoverCurrentAudio(")
  + slice("async function loadCurrentTrack(", "function playBvId(")
  + slice("function playSearchResult(", "function advancePageWithinCurrentBv(")
  + slice("function playNext(", "function initPlaybackSearch(")
  + sourceSlice(search, "ui/search.js", "function setSearchResults(", "function renderSearchResults(")
  + search.slice(search.indexOf("function currentSearchRequest(")) + "\n";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const track = (bvid) => ({ bvid, title: bvid, uploader: "作者", thumbnailUrl: "", durationSeconds: 80 });
const pages = (cid = 17) => [{ page: 1, cid, part: "P1", durationSeconds: 80 }];
const info = (name) => ({ audioUrl: `http://127.0.0.1/audio/${name}`, title: name, uploader: "作者", thumbnailUrl: "", durationSeconds: 80 });
const plain = (value) => JSON.parse(JSON.stringify(value));

function setup({ manual = [] } = {}) {
  const calls = [], waiters = [], notices = [], events = [], warnings = [];
  const record = (call) => {
    calls.push(call);
    for (const waiter of [...waiters]) {
      const matches = calls.filter((item) => item.command === waiter.command);
      if (matches[waiter.index]) { waiter.resolve(matches[waiter.index]); waiters.splice(waiters.indexOf(waiter), 1); }
    }
  };
  const metadataRequested = deferred();
  const audio = new EventTarget();
  Object.assign(audio, {
    src: "", currentTime: 0, duration: 80, readyState: 0, paused: true,
    pause() { this.paused = true; record({ command: "pause" }); },
    load() { this.currentTime = 0; this.readyState = 0; record({ command: "load" }); },
    removeAttribute(name) { if (name === "src") this.src = ""; },
    play() { this.paused = false; record({ command: "play" }); return this.playGate?.promise ?? Promise.resolve(); },
  });
  Object.defineProperty(audio, "currentSrc", { get: () => audio.src });
  const addListener = audio.addEventListener.bind(audio);
  audio.addEventListener = (type, listener) => {
    addListener(type, listener);
    if (type === "loadedmetadata") metadataRequested.resolve();
  };
  const node = () => ({
    disabled: false, hidden: false, value: "", textContent: "", dataset: {},
    style: { setProperty() {} }, setAttribute() {},
  });
  const context = vm.createContext({
    Event, CustomEvent: class extends Event { constructor(type, options) { super(type); this.detail = options.detail; } },
    audio, HTMLMediaElement: { HAVE_METADATA: 1 }, performance: { now: () => 100 },
    window: { recordPlaybackDiag() {}, dispatchEvent: (event) => events.push(event) },
    console: { warn: (...args) => warnings.push(args), error() {} },
    localStorage: { getItem: () => null },
    DEFAULT_MUSIC_TIDS: 3, SEARCH_PAGE_SIZE: 20, MUSIC_HOT_KEYWORD: "音乐", MAX_CONSECUTIVE_RESOLVE_FAILURES: 5,
    pendingResume: null, resumeInProgress: false, lastPlaybackStateSavedAt: 0, recoveryPromise: null,
    randomPageRound: null, playRecordedForCurrentTrack: false, loudnessAnalyzedForCurrentTrack: false,
    cacheRequestedForCurrentTrack: false, cacheRequestPromise: null,
    clearPlaybackNotice() {}, showPlaybackNotice: (message) => notices.push(message),
    updateQueueUi() {}, renderLibraryViews() {}, renderSearchResults() {}, refreshTrackLoudness() {},
    advancePageWithinCurrentBv: () => false, saveLastSearchKeyword() {}, recordSearchHistoryFireAndForget() {},
    invoke(command, args) {
      const gate = deferred();
      const call = { command, args, ...gate };
      record(call);
      if (!["prepare_audio", "get_video_pages", "get_playback_state", "search_videos", ...manual].includes(command)) gate.resolve(null);
      return gate.promise;
    },
  });
  for (const name of ["searchButton", "result", "status", "thumbnail", "title", "uploader", "duration", "playerPagesButton", "playerPagesGroup", "searchKeyword", "searchStatus", "resumeProgressSlider", "immersiveResumeProgressSlider", "resumeCurrentTimeLabel", "immersiveResumeCurrentTimeLabel", "immersiveResumeDurationLabel"]) context[name] = node();
  vm.runInContext(stateCode + functions + "\nglobalThis.states = { playerState, searchState, homeState, libraryState }; Math.random = () => 0;", context);
  const request = (command, index = 0) => {
    const call = calls.filter((item) => item.command === command)[index];
    if (call) return Promise.resolve(call);
    const gate = deferred(); waiters.push({ command, index, resolve: gate.resolve }); return gate.promise;
  };
  return { context, ...context.states, audio, calls, request, notices, events, warnings, metadataRequested };
}

for (const outcome of ["resolve", "reject"]) {
  test(`ordinary loading ignores an old ${outcome} after a newer prepare starts`, async () => {
    const h = setup();
    h.playerState.queue = [track("BV0000000001"), track("BV0000000002")];
    h.playerState.currentIndex = 0;
    const old = h.context.loadCurrentTrack();
    (await h.request("get_video_pages")).resolve(pages(11));
    const oldPrepare = await h.request("prepare_audio");
    h.playerState.currentIndex = 1;
    const current = h.context.loadCurrentTrack();
    (await h.request("get_video_pages", 1)).resolve(pages(22));
    const newPrepare = await h.request("prepare_audio", 1);
    oldPrepare[outcome](outcome === "resolve" ? info("old") : "failed with code 62002");
    await old;
    assert.equal(h.audio.src, "");
    assert.equal(h.context.searchButton.disabled, true);
    assert.equal(h.playerState.consecutiveResolveFailures, 0);
    assert.equal(h.libraryState.unavailableBvids.size, 0);
    assert.deepEqual(h.notices, []);
    newPrepare.resolve(info("new"));
    await current;
    assert.equal(h.audio.src, info("new").audioUrl);
    assert.equal(h.playerState.activeAudioVersion, h.playerState.requestVersion);
    assert.equal(h.playerState.queue[0].title, "BV0000000001");
    assert.equal(h.playerState.queue[1].title, "new");
    assert.equal(h.context.searchButton.disabled, false);
  });
}

test("ordinary loading ignores old pages while the new page request is pending", async () => {
  const h = setup();
  h.playerState.queue = [track("BV0000000001"), track("BV0000000002")];
  h.playerState.currentIndex = 0;
  const old = h.context.loadCurrentTrack();
  const oldPages = await h.request("get_video_pages");
  h.playerState.currentIndex = 1;
  const current = h.context.loadCurrentTrack();
  oldPages.resolve(pages(11));
  await old;
  assert.equal(h.calls.filter((call) => call.command === "prepare_audio").length, 0);
  assert.equal(h.playerState.currentPages.length, 0);
  assert.equal(h.context.searchButton.disabled, true);
  (await h.request("get_video_pages", 1)).resolve(pages(22));
  const prepare = await h.request("prepare_audio");
  assert.equal(prepare.args.bvId, "BV0000000002");
  assert.equal(prepare.args.cacheCid, 22);
  prepare.resolve(info("new"));
  await current;
  assert.equal(h.playerState.currentPages[0].cid, 22);
});

test("an old play rejection cannot overwrite the newer loading status or release its button", async () => {
  const h = setup();
  h.playerState.queue = [track("BV0000000001"), track("BV0000000002")]; h.playerState.currentIndex = 0;
  h.audio.playGate = deferred();
  const playGate = h.audio.playGate;
  const old = h.context.loadCurrentTrack();
  (await h.request("get_video_pages")).resolve(pages(11));
  (await h.request("prepare_audio")).resolve(info("old"));
  await h.request("play");
  h.audio.playGate = null;
  h.playerState.currentIndex = 1;
  const current = h.context.loadCurrentTrack();
  playGate.reject("play was interrupted");
  await old;
  assert.equal(h.context.status.textContent, "正在解析音频…");
  assert.equal(h.context.searchButton.disabled, true);
  (await h.request("get_video_pages", 1)).resolve(pages(22));
  (await h.request("prepare_audio", 1)).resolve(info("new"));
  await current;
  assert.equal(h.context.status.textContent, "在线播放中。");
  assert.equal(h.audio.currentSrc, info("new").audioUrl);
});

test("cancel invalidates the prepare immediately and ignores its rejection before backend acknowledgement", async () => {
  const h = setup({ manual: ["cancel_prepare_audio"] });
  h.playerState.queue = [track("BV0000000001")]; h.playerState.currentIndex = 0;
  const loading = h.context.loadCurrentTrack();
  (await h.request("get_video_pages")).resolve(pages());
  const prepare = await h.request("prepare_audio");
  const version = h.playerState.requestVersion;
  const cancelled = h.context.cancelCurrentPlayback();
  assert.equal(h.playerState.requestVersion, version + 1);
  assert.equal(h.playerState.activeAudioVersion, -1);
  assert.equal(h.playerState.activeAudioUrl, "");
  assert.equal(h.audio.currentSrc, "");
  assert.equal(h.audio.paused, true);
  assert.equal(h.context.searchButton.disabled, false);
  prepare.reject("audio resolution was cancelled");
  await loading;
  assert.equal(h.playerState.consecutiveResolveFailures, 0);
  assert.deepEqual(h.notices, []);
  (await h.request("cancel_prepare_audio")).reject("no active resolver");
  await cancelled;
  assert.equal(h.libraryState.unavailableBvids.size, 0);
});

for (const count of [0, 1, 3]) for (const loopMode of ["sequence", "list", "single"]) for (const shuffle of [false, true]) {
  test(`queue navigation matrix: ${count} tracks / ${loopMode} / shuffle=${shuffle}`, () => {
    for (const automatic of [false, true]) {
      const h = setup(), visited = [];
      Object.assign(h.playerState, { queue: Array.from({ length: count }, (_, index) => track(`BV${index}`)), currentIndex: count - 1, loopMode, shuffle });
      h.context.playQueueIndex = (index) => visited.push(index);
      h.context.resetRandomRemaining();
      assert.deepEqual([...h.playerState.randomRemaining].sort(), Array.from({ length: Math.max(0, count - 1) }, (_, index) => index));
      const repeated = count > 0 && automatic && loopMode === "single";
      const target = repeated ? count - 1 : count === 3 && shuffle ? 0 : count > 0 && loopMode === "list" ? 0 : null;
      assert.equal(h.context.playNext({ automatic }), target !== null);
      assert.deepEqual(visited, target === null ? [] : [target]);
      h.context.resetRandomRemaining();
      const drawn = Array.from({ length: Math.max(0, count - 1) }, () => h.context.takeRandomNext());
      assert.deepEqual([...drawn].sort(), Array.from({ length: Math.max(0, count - 1) }, (_, index) => index));
      const afterRound = h.context.takeRandomNext();
      assert.equal(afterRound, loopMode === "list" && count > 0 ? 0 : null);
    }
  });
}

test("restore, explicit resume, page selection, metadata seek and save form one chain", async () => {
  const h = setup();
  const restoring = h.context.restorePlaybackState();
  (await h.request("get_playback_state")).resolve({ queue: [track("BV0000000001")], currentIndex: 0, positionSeconds: 120, page: 2, cid: 22 });
  await restoring;
  assert.equal(h.playerState.queueSource, "restored");
  assert.equal(h.playerState.currentIndex, 0);
  assert.equal(h.audio.currentSrc, "");
  assert.equal(h.audio.paused, true);
  assert.equal(h.context.resumeProgressSlider.value, "80");
  assert.deepEqual(plain(h.context.pendingResume), { positionSeconds: 120, page: 2, cid: 22 });
  const resuming = h.context.resumePendingPlayback();
  await h.context.resumePendingPlayback();
  const pageRequest = await h.request("get_video_pages");
  assert.equal(h.calls.filter((call) => call.command === "get_video_pages").length, 1);
  pageRequest.resolve([...pages(11), { page: 2, cid: 22, part: "P2", durationSeconds: 50 }]);
  const prepare = await h.request("prepare_audio");
  assert.equal(prepare.args.cid, 22);
  assert.equal(prepare.args.page, 2);
  prepare.resolve(info("restored"));
  await h.metadataRequested.promise;
  assert.equal(h.audio.currentTime, 0);
  h.audio.duration = 50;
  h.audio.dispatchEvent(new Event("loadedmetadata"));
  await resuming;
  assert.equal(h.audio.currentTime, 49);
  assert.equal(h.context.pendingResume, null);
  assert.equal(h.context.resumeInProgress, false);
  assert.equal(h.playerState.currentPageIndex, 1);
  assert.equal(h.context.title.textContent, "P2");
  const saved = await h.request("save_playback_state");
  assert.equal(saved.args.state.positionSeconds, 49);
  assert.equal(saved.args.state.cid, 22);
  assert.equal(saved.args.state.page, 2);
  assert.equal(h.context.status.textContent, "在线播放中。");
});

test("a late saved state cannot replace a queue selected while restore was pending", async () => {
  const h = setup();
  const restoring = h.context.restorePlaybackState();
  h.context.setQueue([track("BV0000000002")]);
  (await h.request("get_playback_state")).resolve({ queue: [track("BV0000000001")], currentIndex: 0, positionSeconds: 20 });
  await restoring;
  assert.equal(h.playerState.queue[0].bvid, "BV0000000002");
  assert.equal(h.playerState.queueSource, "direct");
  assert.equal(h.context.pendingResume, null);
});

test("unavailable marking, failure skip, successful clear and persistence errors keep playback progressing", async () => {
  const h = setup({ manual: ["mark_track_unavailable", "clear_track_unavailable"] });
  h.playerState.queue = [track("BV0000000001"), track("BV0000000002")]; h.playerState.currentIndex = 0;
  h.libraryState.unavailableBvids.set("bv0000000002", "旧标记");
  const failed = h.context.loadCurrentTrack();
  (await h.request("get_video_pages")).resolve(pages(11));
  (await h.request("prepare_audio")).reject("failed with code 62002");
  await failed;
  const mark = await h.request("mark_track_unavailable");
  assert.deepEqual(plain(mark.args), { bvid: "BV0000000001", reason: "该视频已被删除或设为私密" });
  assert.equal(h.libraryState.unavailableBvids.get("bv0000000001"), mark.args.reason);
  assert.equal(h.playerState.currentIndex, 1);
  assert.equal(h.playerState.consecutiveResolveFailures, 1);
  (await h.request("get_video_pages", 1)).resolve(pages(22));
  (await h.request("prepare_audio", 1)).resolve(info("next"));
  const cleared = await h.request("clear_track_unavailable");
  assert.equal(cleared.args.bvid, "BV0000000002");
  assert.equal(h.libraryState.unavailableBvids.has("bv0000000002"), false);
  mark.reject("mark write failed"); cleared.reject("clear write failed");
  await Promise.all([mark.promise.catch(() => {}), cleared.promise.catch(() => {})]);
  await h.request("play");
  assert.equal(h.audio.src, info("next").audioUrl);
  assert.equal(h.playerState.consecutiveResolveFailures, 0);
  assert.equal(h.warnings.length, 2);
});

test("new search and old pagination update only the display until an explicit result click", async () => {
  const h = setup();
  h.playerState.queue = [track("BV0000000001")]; h.playerState.currentIndex = 0; h.playerState.queueSource = "favorites";
  h.audio.src = "http://127.0.0.1/audio/current";
  const queue = h.playerState.queue, version = h.playerState.requestVersion;
  h.searchState.requestKeyword = "旧搜索"; h.searchState.userKeyword = "旧搜索"; h.searchState.page = 1; h.searchState.hasMore = true;
  h.context.searchKeyword.value = "旧搜索";
  const pagination = h.context.loadMoreSearchResults();
  h.context.searchKeyword.value = "新搜索";
  const searching = h.context.runSearch();
  (await h.request("search_videos")).resolve([track("BV0000000003")]);
  await pagination;
  assert.equal(h.searchState.results.length, 0);
  (await h.request("search_videos", 1)).resolve([track("BV0000000002")]);
  await searching;
  assert.equal(h.playerState.queue, queue);
  assert.equal(h.playerState.requestVersion, version);
  assert.equal(h.audio.currentSrc, "http://127.0.0.1/audio/current");
  assert.equal(h.searchState.results[0].bvid, "BV0000000002");
  h.context.playSearchResult(0);
  assert.equal(h.playerState.queueSource, "search");
  assert.equal(h.playerState.queueSearchVersion, h.searchState.requestVersion);
  assert.equal(h.playerState.queue[0].bvid, "BV0000000002");
  (await h.request("get_video_pages")).resolve(pages());
  (await h.request("prepare_audio")).resolve(info("selected"));
  await h.request("play");
  assert.equal(h.audio.currentSrc, info("selected").audioUrl);
});

for (const outcome of ["resolve", "reject"]) {
  test(`an old search ${outcome} cannot replace the new results or interrupt playback`, async () => {
    const h = setup();
    h.playerState.queue = [track("BV0000000001")]; h.playerState.currentIndex = 0;
    h.audio.src = "http://127.0.0.1/audio/current";
    const queue = h.playerState.queue;
    const old = h.context.runSearch({ userKeyword: "旧搜索" });
    const current = h.context.runSearch({ userKeyword: "新搜索" });
    (await h.request("search_videos"))[outcome](outcome === "resolve" ? [track("BV0000000003")] : "old search failed");
    await old;
    assert.equal(h.searchState.results.length, 0);
    assert.equal(h.context.searchButton.disabled, true);
    (await h.request("search_videos", 1)).resolve([track("BV0000000002")]);
    await current;
    assert.equal(h.searchState.results[0].bvid, "BV0000000002");
    assert.equal(h.playerState.queue, queue);
    assert.equal(h.playerState.requestVersion, 0);
    assert.equal(h.audio.currentSrc, "http://127.0.0.1/audio/current");
  });
}

test("pagination extends the playback queue only when it belongs to this search", async () => {
  for (const sameSearch of [false, true]) {
    const h = setup();
    h.searchState.results = [track("BV0000000001")];
    h.searchState.requestVersion = 3; h.searchState.requestKeyword = "音乐"; h.searchState.userKeyword = "音乐";
    h.searchState.page = 1; h.searchState.hasMore = true; h.context.searchKeyword.value = "音乐";
    h.playerState.queue = [track("BV0000000001")]; h.playerState.currentIndex = 0; h.playerState.shuffle = true;
    h.playerState.queueSearchVersion = sameSearch ? 3 : null;
    const loading = h.context.loadMoreSearchResults();
    (await h.request("search_videos")).resolve([track("BV0000000001"), track("BV0000000002")]);
    await loading;
    assert.equal(h.searchState.results.length, 2);
    assert.equal(h.playerState.queue.length, sameSearch ? 2 : 1);
    assert.deepEqual([...h.playerState.randomRemaining], sameSearch ? [1] : []);
    assert.equal(h.playerState.currentIndex, 0);
    assert.equal(h.playerState.requestVersion, 0);
  }
});

test("appending search results preserves per-track flags and still broadcasts", () => {
  const h = setup();
  h.playerState.queue = [track("BV0000000001")];
  h.playerState.currentIndex = 0;
  h.playerState.currentPages = pages(11);
  h.searchState.results = [...h.playerState.queue];
  h.playerState.queueSearchVersion = h.searchState.requestVersion;
  h.context.emitCurrentTrackChanged();
  const pendingCache = Promise.resolve();
  Object.assign(h.context, {
    playRecordedForCurrentTrack: true, loudnessAnalyzedForCurrentTrack: true,
    cacheRequestedForCurrentTrack: true, cacheRequestPromise: pendingCache,
  });
  assert.equal(h.context.appendSearchResults([track("BV0000000002")]), 1);
  assert.equal(h.context.playRecordedForCurrentTrack, true);
  assert.equal(h.context.loudnessAnalyzedForCurrentTrack, true);
  assert.equal(h.context.cacheRequestedForCurrentTrack, true);
  assert.equal(h.context.cacheRequestPromise, pendingCache);
  assert.equal(h.events.length, 2);
  assert.equal(h.events[1].detail.bvid, "BV0000000001");
  assert.equal(h.playerState.queue.length, 2);
});

for (const change of ["bvid", "cid", "page"]) {
  test(`changing the current ${change} resets per-track flags`, () => {
    const h = setup();
    h.playerState.queue = [track("BV0000000001"), track("BV0000000002")];
    h.playerState.currentIndex = 0;
    h.playerState.currentPages = change === "page" ? [] : pages(11);
    h.context.emitCurrentTrackChanged();
    Object.assign(h.context, {
      playRecordedForCurrentTrack: true, loudnessAnalyzedForCurrentTrack: true,
      cacheRequestedForCurrentTrack: true, cacheRequestPromise: Promise.resolve(),
    });
    if (change === "bvid") h.playerState.currentIndex = 1;
    else if (change === "cid") h.playerState.currentPages = pages(22);
    else h.playerState.currentPageIndex = 1;
    h.context.emitCurrentTrackChanged();
    assert.equal(h.context.playRecordedForCurrentTrack, false);
    assert.equal(h.context.loudnessAnalyzedForCurrentTrack, false);
    assert.equal(h.context.cacheRequestedForCurrentTrack, false);
    assert.equal(h.context.cacheRequestPromise, null);
    assert.equal(h.events.length, 2);
  });
}

for (const action of ["cancel", "switch"]) {
  test(`ordinary metadata waiting ends after ${action} without affecting a newer load`, async () => {
    const h = setup();
    h.playerState.queue = [track("BV0000000001"), track("BV0000000002")];
    h.playerState.currentIndex = 0;
    let finished = false;
    const old = h.context.loadCurrentTrack({ resumePosition: 35 }).then(() => { finished = true; });
    (await h.request("get_video_pages")).resolve(pages(11));
    (await h.request("prepare_audio")).resolve(info("old"));
    await h.metadataRequested.promise;
    let current;
    if (action === "cancel") {
      const cancelling = h.context.cancelCurrentPlayback();
      h.audio.dispatchEvent(new Event("emptied"));
      await cancelling;
      await Promise.resolve();
      assert.equal(finished, true);
      assert.equal(h.audio.src, "");
      assert.equal(h.audio.currentTime, 0);
      assert.equal(h.playerState.activeAudioVersion, -1);
    }
    h.playerState.currentIndex = 1;
    current = h.context.loadCurrentTrack();
    h.audio.dispatchEvent(new Event("emptied"));
    (await h.request("get_video_pages", 1)).resolve(pages(22));
    (await h.request("prepare_audio", 1)).resolve(info("new"));
    await current;
    assert.equal(finished, true);
    await old;
    assert.equal(h.audio.src, info("new").audioUrl);
    assert.equal(h.audio.currentTime, 0);
    assert.equal(h.playerState.activeAudioVersion, h.playerState.requestVersion);
    assert.equal(h.context.title.textContent, "new");
    assert.equal(h.context.status.textContent, "在线播放中。");
    assert.equal(h.calls.filter(call => call.command === "save_playback_state").length, 1);
    const listeners = require("node:events").getEventListeners;
    for (const event of ["loadedmetadata", "error", "emptied"]) {
      assert.equal(listeners(h.audio, event).length, 0);
    }
    h.audio.dispatchEvent(new Event("loadedmetadata"));
    assert.equal(h.audio.currentTime, 0);
  });
}
