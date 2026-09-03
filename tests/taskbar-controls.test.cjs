const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

// Execute the real, isolated bridge without booting the rest of the application.
const source = readFileSync(path.join(__dirname, "../ui/appearance.js"), "utf8");
const bridge = source.slice(
  source.indexOf("function initializeTaskbarControls() {"),
  source.indexOf("function syncImmersiveTrack("),
);
assert.ok(bridge.startsWith("function initializeTaskbarControls() {"));

const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup(invoke = () => Promise.resolve(), listenResult) {
  const audio = Object.assign(new EventTarget(), {
    currentSrc: "", paused: true, ended: false, error: null,
  });
  const window = new EventTarget();
  const clicked = [];
  const reports = [];
  const warnings = [];
  let receive;
  let unlistened = 0;
  const stop = () => { unlistened++; return Promise.resolve(); };
  window.__TAURI__ = { event: { listen(name, handler) {
    assert.equal(name, "taskbar-media-control");
    receive = handler;
    return listenResult ? listenResult(stop) : Promise.resolve(stop);
  } } };
  const context = vm.createContext({
    window,
    playerAudio: audio,
    playPauseButton: { click: () => clicked.push("play_pause") },
    previousButtonForImmersive: { click: () => clicked.push("previous") },
    nextButtonForImmersive: { click: () => clicked.push("next") },
    invokeAppearance(command, payload) {
      assert.equal(command, "set_taskbar_playback_state");
      reports.push(payload.isPlaying);
      return invoke(payload.isPlaying);
    },
    console: { warn: (...args) => warnings.push(args) },
  });
  vm.runInContext(bridge + "\ninitializeTaskbarControls();", context);
  return {
    audio, clicked, reports, warnings,
    send: (payload) => receive({ payload }),
    fire: (name, state = {}) => {
      Object.assign(audio, state);
      audio.dispatchEvent(new Event(name));
    },
    unload: () => window.dispatchEvent(new Event("beforeunload")),
    get unlistened() { return unlistened; },
  };
}

test("media commands click existing buttons without predicting playback state", async () => {
  const app = setup();
  await settle();
  for (const action of ["play_pause", "previous", "next", "unknown", null]) app.send(action);
  assert.deepEqual(app.clicked, ["play_pause", "previous", "next"]);
  assert.deepEqual(app.reports, [false]);
});

test("initial state and all five audio events report the real playback state", async () => {
  const app = setup();
  await settle();
  const playing = () => app.fire("play", {
    currentSrc: "http://127.0.0.1/audio/test", paused: false, ended: false, error: null,
  });
  for (const [event, state] of [
    ["pause", { paused: true }],
    ["ended", { ended: true }],
    ["emptied", { currentSrc: "" }],
    ["error", { error: { code: 2 } }],
  ]) {
    playing();
    app.fire(event, state);
  }
  await settle();
  assert.deepEqual(app.reports, [false, true, false, true, false, true, false, true, false]);
});

test("rapid reports stay ordered even while an earlier invoke is pending", async () => {
  let finish;
  const app = setup((playing) => playing ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve());
  await settle();
  app.fire("play", { currentSrc: "audio", paused: false });
  await settle();
  app.fire("pause", { paused: true });
  await settle();
  assert.deepEqual(app.reports, [false, true]);
  finish();
  await settle();
  assert.deepEqual(app.reports, [false, true, false]);
});

test("failed listener and command only log and do not break later reports", async () => {
  const app = setup(
    (playing) => playing ? Promise.resolve() : Promise.reject(new Error("unavailable")),
    () => Promise.reject(new Error("listener unavailable")),
  );
  await settle();
  app.fire("play", { currentSrc: "audio", paused: false });
  await settle();
  assert.deepEqual(app.reports, [false, true]);
  assert.equal(app.warnings.length, 2);
});

test("unload removes listeners even when event registration finishes late", async () => {
  let completeRegistration;
  const app = setup(undefined, (stop) => new Promise((resolve) => {
    completeRegistration = () => resolve(stop);
  }));
  await settle();
  app.unload();
  completeRegistration();
  await settle();
  app.send("next");
  app.fire("play", { currentSrc: "audio", paused: false });
  await settle();
  assert.equal(app.unlistened, 1);
  assert.deepEqual(app.clicked, []);
  assert.deepEqual(app.reports, [false]);
});
