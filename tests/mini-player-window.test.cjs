const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/mini.js"), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function element(extra = {}) {
  const classes = new Set();
  const attributes = {};
  return Object.assign(new EventTarget(), {
    dataset: {},
    textContent: "",
    disabled: false,
    hidden: false,
    style: { setProperty(name, value) { this[name] = value; } },
    classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
    },
    setAttribute: (name, value) => { attributes[name] = String(value); },
    removeAttribute: (name) => { delete attributes[name]; },
    getAttribute: (name) => attributes[name] ?? null,
    attributes,
    ...extra,
  });
}

function setup({ stored = null, failStorage = false, failSetPosition = false } = {}) {
  const controls = {
    "#mini-previous": element(),
    "#mini-play-pause": element(),
    "#mini-next": element(),
    "#mini-favorite": element(),
    "#mini-restore": element(),
    "#mini-drag-region": element(),
    "#mini-title": element(),
    "#mini-title-viewport": element(),
    "#mini-cover": element(),
  };
  const root = element();
  const document = Object.assign(new EventTarget(), {
    documentElement: root,
    querySelector: (selector) => controls[selector] ?? null,
  });
  const listeners = new Map();
  const emitted = [];
  const invoked = [];
  const writes = [];
  const storage = {
    getItem() {
      if (failStorage) throw new Error("blocked");
      return stored;
    },
    setItem(name, value) {
      if (failStorage) throw new Error("blocked");
      writes.push([name, value]);
    },
  };
  const eventApi = {
    listen(name, handler) {
      listeners.set(name, handler);
      return Promise.resolve(() => listeners.delete(name));
    },
    emit(name, payload) {
      emitted.push({ name, payload });
      return Promise.resolve();
    },
  };
  const windowApi = {
    startDragging: () => Promise.resolve(),
    onMoved(handler) { this.moved = handler; return Promise.resolve(() => {}); },
    outerPosition: () => Promise.resolve({ x: 410, y: 220 }),
    outerSize: () => Promise.resolve({ width: 320, height: 92 }),
    setPosition(position) {
      if (failSetPosition) return Promise.reject(new Error("blocked"));
      this.position = position;
      return Promise.resolve();
    },
  };
  const availableMonitors = () => Promise.resolve([{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }]);
  const dpi = { PhysicalPosition: class PhysicalPosition { constructor(x, y) { this.x = x; this.y = y; } } };
  const window = new EventTarget();
  const controller = vm.runInNewContext(`${source}\ncreateMiniPlayerController`, {
    EventTarget,
    Event,
    window,
    console: { warn() {} },
  })({
    eventApi,
    invoke: (command) => { invoked.push(command); return Promise.resolve(); },
    windowApi,
    availableMonitors,
    dpi,
    document,
    storage,
    window,
    console: { warn() {} },
  });
  return {
    controls, root, document, window, listeners, emitted, invoked, writes, storage, windowApi, controller,
    fire: (name, payload) => listeners.get(name)?.({ payload }),
  };
}

test("start restores a valid position, signals both handshake channels, and renders state", async () => {
  const app = setup({ stored: JSON.stringify({ x: 2500, y: 1400 }) });
  await app.controller.start();
  await settle();
  assert.deepEqual({ x: app.windowApi.position.x, y: app.windowApi.position.y }, { x: 1600, y: 988 });
  assert.deepEqual(app.emitted, [{ name: "mini-player-ready", payload: undefined }]);
  assert.deepEqual(app.invoked, ["mini_player_ready"]);

  app.fire("mini-player-state", {
    title: "正在播放", thumbnailUrl: "https://example.com/a.jpg",
    hasCurrent: true, canPrevious: false, canNext: true,
    isPlaying: true, isFavorited: true, theme: "light", accent: { r: 1, g: 2, b: 3 },
  });
  assert.equal(app.controls["#mini-title"].textContent, "正在播放");
  assert.equal(app.controls["#mini-cover"].getAttribute("src"), "https://example.com/a.jpg");
  assert.equal(app.controls["#mini-previous"].disabled, true);
  assert.equal(app.controls["#mini-next"].disabled, false);
  assert.equal(app.controls["#mini-play-pause"].dataset.playing, "true");
  assert.equal(app.controls["#mini-favorite"].classList.contains("is-favorited"), true);
  assert.equal(app.root.dataset.theme, "light");
  assert.equal(app.root.style["--accent-r"], "1");
});

