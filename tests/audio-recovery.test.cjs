const { readFileSync } = require("./helpers/module-syntax.cjs");
const { sourceSlice } = require("./helpers/source-slice.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/playback-core.js"), "utf8");
const policy = readFileSync(path.join(__dirname, "../ui/playback-policy.ts"), "utf8");
const decision = sourceSlice(policy, "ui/playback-policy.ts", "function shouldRecoverAudio(", "// 与 src-tauri/")
  + sourceSlice(source, "ui/playback-core.js", "function recoveryAttemptsFor(", "function waitForRecoveryMetadata(");
const metadataWait = sourceSlice(source, "ui/playback-core.js", "function waitForRecoveryMetadata(", "async function recoverCurrentAudio(");
const recoverCurrentAudio = sourceSlice(source, "ui/playback-core.js", "async function recoverCurrentAudio(", "function handleAudioRecoveryError(");
const loadCurrentTrack = sourceSlice(source, "ui/playback-core.js", "async function loadCurrentTrack(", "async function resumePendingPlayback(");

test("network recovery requires the current started audio and remaining attempts", () => {
  const context = vm.createContext({ recoveryVersion: 7, recoveryAttempts: 2 });
  vm.runInContext(`const MAX_AUDIO_RECOVERIES = 2;\n${decision}`, context);
  const eligible = (code, current, played, attempts) =>
    vm.runInContext(`shouldRecoverAudio(${code}, ${current}, ${played}, ${attempts})`, context);

  assert.equal(eligible(3, true, true, 0), false);
  assert.equal(eligible(2, false, true, 0), false);
  assert.equal(eligible(2, true, false, 0), false);
  assert.equal(eligible(2, true, true, 2), false);
  assert.equal(eligible(2, true, true, 0), true);
  assert.equal(vm.runInContext("recoveryAttemptsFor(7)", context), 2);
  assert.equal(vm.runInContext("recoveryAttemptsFor(8)", context), 0);
  vm.runInContext("refundRecoveryAttempt(7)", context);
  assert.equal(vm.runInContext("recoveryAttemptsFor(8)", context), 0);
});

test("metadata wait ignores its own emptied event and ends when a switch clears the source", async () => {
  const audio = new EventTarget();
  audio.readyState = 0;
  const context = vm.createContext({
    audio,
    HTMLMediaElement: { HAVE_METADATA: 1 },
    playerState: { requestVersion: 7 },
  });
  vm.runInContext(metadataWait, context);
  const loaded = vm.runInContext("waitForRecoveryMetadata(7)", context);
  audio.dispatchEvent(new Event("emptied"));
  audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(await loaded, true);

  const abandoned = vm.runInContext("waitForRecoveryMetadata(7)", context);
  context.playerState.requestVersion = 8;
  audio.dispatchEvent(new Event("emptied"));
  assert.equal(await abandoned, false);
});

test("recovery prepares the same page, seeks, and resumes without resetting track flags", async () => {
  const calls = [];
  const state = {
    requestVersion: 7,
    activeAudioUrl: "http://local/audio/old",
    currentIndex: 0,
    queue: [{ bvid: "BV1xx411c7mD" }],
  };
  const audio = {
    duration: 400,
    currentTime: 120,
    load() { calls.push("load"); },
    play() { calls.push("play"); return Promise.resolve(); },
  };
  const context = vm.createContext({
    playerState: state,
    audio,
    recoveryVersion: 7,
    recoveryAttempts: 0,
    playRecordedForCurrentTrack: true,
    cacheRequestedForCurrentTrack: true,
    loudnessAnalyzedForCurrentTrack: true,
    window: { recordPlaybackDiag: () => {} },
    performance: { now: () => 1000 },
    currentVideoPage: () => ({ cid: 42, page: 2, part: "part 2", durationSeconds: 400 }),
    currentAudioCacheCid: () => 42,
    waitForRecoveryMetadata: async () => true,
    invoke: async (command, args) => {
      calls.push({ command, args });
      return { audioUrl: "http://local/audio/new" };
    },
    refundRecoveryAttempt(version) {
      if (context.recoveryVersion === version) context.recoveryAttempts -= 1;
    },
    showPlaybackNotice: () => calls.push("notice"),
  });
  vm.runInContext(recoverCurrentAudio, context);
  await vm.runInContext('recoverCurrentAudio(7, "http://local/audio/old", 120, true)', context);

  assert.equal(calls[0].command, "prepare_audio");
  assert.equal(calls[0].args.cacheCid, 42);
  assert.equal(calls[0].args.cid, 42);
  assert.deepEqual(calls.slice(1), ["load", "play"]);
  assert.equal(state.activeAudioUrl, "http://local/audio/new");
  assert.equal(audio.currentTime, 120);
  assert.equal(context.playRecordedForCurrentTrack, true);
  assert.equal(context.cacheRequestedForCurrentTrack, true);
  assert.equal(context.loudnessAnalyzedForCurrentTrack, true);
});

