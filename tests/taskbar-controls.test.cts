const { sourceSlice }: import("./helpers/source-slice.cts").Contract = require("./helpers/source-slice.cts");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const { readFileSync }: import("./helpers/module-syntax.cts").Contract = require("./helpers/module-syntax.cts");
const path: typeof import("node:path") = require("node:path");
const { test }: typeof import("node:test") = require("node:test");
const vm: typeof import("node:vm") = require("node:vm");

// Execute the real, isolated bridge without booting the rest of the application.
const source = readFileSync(path.join(__dirname, "../ui/appearance.ts"), "utf8");
const bridge = sourceSlice(source, "ui/appearance.ts", "function initializeTaskbarControls() {", "function syncImmersiveTrack(");
assert.ok(bridge.startsWith("function initializeTaskbarControls() {"));

const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup(invoke: (playing: boolean) => Promise<void> = () => Promise.resolve(), listenResult?: (stop: () => Promise<void>) => Promise<() => Promise<void>>) {
  const audio = Object.assign(new EventTarget(), {
    currentSrc: "", paused: true, ended: false, error: null,
  });
  const window = (new EventTarget() as EventTarget & { __TAURI__?: { event: { listen(name: string, handler: (...args: unknown[]) => unknown): Promise<() => Promise<void>> } } });
  const clicked: string[] = [];
  const reports: boolean[] = [];
  const warnings: unknown[][] = [];
  let receive: ((...args: unknown[]) => unknown) | undefined;
  let unlistened = 0;
  const stop = () => { unlistened++; return Promise.resolve(); };
  window.__TAURI__ = { event: { listen(name: string, handler: (...args: unknown[]) => unknown) {
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
    invokeAppearance(command: string, payload: CommandMap["set_taskbar_playback_state"]["args"]) {
      assert.equal(command, "set_taskbar_playback_state");
      reports.push(payload.isPlaying);
      return invoke(payload.isPlaying);
    },
    console: { warn: (...args: unknown[]) => warnings.push(args) },
  });
  vm.runInContext(bridge + "\ninitializeTaskbarControls();", context);
  return {
    audio, clicked, reports, warnings,
    send: (payload: unknown) => {
      if (receive === undefined) throw new Error("Taskbar listener is missing");
      return receive({ payload });
    },
    fire: (name: string, state = {}) => {
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
    app.fire(event as string, state);
  }
  await settle();
  assert.deepEqual(app.reports, [false, true, false, true, false, true, false, true, false]);
});

test("rapid reports stay ordered even while an earlier invoke is pending", async () => {
  let finish: ((value: void | PromiseLike<void>) => void) | undefined;
  const app = setup((playing: boolean) => playing ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
  await settle();
  app.fire("play", { currentSrc: "audio", paused: false });
  await settle();
  app.fire("pause", { paused: true });
  await settle();
  assert.deepEqual(app.reports, [false, true]);
  if (finish === undefined) throw new Error("Playback report resolver is missing");
  finish();
  await settle();
  assert.deepEqual(app.reports, [false, true, false]);
});

test("failed listener and command only log and do not break later reports", async () => {
  const app = setup(
    (playing: boolean) => playing ? Promise.resolve() : Promise.reject(new Error("unavailable")),
    () => Promise.reject(new Error("listener unavailable")),
  );
  await settle();
  app.fire("play", { currentSrc: "audio", paused: false });
  await settle();
  assert.deepEqual(app.reports, [false, true]);
  assert.equal(app.warnings.length, 2);
});

test("unload removes listeners even when event registration finishes late", async () => {
  let completeRegistration: (() => void) | undefined;
  const app = setup(undefined, (stop: () => Promise<void>) => new Promise<() => Promise<void>>((resolve) => {
    completeRegistration = () => resolve(stop);
  }));
  await settle();
  app.unload();
  if (completeRegistration === undefined) throw new Error("Listener registration resolver is missing");
  completeRegistration();
  await settle();
  app.send("next");
  app.fire("play", { currentSrc: "audio", paused: false });
  await settle();
  assert.equal(app.unlistened, 1);
  assert.deepEqual(app.clicked, []);
  assert.deepEqual(app.reports, [false]);
});