test("long titles scroll by their measured overflow", async () => {
  const app = setup();
  await app.controller.start();
  await settle();
  app.controls["#mini-title-viewport"].clientWidth = 100;
  app.controls["#mini-title"].scrollWidth = 180;
  app.fire("mini-player-state", { title: "一首非常长的歌曲标题", hasCurrent: true });
  assert.equal(app.controls["#mini-title"].classList.contains("is-scrolling"), true);
  assert.equal(app.controls["#mini-title"].style["--mini-title-distance"], "-80px");
  assert.match(app.controls["#mini-title"].style["--mini-title-duration"], /^\d+(?:\.\d+)?s$/);
});

test("titles that fit do not scroll, including before the viewport has a width", async () => {
  const app = setup();
  await app.controller.start();
  await settle();
  app.controls["#mini-title"].scrollWidth = 180;
  app.fire("mini-player-state", { title: "尚未完成布局", hasCurrent: true });
  assert.equal(app.controls["#mini-title"].classList.contains("is-scrolling"), false);

  app.controls["#mini-title-viewport"].clientWidth = 200;
  app.controls["#mini-title"].scrollWidth = 160;
  app.fire("mini-player-state", { title: "短标题", hasCurrent: true });
  assert.equal(app.controls["#mini-title"].classList.contains("is-scrolling"), false);
  assert.equal(app.controls["#mini-title"].style["--mini-title-distance"], undefined);
});

test("controls emit commands, restore invokes the backend, and drag uses the native window", async () => {
  const app = setup();
  await app.controller.start();
  await settle();
  for (const [selector, action] of [
    ["#mini-previous", "previous"],
    ["#mini-play-pause", "toggle_play"],
    ["#mini-next", "next"],
    ["#mini-favorite", "toggle_favorite"],
  ]) {
    app.controls[selector].dispatchEvent(new Event("click"));
  }
  await settle();
  assert.deepEqual(app.emitted.slice(1).map(({ payload }) => payload.action), [
    "previous", "toggle_play", "next", "toggle_favorite",
  ]);
  app.controls["#mini-restore"].dispatchEvent(new Event("click"));
  await settle();
  assert.deepEqual(app.invoked, ["mini_player_ready", "exit_mini_player"]);

  app.controls["#mini-drag-region"].dispatchEvent(Object.assign(new Event("pointerdown"), { button: 0 }));
  await settle();
});

test("storage failures do not block the mini window handshake", async () => {
  const app = setup({ failStorage: true });
  await app.controller.start();
  await settle();
  app.windowApi.moved();
  await settle();
  assert.deepEqual(app.invoked, ["mini_player_ready"]);
  assert.equal(app.emitted[0].name, "mini-player-ready");
});

test("moved payload is persisted synchronously and flushed before unload", async () => {
  const app = setup();
  await app.controller.start();
  await settle();

  app.windowApi.moved({ payload: { x: 777, y: 333 } });
  assert.deepEqual(JSON.parse(app.writes.at(-1)[1]), { x: 777, y: 333 });

  app.window.dispatchEvent(new Event("beforeunload"));
  assert.deepEqual(JSON.parse(app.writes.at(-1)[1]), { x: 777, y: 333 });
});
test("position restore failures do not block the mini window handshake", async () => {
  const app = setup({ stored: JSON.stringify({ x: 410, y: 220 }), failSetPosition: true });
  await app.controller.start();
  await settle();
  assert.deepEqual(app.invoked, ["mini_player_ready"]);
  assert.equal(app.emitted[0].name, "mini-player-ready");
});
