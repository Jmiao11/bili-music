const { sourceSlice } = require("./helpers/source-slice.cjs");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/dynamic-background.js"), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const pixels = (rgb) => new Uint8ClampedArray(Array.from({ length: 1024 }, () => [...rgb, 255]).flat());

function setup(theme = "dynamic", reduced = true) {
  const tasks = new Map();
  let id = 0;
  const later = (fn, delay) => { tasks.set(++id, { fn, delay }); return id; };
  const cancel = (id) => tasks.delete(id);
  const classes = () => {
    const values = new Set();
    return {
      add: (value) => values.add(value), remove: (value) => values.delete(value),
      contains: (value) => values.has(value),
      toggle(value, on) { on ? values.add(value) : values.delete(value); },
    };
  };
  const layer = () => ({ classList: classes(), style: { setProperty(key, value) { this[key] = value; } } });
  const layers = [layer(), layer()];
  layers[0].classList.add("is-visible");
  const backdrop = { children: layers, classList: classes() };
  const immersive = { classList: classes() };
  const root = { dataset: { theme } };
  const document = Object.assign(new EventTarget(), {
    hidden: false, documentElement: root,
    querySelector: (selector) => selector === ".dynamic-background" ? backdrop : immersive,
    createElement() {
      return { getContext: () => ({
        drawImage() { if (app.tainted) throw new Error("SecurityError"); },
        getImageData: () => ({ data: app.pixels }),
      }) };
    },
  });
  const media = Object.assign(new EventTarget(), { matches: reduced });
  const window = Object.assign(new EventTarget(), {
    matchMedia: () => media, requestIdleCallback: (fn) => later(fn, "idle"), cancelIdleCallback: cancel,
  });
  const observers = [];
  const images = [];
  const context = vm.createContext({
    document, window, setTimeout: later, clearTimeout: cancel,
    Image: class { constructor() { images.push(this); } decode() { return Promise.resolve(); } },
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
  });
  const app = {
    root, document, media, images, layers, tasks, immersive, backdrop,
    pixels: pixels([230, 60, 35]), tainted: false,
    run(delay) {
      for (const [id, task] of [...tasks]) {
        if (task.delay === delay) { tasks.delete(id); task.fn(); }
      }
    },
    track(url, hasCurrent = true) {
      window.dispatchEvent(Object.assign(new Event("bilibili-music-trackchange"), { detail: { thumbnailUrl: url, hasCurrent } }));
    },
    available() { observers.forEach((fn) => fn()); },
    palette() { return layers.find((layer) => layer.classList.contains("is-visible")).style; },
    extract(data) { return plain(context.extractDynamicPalette(data)); },
  };
  vm.runInContext(source, context);
  return app;
}

test("palette keeps distinct dominant colors, bounds brightness and handles empty artwork", () => {
  const app = setup();
  const mixed = new Uint8ClampedArray([...pixels([230, 40, 20]), ...pixels([20, 220, 40]), ...pixels([30, 50, 230])]);
  const result = app.extract(mixed);
  assert.equal(new Set(result).size, 3);
  for (const color of result) {
    const channels = color.match(/\d+/g).map(Number);
    assert.ok(channels.every((value) => value >= 8 && value <= 110));
    assert.ok(Math.max(...channels) - Math.min(...channels) >= 60);
    assert.ok(Math.max(...channels) - Math.min(...channels) <= 82);
  }
  assert.deepEqual(app.extract(new Uint8ClampedArray(4096)), app.extract(pixels([255, 255, 255])));
});

test("successful extraction is deferred; CORS, image failure, timeout and empty queue silently use defaults", async () => {
  const app = setup();
  const defaultColor = app.palette()["--dynamic-color-1"];
  app.track("cover-a");
  const image = app.images.at(-1);
  assert.equal(image.crossOrigin, "anonymous");
  assert.equal(image.referrerPolicy, "no-referrer");
  await image.onload();
  assert.equal(app.palette()["--dynamic-color-1"], defaultColor);
  app.run("idle");
  assert.equal(app.palette()["--dynamic-color-1"], app.extract(app.pixels)[0]);
  app.track("tainted");
  app.tainted = true;
  await app.images.at(-1).onload();
  app.run("idle");
  assert.equal(app.palette()["--dynamic-color-1"], defaultColor);
  app.track("failed");
  app.images.at(-1).onerror();
  assert.equal(app.palette()["--dynamic-color-1"], defaultColor);
  app.track("decode-failed");
  app.images.at(-1).decode = () => Promise.reject(new Error("decode failed"));
  await app.images.at(-1).onload();
  assert.equal(app.palette()["--dynamic-color-1"], defaultColor);
  app.track("timeout");
  let decoded;
  app.images.at(-1).decode = () => new Promise((resolve) => { decoded = resolve; });
  const lateDecode = app.images.at(-1).onload();
  app.run(8000);
  decoded();
  await lateDecode;
  assert.equal(app.tasks.size, 0);
  assert.equal(app.palette()["--dynamic-color-1"], defaultColor);
  app.track("unused", false);
  assert.equal(app.palette()["--dynamic-color-1"], defaultColor);
});

