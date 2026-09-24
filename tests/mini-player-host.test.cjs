const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/mini-player-host.js"), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function element(extra = {}) {
  const classes = new Set();
  return Object.assign(new EventTarget(), {
    dataset: {},
    textContent: "",
    disabled: false,
    classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
    },
    ...extra,
  });
}

function setup() {
  const audio = element({ currentSrc: "", paused: true, ended: false, error: null });
  const root = element({ dataset: { theme: "dark" }, style: { getPropertyValue(name) {
    return { "--accent-r": "251", "--accent-g": "114", "--accent-b": "153" }[name] ?? "";
  } } });
  const controls = {
    "#mini-player-button": element(),
    "#previous-button": element(),
    "#play-pause-button": element({ dataset: { playing: "false" } }),
    "#next-button": element(),
    "#favorite-current-button": element(),
    "#title": element({ textContent: "测试歌曲" }),
    "#uploader": element({ textContent: "测试 UP" }),
    "#thumbnail": element({ getAttribute: () => "https://example.com/cover.jpg" }),
    "#status": element({ textContent: "在线播放中。" }),
    "#playback-notice": element(),
    "#audio": audio,
  };
  const document = Object.assign(new EventTarget(), {
    documentElement: root,
    querySelector: (selector) => controls[selector] ?? null,
  });
  const window = new EventTarget();
  const listeners = new Map();
  const emitted = [];
  const invoked = [];
  const timers = new Map();
  let nextTimer = 0;
  const eventApi = {
    listen(name, handler) {
      listeners.set(name, handler);
      return Promise.resolve(() => listeners.delete(name));
    },
    emitTo(label, name, payload) {
      emitted.push({ label, name, payload });
      return Promise.resolve();
    },
  };
  const invoke = (command) => {
    invoked.push(command);
    return Promise.resolve();
  };
  const setTimeoutFn = (handler, delay) => {
    const id = ++nextTimer;
    timers.set(id, { handler, delay });
    return id;
  };
  const clearTimeoutFn = (id) => timers.delete(id);
  const audioReactive = {
    sequence: 0,
    sample() {
      this.sequence += 1;
      return { sequence: this.sequence, active: true, pulse: 0.5, glow: 0.25 };
    },
  };
  const host = vm.runInNewContext(`${source}\ncreateMiniPlayerHost`, {
    window,
    document,
    EventTarget,
    Event,
    CustomEvent: class CustomEvent extends Event {
      constructor(type, options = {}) { super(type); this.detail = options.detail; }
    },
    console: { warn() {}, error() {} },
  })({
    eventApi,
    invoke,
    document,
    window,
    setTimeoutFn,
    clearTimeoutFn,
    audioReactive,
    console: { warn() {}, error() {} },
  });
  host.start();
  return {
    controls,
    audio,
    document,
    window,
    listeners,
    emitted,
    invoked,
    timers,
    host,
    audioReactive,
    fire: (name, payload = {}) => listeners.get(name)?.({ payload }),
  };
}

test("ready publishes the current track and the four commands click existing controls", async () => {
  const app = setup();
  await settle();

  const clicked = [];
  for (const [selector, action] of [
    ["#previous-button", "previous"],
    ["#play-pause-button", "toggle_play"],
    ["#next-button", "next"],
    ["#favorite-current-button", "toggle_favorite"],
  ]) {
    app.controls[selector].click = () => clicked.push(action);
  }

  app.fire("mini-player-ready");
  await settle();
  assert.equal(app.emitted.at(-1).label, "mini");
  assert.equal(app.emitted.at(-1).name, "mini-player-state");
  assert.deepEqual(JSON.parse(JSON.stringify(app.emitted.at(-1).payload)), {
    title: "测试歌曲",
    uploader: "测试 UP",
    thumbnailUrl: "https://example.com/cover.jpg",
    status: "在线播放中。",
    notice: "",
    hasCurrent: true,
    canPrevious: true,
    canNext: true,
    isPlaying: false,
    isFavorited: false,
    theme: "dark",
    accent: { r: 251, g: 114, b: 153 },
  });

  for (const action of ["previous", "toggle_play", "next", "toggle_favorite", "unknown"]) {
    app.fire("mini-player-command", { action });
  }
  assert.deepEqual(clicked, ["previous", "toggle_play", "next", "toggle_favorite"]);
});

test("notices synchronize on ready, change and expiration", async () => {
  const app = setup();
  await settle();
  app.controls["#playback-notice"].textContent = "已经是第一首了";
  app.window.dispatchEvent(new Event("bilibili-music-notice-change"));
  assert.equal(app.emitted.length, 0);
  app.fire("mini-player-ready");
  assert.equal(app.emitted.at(-1).payload.notice, "已经是第一首了");
  app.controls["#playback-notice"].textContent = "";
  app.window.dispatchEvent(new Event("bilibili-music-notice-change"));
  assert.equal(app.emitted.at(-1).payload.notice, "");
});

test("playback and track events republish state only after mini is ready", async () => {
  const app = setup();
  await settle();
  app.audio.dispatchEvent(new Event("play"));
  assert.equal(app.emitted.length, 0);

  app.fire("mini-player-ready");
  await settle();
  const before = app.emitted.length;
  app.audio.dispatchEvent(new Event("play"));
  app.window.dispatchEvent(new Event("bilibili-music-trackchange"));
  app.window.dispatchEvent(new Event("bilibili-music-favorite-change"));
  await settle();
  assert.equal(app.emitted.length, before + 3);
});

test("audio frame requests sample the shared analyser only while mini is ready", async () => {
  const app = setup();
  await settle();
  app.fire("mini-player-audio-sample-request");
  await settle();
  assert.equal(app.audioReactive.sequence, 0);

  app.fire("mini-player-ready");
  await settle();
  app.fire("mini-player-audio-sample-request");
  await settle();

  assert.equal(app.audioReactive.sequence, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(app.emitted.at(-1))), {
    label: "mini",
    name: "mini-player-audio-frame",
    payload: { sequence: 1, active: true, pulse: 0.5, glow: 0.25 },
  });
});

test("missing ready returns to the main window and reports the failure", async () => {
  const app = setup();
  await settle();
  app.controls["#mini-player-button"].dispatchEvent(new Event("click"));
  await settle();
  assert.deepEqual(app.invoked, ["open_mini_player"]);
  assert.equal(app.timers.size, 1);
  const timer = [...app.timers.values()][0];
  assert.equal(timer.delay, 5000);
  await timer.handler();
  await settle();
  assert.deepEqual(app.invoked, ["open_mini_player", "exit_mini_player"]);
  assert.match(app.controls["#status"].textContent, /迷你播放器/);
});

test("beforeunload unsubscribes Tauri listeners without throwing", async () => {
  const app = setup();
  await settle();
  assert.equal(app.listeners.size, 3);

  app.window.dispatchEvent(new Event("beforeunload"));
  await settle();
  assert.equal(app.listeners.size, 0);
});
