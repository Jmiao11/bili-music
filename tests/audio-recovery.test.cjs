const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const decision = source.slice(
  source.indexOf("function shouldRecoverAudio("),
  source.indexOf("function waitForRecoveryMetadata("),
);
const metadataWait = source.slice(
  source.indexOf("function waitForRecoveryMetadata("),
  source.indexOf("async function recoverCurrentAudio("),
);
const recoverCurrentAudio = source.slice(
  source.indexOf("async function recoverCurrentAudio("),
  source.indexOf("function handleAudioRecoveryError("),
);
const loadCurrentTrack = source.slice(
  source.indexOf("async function loadCurrentTrack("),
  source.indexOf("async function resumePendingPlayback("),
);

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