test("late artwork cannot win; immersive view keeps the shared background active and hidden windows pause it", async () => {
  const app = setup("dark");
  app.track("old");
  assert.equal(app.images.length, 0);
  app.root.dataset.theme = "dynamic";
  app.available();
  const lateLoad = app.images.at(-1).onload;
  app.track("new");
  await app.images.at(-1).onload();
  app.run("idle");
  const current = app.palette()["--dynamic-color-1"];
  await lateLoad();
  assert.equal(app.tasks.size, 0);
  assert.equal(app.palette()["--dynamic-color-1"], current);
  const count = app.images.length;
  app.immersive.classList.add("is-open");
  app.available();
  assert.equal(app.images.length, count);
  assert.equal(app.palette()["--dynamic-color-1"], current);
  assert.ok(!app.backdrop.classList.contains("is-paused"));
  app.track("while-immersive");
  assert.equal(app.images.length, count + 1);
  app.pixels = pixels([30, 200, 50]);
  await app.images.at(-1).onload();
  app.run("idle");
  assert.equal(app.palette()["--dynamic-color-1"], app.extract(app.pixels)[0]);
  app.immersive.classList.remove("is-open");
  app.available();
  assert.equal(app.images.length, count + 1);
  app.document.hidden = true;
  app.document.dispatchEvent(new Event("visibilitychange"));
  assert.ok(app.backdrop.classList.contains("is-paused"));
  app.track("while-hidden");
  assert.equal(app.images.length, count + 1);
  app.document.hidden = false;
  app.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(app.images.length, count + 2);
});

test("crossfade keeps only latest pending palette; reduced motion removes fade work", async () => {
  const app = setup("dynamic", false);
  app.run(2500);
  app.track("red");
  await app.images.at(-1).onload();
  app.run("idle");
  app.track("green");
  app.pixels = pixels([30, 200, 50]);
  await app.images.at(-1).onload();
  app.run("idle");
  app.track("blue");
  app.pixels = pixels([30, 40, 210]);
  await app.images.at(-1).onload();
  app.run("idle");
  app.run(2500);
  assert.equal(app.palette()["--dynamic-color-1"], app.extract(app.pixels)[0]);
  app.media.matches = true;
  app.media.dispatchEvent(new Event("change"));
  assert.equal(app.tasks.size, 0);
});