test("cancelled prepare refunds its attempt; other prepare failures interrupt without skipping", async () => {
  const notices = [];
  const context = vm.createContext({
    recoveryVersion: 7,
    recoveryAttempts: 0,
    playerState: {
      requestVersion: 7,
      activeAudioUrl: "http://local/audio/old",
      currentIndex: 0,
      queue: [{ bvid: "BV1xx411c7mD" }],
    },
    audio: {},
    window: { recordPlaybackDiag: () => {} },
    currentVideoPage: () => null,
    currentAudioCacheCid: () => 42,
    invoke: async () => { throw "audio resolution was cancelled"; },
    showPlaybackNotice: (message) => notices.push(message),
    playbackFailureMessage: () => "音频源暂时连不上",
  });
  vm.runInContext(`const MAX_AUDIO_RECOVERIES = 2;\n${decision}\n${recoverCurrentAudio}`, context);
  await vm.runInContext('recoverCurrentAudio(7, "http://local/audio/old", 120, true)', context);
  assert.equal(context.recoveryAttempts, 0);
  assert.deepEqual(notices, []);

  context.invoke = async () => { throw "audio URL probe request failed"; };
  await vm.runInContext('recoverCurrentAudio(7, "http://local/audio/old", 120, true)', context);
  assert.equal(context.recoveryAttempts, 1);
  assert.deepEqual(notices, ["音频源暂时连不上，播放已中断。"]);
});

function trackContext(recoveryPromise) {
  const calls = [];
  const context = vm.createContext({
    recoveryPromise,
    playerState: { currentIndex: 0, queue: [{ bvid: "BV1xx411c7mD" }], requestVersion: 0 },
    stopAudioElement() {},
    searchButton: { disabled: false },
    result: { hidden: true },
    status: { textContent: "" },
    currentVideoPage: () => null,
    currentAudioCacheCid: () => 42,
    invoke(command) {
      calls.push(command);
      return command === "cancel_prepare_audio" ? Promise.resolve() : new Promise(() => {});
    },
  });
  vm.runInContext(loadCurrentTrack, context);
  return { context, calls };
}

test("switch waits for an active recovery before starting prepare_audio", async () => {
  let finishRecovery;
  const recovery = new Promise((resolve) => { finishRecovery = resolve; });
  const { context, calls } = trackContext(recovery);

  vm.runInContext("loadCurrentTrack({ keepPage: true })", context);
  assert.deepEqual(calls, ["cancel_prepare_audio"]);
  finishRecovery();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["cancel_prepare_audio", "prepare_audio"]);
});

test("only the latest rapid switch starts prepare_audio after recovery", async () => {
  let finishRecovery;
  const recovery = new Promise((resolve) => { finishRecovery = resolve; });
  const { context, calls } = trackContext(recovery);

  vm.runInContext("loadCurrentTrack({ keepPage: true })", context);
  vm.runInContext("loadCurrentTrack({ keepPage: true })", context);
  assert.deepEqual(calls, ["cancel_prepare_audio", "cancel_prepare_audio"]);
  finishRecovery();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["cancel_prepare_audio", "cancel_prepare_audio", "prepare_audio"]);
});

test("without a recovery, prepare_audio starts synchronously as before", () => {
  const { context, calls } = trackContext(null);
  vm.runInContext("loadCurrentTrack({ keepPage: true })", context);
  assert.deepEqual(calls, ["prepare_audio"]);
});

