const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const { readFileSync }: import("./helpers/module-syntax.cts").Contract = require("./helpers/module-syntax.cts");
const path: typeof import("node:path") = require("node:path");
const { test }: typeof import("node:test") = require("node:test");
const vm: typeof import("node:vm") = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/mini-player-host.ts"), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

type MockElement = EventTarget & { dataset: Record<string, string | undefined>; textContent: string; disabled: boolean; click?: () => unknown; classList: { add(name: string): unknown; contains(name: string): boolean; remove(name: string): unknown; toggle(name: string, force: boolean): unknown } };
function element(): MockElement;
function element<Extra extends object>(extra: Extra): MockElement & Extra;
function element(extra: object = {}): MockElement {
  const classes = new Set();
  return Object.assign(new EventTarget(), {
    dataset: {},
    textContent: "",
    disabled: false,
    classList: {
      add: (name: string) => classes.add(name),
      contains: (name: string) => classes.has(name),
      remove: (name: string) => classes.delete(name),
      toggle: (name: string, force: boolean) => force ? classes.add(name) : classes.delete(name),
    },
    ...extra,
  });
}

function setup() {
  const audio = element({ currentSrc: "", paused: true, ended: false, error: null });
  const root = element({ dataset: { theme: "dark" }, style: { getPropertyValue(name: string) {
    return ({ "--accent-r": "251", "--accent-g": "114", "--accent-b": "153" } as Record<string, string>)[name] ?? "";
  } } });
  const controls: Record<string, MockElement> = {
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
    querySelector: (selector: string) => controls[selector] ?? null,
  });
  const window = new EventTarget();
  const listeners = new Map();
  const emitted: { label: string; name: string; payload: MiniPlayerStatePayload }[] = [];
  const invoked: string[] = [];
  const timers = new Map();
  let nextTimer = 0;
  const eventApi = {
    listen(name: string, handler: (...args: unknown[]) => unknown) {
      listeners.set(name, handler);
      return Promise.resolve(() => listeners.delete(name));
    },
    emitTo(label: string, name: string, payload: MiniPlayerStatePayload) {
      emitted.push({ label, name, payload });
      return Promise.resolve();
    },
  };
  const invoke = (command: string) => {
    invoked.push(command);
    return Promise.resolve();
  };
  const setTimeoutFn = (handler: (...args: unknown[]) => unknown, delay: number) => {
    const id = ++nextTimer;
    timers.set(id, { handler, delay });
    return id;
  };
  const clearTimeoutFn: (id: number) => boolean = (id) => timers.delete(id);
  const host = vm.runInNewContext(`${source}\ncreateMiniPlayerHost`, {
    window,
    document,
    EventTarget,
    Event,
    CustomEvent: class CustomEvent extends Event {
      declare detail: unknown;
      constructor(type: string, options: { detail?: unknown } = {}) { super(type); this.detail = options.detail; }
    },
    console: { warn() {}, error() {} },
  })({
    eventApi,
    invoke,
    document,
    window,
    setTimeoutFn,
    clearTimeoutFn,
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
    fire: (name: string, payload = {}) => listeners.get(name)?.({ payload }),
  };
}

test("ready publishes the current track and the four commands click existing controls", async () => {
  const app = setup();
  await settle();

  const clicked: string[] = [];
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
  const emission1 = app.emitted.at(-1);
  if (emission1 === undefined) throw new Error("Mini player state emission is missing");
  assert.equal(emission1.label, "mini");
  const emission2 = app.emitted.at(-1);
  if (emission2 === undefined) throw new Error("Mini player state emission is missing");
  assert.equal(emission2.name, "mini-player-state");
  const emission3 = app.emitted.at(-1);
  if (emission3 === undefined) throw new Error("Mini player state emission is missing");
  assert.deepEqual(JSON.parse(JSON.stringify(emission3.payload)), {
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
  const emission4 = app.emitted.at(-1);
  if (emission4 === undefined) throw new Error("Mini player state emission is missing");
  assert.equal(emission4.payload.notice, "已经是第一首了");
  app.controls["#playback-notice"].textContent = "";
  app.window.dispatchEvent(new Event("bilibili-music-notice-change"));
  const emission5 = app.emitted.at(-1);
  if (emission5 === undefined) throw new Error("Mini player state emission is missing");
  assert.equal(emission5.payload.notice, "");
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
  assert.equal(app.listeners.size, 2);

  app.window.dispatchEvent(new Event("beforeunload"));
  await settle();
  assert.equal(app.listeners.size, 0);
});