test("dynamic texture stays fixed; image retains three controls and ignores legacy content settings", async (t) => {
  const appearance = readFileSync(path.join(__dirname, "../ui/appearance.js"), "utf8");
  const code = sourceSlice(appearance, "ui/appearance.js", "const BACKGROUND_PATH_KEY", "const root =")
    + sourceSlice(appearance, "ui/appearance.js", "function clampNumber(", "function streamSourceLabel(")
    + sourceSlice(appearance, "ui/appearance.js", "function applyTheme(", "function applyBackground(");
  const stored = new Map([
    ["bilibili-music.content-alpha", "75"],
    ...["glass-blur", "panel-alpha", "content-alpha", "background-dim"]
      .map((key) => [`bilibili-music.${key}.dynamic`, "80"]),
  ]);
  const reads = [];
  function load() {
    const root = { dataset: {}, style: {
      setProperty(key, value) { this[key] = value; },
      removeProperty(key) { delete this[key]; },
    } };
    const imageOnlyGroups = ["image-settings", "texture-settings"].map((id) => ({
      id, classList: { toggle(name, disabled) { this.disabled = disabled; } },
    }));
    const context = vm.createContext({
      root, themeOptions: [], imageOnlyGroups,
      glassBlurSlider: {}, glassBlurValue: {}, panelAlphaSlider: {}, panelAlphaValue: {},
      backgroundDimSlider: {}, backgroundDimValue: {},
      localStorage: {
        getItem(key) { reads.push(key); return stored.get(key) ?? null; },
        setItem: (key, value) => stored.set(key, value),
      },
    });
    vm.runInContext(code, context);
    return context;
  }
  const context = load();
  const values = (app) => [app.glassBlurSlider.value, app.panelAlphaSlider.value, app.backgroundDimSlider.value];
  context.applyTheme("image", false);
  assert.deepEqual(values(context), ["40", "72", "90"]);
  assert.equal(context.panelAlphaSlider.min, "20");
  assert.equal(context.backgroundDimSlider.min, "40");
  assert.ok(context.imageOnlyGroups.every((group) => !group.classList.disabled));
  context.setGlassBlur(53);
  context.setPanelAlpha(25);
  context.setBackgroundDim(45);
  const legacySettings = [...stored];
  reads.length = 0;
  context.applyTheme("dynamic", false);
  assert.equal(reads.length, 0);
  assert.deepEqual([...stored], legacySettings);
  assert.deepEqual(values(context), ["53", "25", "45"]);
  assert.equal(context.panelAlphaSlider.min, "20");
  assert.equal(context.backgroundDimSlider.min, "40");
  assert.ok(context.imageOnlyGroups[0].classList.disabled);
  assert.ok(context.imageOnlyGroups[1].classList.disabled);
  const defaults = { "--glass-blur": "0px", "--panel-alpha": "0.2", "--background-dim": "0", "--content-panel-alpha": "0" };
  const css = readFileSync(path.join(__dirname, "../ui/styles.css"), "utf8");
  const dynamicRule = css.match(/:root\[data-theme="dynamic"\] \{([^}]+)\}/)[1];
  for (const [property, value] of Object.entries(defaults)) {
    assert.equal(context.root.style[property], undefined);
    assert.equal(dynamicRule.match(new RegExp(`${property}:\\s*([^;]+);`))[1], value);
  }
  assert.ok(dynamicRule.includes("clamp(0, calc((0.72 - var(--panel-alpha)) * 1.5), 0.78)"));
  assert.ok(dynamicRule.includes("text-shadow: 0 1px 2px rgba(0, 0, 0, var(--dynamic-text-shadow-alpha))"));
  assert.equal(Math.min(0.78, Math.max(0, (0.72 - Number(defaults["--panel-alpha"])) * 1.5)), 0.78);
  // 旧动态值不再读取；切换主题不会修改背景图保留的三个保存值。
  stored.set("bilibili-music.glass-blur.dynamic", "8");
  context.applyTheme("dynamic", false);
  assert.equal(context.root.style["--glass-blur"], undefined);
  for (const [key, value] of legacySettings.filter(([key]) => !key.endsWith(".dynamic"))) assert.equal(stored.get(key), value);
  context.applyTheme("image", false);
  assert.deepEqual(values(context), ["53", "25", "45"]);
  assert.equal(context.panelAlphaSlider.min, "20");
  assert.equal(context.backgroundDimSlider.min, "40");

  const restarted = load();
  reads.length = 0;
  restarted.applyTheme("dynamic", false);
  for (const property of Object.keys(defaults)) assert.equal(restarted.root.style[property], undefined);
  assert.equal(reads.length, 0);
  for (const key of ["glass-blur", "panel-alpha", "content-alpha", "background-dim"]) {
    stored.set(`bilibili-music.${key}.dynamic`, "invalid");
  }
  restarted.applyTheme("dynamic", false);
  for (const property of Object.keys(defaults)) assert.equal(restarted.root.style[property], undefined);
  assert.equal(reads.length, 0);
  restarted.applyTheme("image", false);
  assert.deepEqual(values(restarted), ["53", "25", "45"]);
  for (const theme of ["dark", "light", "image", "dynamic", "unknown", null]) {
    context.applyTheme(theme);
    assert.equal(context.root.dataset.theme, ["dark", "light", "image", "dynamic"].includes(theme) ? theme : "dark");
    assert.equal(stored.get("bilibili-music.theme"), context.root.dataset.theme);
    if (theme !== "image") {
      assert.ok(context.imageOnlyGroups.every((group) => group.classList.disabled));
    }
  }

  // 从实际 CSS 提取固定值及增量；背景图滑块与旧动态保存值不能改变沉浸页。
  const sheetRule = css.match(/:root\[data-theme="dynamic"\] \.immersive-sheet \{([^}]+)\}/)[1];
  const alphaFormula = sheetRule.match(/background:\s*rgba\(22, 24, 28, min\(([\d.]+), calc\(var\(--panel-alpha\) \+ ([\d.]+)\)\)\);/);
  const blurFormula = sheetRule.match(/backdrop-filter:\s*blur\(min\((\d+)px, calc\(var\(--glass-blur\) \+ (\d+)px\)\)\);/);
  assert.ok(alphaFormula);
  assert.ok(blurFormula);
  assert.ok(sheetRule.includes(`-webkit-${blurFormula[0]}`));
  assert.ok(dynamicRule.includes("--panel: rgba(22, 24, 28, var(--panel-alpha));"));
  assert.match(css, /:root\[data-theme="dynamic"\] \.panel \{[^}]*backdrop-filter: blur\(var\(--glass-blur\)\);/);
  for (const [name, blur, alpha, expected] of [
    ["fixed defaults keep main 0px / 20% and immersive 32px / 55%", 0, 20, [0, 0.2, 32, 0.55]],
    ["intermediate saved values cannot change dynamic fixed parameters", 24, 50, [0, 0.2, 32, 0.55]],
    ["previous immersive thresholds cannot change dynamic fixed parameters", 48, 65, [0, 0.2, 32, 0.55]],
    ["maximum saved values cannot change dynamic fixed parameters", 80, 100, [0, 0.2, 32, 0.55]],
  ]) {
    await t.test(name, () => {
      const app = load();
      app.applyTheme("image", false);
      app.setGlassBlur(blur, false);
      app.setPanelAlpha(alpha, false);
      stored.set("bilibili-music.glass-blur.dynamic", String(blur));
      stored.set("bilibili-music.panel-alpha.dynamic", String(alpha));
      app.applyTheme("dynamic", false);
      for (const property of Object.keys(defaults)) assert.equal(app.root.style[property], undefined);
      const mainBlur = parseFloat(dynamicRule.match(/--glass-blur:\s*([^;]+);/)[1]);
      const mainAlpha = Number(dynamicRule.match(/--panel-alpha:\s*([^;]+);/)[1]);
      assert.deepEqual([
        mainBlur, mainAlpha,
        Math.min(Number(blurFormula[1]), mainBlur + Number(blurFormula[2])),
        Math.min(Number(alphaFormula[1]), mainAlpha + Number(alphaFormula[2])),
      ], expected);
    });
  }

  await t.test("content backgrounds stay transparent and obsolete controls and storage code are removed", () => {
    const html = readFileSync(path.join(__dirname, "../ui/index.html"), "utf8");
    assert.doesNotMatch(html, /content-alpha-(?:slider|value)/);
    assert.doesNotMatch(appearance, /CONTENT_ALPHA_KEY|contentAlpha|setContentAlpha|textureStorageKey|\.dynamic/);
    assert.doesNotMatch(appearance, /--content-panel-alpha|bilibili-music\.content-alpha/);
    const imageRule = css.match(/:root\[data-theme="image"\] \{([^}]+)\}/)[1];
    assert.match(imageRule, /--content-panel-alpha:\s*0;/);
    assert.equal(context.root.style["--content-panel-alpha"], undefined);
    assert.equal(stored.get("bilibili-music.content-alpha"), "75");
    assert.ok(!reads.some((key) => key.includes("content-alpha") || key.endsWith(".dynamic")));
    for (const [id, min, max, value] of [
      ["glass-blur", 0, 80, 40], ["panel-alpha", 20, 100, 72], ["background-dim", 40, 95, 90],
    ]) assert.ok(html.includes(`id="${id}-slider" type="range" min="${min}" max="${max}" value="${value}"`));
    const contentRules = [...css.matchAll(/([^{}]+)\{[^{}]*background: rgba\(\d+, \d+, \d+, var\(--content-panel-alpha, 0\)\);[^{}]*\}/g)];
    assert.equal(contentRules.length, 4);
    assert.equal(contentRules.reduce((count, match) => count + match[1].split(",").length, 0), 16);
    for (const match of contentRules) assert.match(match[1], /:root\[data-theme="(?:image|dynamic)"\]/);
  });

  await t.test("image controls retain original bounds, invalid-value defaults and storage keys", () => {
    const app = load();
    app.applyTheme("image", false);
    for (const [input, expected] of [
      [-1, ["0", "20", "40"]], [120, ["80", "100", "95"]], ["invalid", ["40", "72", "90"]],
    ]) {
      app.setGlassBlur(input);
      app.setPanelAlpha(input);
      app.setBackgroundDim(input);
      assert.deepEqual(values(app), expected);
      ["glass-blur", "panel-alpha", "background-dim"].forEach((key, index) =>
        assert.equal(stored.get(`bilibili-music.${key}`), expected[index]));
    }
  });
});
