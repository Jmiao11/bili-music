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

function setup({
  stored = null,
  failStorage = false,
  failSetPosition = false,
  withAnimationFrame = false,
  reducedMotion = false,
} = {}) {
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
    "#mini-notice": element(),
    "#mini-notice-more": element({ hidden: true }),
    "#mini-notice-full": element({ hidden: true }),
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
  const mediaQuery = Object.assign(new EventTarget(), { matches: reducedMotion });
  window.matchMedia = () => mediaQuery;
  const timers = new Map();
  let nextTimer = 0;
  window.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  const animationFrames = new Map();
  let nextAnimationFrame = 0;
  if (withAnimationFrame) {
    window.requestAnimationFrame = (callback) => {
      const id = ++nextAnimationFrame;
      animationFrames.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => animationFrames.delete(id);
  }
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
    animationFrames, mediaQuery, timers,
    fire: (name, payload) => listeners.get(name)?.({ payload }),
  };
}

test("mini displays and clears host notices without disabling navigation", async () => {
  const app = setup();
  await app.controller.start();
  app.fire("mini-player-state", { notice: "暂无可播放的歌曲", canPrevious: true, canNext: true });
  assert.equal(app.controls["#mini-notice"].textContent, "暂无可播放的歌曲");
  assert.equal(app.controls["#mini-notice"].hidden, false);
  assert.equal(app.controls["#mini-next"].disabled, false);
  app.fire("mini-player-state", { notice: "" });
  assert.equal(app.controls["#mini-notice"].hidden, true);
});

test("long notices offer a full-text entry, sync updates, and clear together", async () => {
  const app = setup();
  await app.controller.start();
  const long = "解析失败：上游返回 502，已重试 3 次仍未成功，队列中没有可继续播放的内容。";
  app.fire("mini-player-state", { notice: long });
  assert.equal(app.controls["#mini-notice"].textContent, long);
  assert.equal(app.controls["#mini-notice-more"].hidden, false);
  assert.equal(app.controls["#mini-notice-full"].hidden, true);
  // 点击「全文」展开完整内容
  app.controls["#mini-notice-more"].dispatchEvent(new Event("click"));
  assert.equal(app.controls["#mini-notice-full"].hidden, false);
  assert.equal(app.controls["#mini-notice-full"].textContent, long);
  assert.equal(app.controls["#mini-notice-more"].getAttribute("aria-expanded"), "true");
  // 展开期间收到新消息，全文同步为最新内容
  const next = "队列中多首无法播放，已停止。";
  app.fire("mini-player-state", { notice: next });
  assert.equal(app.controls["#mini-notice-full"].textContent, next);
  // 再次点击收起
  app.controls["#mini-notice-more"].dispatchEvent(new Event("click"));
  assert.equal(app.controls["#mini-notice-full"].hidden, true);
  assert.equal(app.controls["#mini-notice-full"].textContent, "");
  assert.equal(app.controls["#mini-notice-more"].getAttribute("aria-expanded"), "false");
  // 消息清除时三者联动隐藏
  app.controls["#mini-notice-more"].dispatchEvent(new Event("click"));
  assert.equal(app.controls["#mini-notice-full"].hidden, false);
  app.fire("mini-player-state", { notice: "" });
  assert.equal(app.controls["#mini-notice"].hidden, true);
  assert.equal(app.controls["#mini-notice-more"].hidden, true);
  assert.equal(app.controls["#mini-notice-full"].hidden, true);
  assert.equal(app.controls["#mini-notice-more"].getAttribute("aria-expanded"), "false");
});

test("full text pointer interaction does not drag; blank space still drags", async () => {
  const app = setup();
  let drags = 0;
  app.windowApi.startDragging = () => { drags++; return Promise.resolve(); };
  await app.controller.start();
  for (const protectedTarget of ["button", "#mini-notice-full", null]) {
    const event = new Event("pointerdown", { cancelable: true });
    Object.defineProperty(event, "button", { value: 0 });
    Object.defineProperty(event, "target", { value: {
      closest: selector => protectedTarget && selector.split(", ").includes(protectedTarget) ? {} : null,
    } });
    app.controls["#mini-drag-region"].dispatchEvent(event);
    assert.equal(event.defaultPrevented, protectedTarget === null);
  }
  assert.equal(drags, 1);
});