test("expired token network error after a long pause re-resolves the same page and resumes its position", async () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    return { promise, resolve };
  };
  const prepareStarted = deferred(), prepareResult = deferred(), metadataListening = deferred();
  const calls = [], diagnostics = [], notices = [];
  let now = 0, plays = 0;
  const oldUrl = "http://127.0.0.1/audio/expired-token";
  const newUrl = "http://127.0.0.1/audio/new-token";
  const state = {
    requestVersion: 7, activeAudioVersion: 7, activeAudioUrl: oldUrl, audioActivatedAt: 0,
    currentIndex: 0, currentPageIndex: 1,
    queue: [{ bvid: "BV0000000001" }],
    currentPages: [{ page: 1, cid: 11 }, { page: 2, cid: 42, part: "P2", durationSeconds: 400 }],
  };
  const audio = new EventTarget();
  Object.assign(audio, {
    src: oldUrl, currentTime: 120, duration: 400, readyState: 1, error: null, paused: true,
    pause() { this.paused = true; this.dispatchEvent(new Event("pause")); },
    play() { plays += 1; this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); },
    load() {
      this.currentTime = 0; this.readyState = 0; this.error = null;
      this.dispatchEvent(new Event("emptied"));
    },
  });
  Object.defineProperty(audio, "currentSrc", { get: () => audio.src });
  const addListener = audio.addEventListener.bind(audio);
  audio.addEventListener = (type, listener, options) => {
    addListener(type, listener, options);
    if (type === "loadedmetadata") metadataListening.resolve();
  };
  const context = vm.createContext({
    Event, audio, playerState: state, MAX_AUDIO_RECOVERIES: 2,
    HTMLMediaElement: { HAVE_METADATA: 1 }, performance: { now: () => now },
    playRecordedForCurrentTrack: true, cacheRequestedForCurrentTrack: true, loudnessAnalyzedForCurrentTrack: true,
    window: { recordPlaybackDiag: (...entry) => diagnostics.push(entry) },
    showPlaybackNotice: message => notices.push(message),
    invoke(command, args) {
      calls.push({ command, args }); prepareStarted.resolve();
      return prepareResult.promise;
    },
  });
  const mainSource = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
  const chain = sourceSlice(source, "ui/playback-core.js", "let recoveryPromise =", "let pendingPastedBvPages =")
    + sourceSlice(source, "ui/playback-core.js", "function hasMultipleCurrentPages()", "function updatePlayerPagesButton()")
    + sourceSlice(policy, "ui/playback-policy.ts", "function shouldRecoverAudio(", "// 与 src-tauri/")
    + sourceSlice(source, "ui/playback-core.js", "function recoveryAttemptsFor(", "let loudnessQueryVersion")
    + sourceSlice(source, "ui/playback-core.js", "function initPlaybackAudioIdentity()", "function initPlaybackModes()")
    + "\ninitPlaybackAudioIdentity();\n"
    + sourceSlice(mainSource, "ui/main.js", 'audio.addEventListener("error", handleAudioRecoveryError);', '\nfor (const eventName');
  vm.runInContext(chain, context);
  await audio.play();
  audio.dispatchEvent(new Event("playing"));
  audio.pause();
  now += (60 * 60 + 1) * 1000; // Advance past proxy TTL without sleeping.
  assert.equal(audio.currentTime, 120);
  await audio.play();
  // The existing proxy Rust test verifies the expired-token 410/empty body.
  // For an already usable resource, HTML maps fatal network failure to code 2.
  audio.error = { code: 2, message: "HTTP 410 Gone" };
  audio.dispatchEvent(new Event("error"));
  const recovery = vm.runInContext("recoveryPromise", context);
  await prepareStarted.promise;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "prepare_audio");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), {
    bvId: "BV0000000001", cid: 42, cacheCid: 42, page: 2, part: "P2", durationSeconds: 400,
  });
  prepareResult.resolve({ audioUrl: newUrl });
  await metadataListening.promise;
  assert.equal(audio.src, newUrl);
  assert.equal(audio.currentTime, 0);
  audio.readyState = 1;
  audio.dispatchEvent(new Event("loadedmetadata"));
  await recovery;
  assert.equal(audio.currentTime, 120);
  assert.equal(audio.paused, false);
  assert.equal(plays, 3);
  assert.equal(state.activeAudioUrl, newUrl);
  assert.equal(state.requestVersion, 7);
  assert.equal(state.currentIndex, 0);
  assert.equal(state.currentPageIndex, 1);
  assert.equal(context.playRecordedForCurrentTrack, true);
  assert.equal(context.cacheRequestedForCurrentTrack, true);
  assert.equal(context.loudnessAnalyzedForCurrentTrack, true);
  assert.equal(vm.runInContext("recoveryPromise", context), null);
  assert.deepEqual(notices, []);
  assert.equal(diagnostics.at(-1)[1], "success attempt=1");
});