test("full text supports Escape and focus recovery when an open notice expires", async () => {
  const app = setup();
  const more = app.controls["#mini-notice-more"];
  const full = app.controls["#mini-notice-full"];
  more.focus = () => { app.document.activeElement = more; };
  app.controls["#mini-restore"].focus = () => { app.document.activeElement = app.controls["#mini-restore"]; };
  await app.controller.start();
  app.fire("mini-player-state", { notice: "错误详情" });
  more.dispatchEvent(new Event("click"));
  app.document.activeElement = full;
  full.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  assert.equal(full.hidden, true);
  assert.equal(app.document.activeElement, more);
  more.dispatchEvent(new Event("click"));
  app.document.activeElement = full;
  app.fire("mini-player-state", { notice: "" });
  assert.equal(full.hidden, true);
  assert.equal(app.document.activeElement, app.controls["#mini-restore"]);
});

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

test("playing requests bounded audio frames and ignores stale frame responses", async () => {
  const app = setup({ withAnimationFrame: true });
  await app.controller.start();
  await settle();
  app.fire("mini-player-state", {
    title: "正在播放", thumbnailUrl: "https://example.com/a.jpg",
    hasCurrent: true, isPlaying: true,
  });

  for (const tick of [...app.animationFrames.values()]) {
    tick(100);
  }
  await settle();
  assert.equal(app.emitted.at(-1).name, "mini-player-audio-sample-request");

  assert.doesNotThrow(() => app.fire("mini-player-audio-frame", null));

  app.fire("mini-player-audio-frame", {
    sequence: 2, active: true, pulse: 2, glow: 0.5,
  });
  assert.equal(app.controls["#mini-cover"].style["--audio-cover-scale"], "1.0750");
  assert.equal(app.controls["#mini-cover"].style["--audio-cover-glow-size"], "14.00px");

  app.fire("mini-player-audio-frame", {
    sequence: 1, active: true, pulse: 0, glow: 0,
  });
  assert.equal(app.controls["#mini-cover"].style["--audio-cover-scale"], "1.0750");

  app.fire("mini-player-state", { title: "正在播放", hasCurrent: true, isPlaying: false });
  assert.equal(app.controls["#mini-cover"].style["--audio-cover-scale"], "1.0000");
});

test("mini reacts to reduced-motion changes while playback is active", async () => {
  const app = setup({ withAnimationFrame: true });
  await app.controller.start();
  const baselineFrames = app.animationFrames.size;
  app.fire("mini-player-state", { hasCurrent: true, isPlaying: true });
  assert.equal(app.animationFrames.size, baselineFrames + 1);

  app.mediaQuery.matches = true;
  app.mediaQuery.dispatchEvent(new Event("change"));
  assert.equal(app.animationFrames.size, baselineFrames);
  assert.equal(app.controls["#mini-cover"].style["--audio-cover-scale"], "1.0000");

  app.mediaQuery.matches = false;
  app.mediaQuery.dispatchEvent(new Event("change"));
  assert.equal(app.animationFrames.size, baselineFrames + 1);
});

test("mini resets a stale visual frame after the host stops responding", async () => {
  const app = setup();
  await app.controller.start();
  app.fire("mini-player-audio-frame", {
    sequence: 1, active: true, pulse: 1, glow: 1,
  });
  assert.equal(app.controls["#mini-cover"].style["--audio-cover-scale"], "1.0750");
  const timer = [...app.timers.values()][0];
  assert.equal(timer.delay, 1000);
  timer.callback();
  assert.equal(app.controls["#mini-cover"].style["--audio-cover-scale"], "1.0000");
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
