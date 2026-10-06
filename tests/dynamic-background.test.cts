const { sourceSlice }: import("./helpers/source-slice.cts").Contract = require("./helpers/source-slice.cts");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const { readFileSync }: import("./helpers/module-syntax.cts").Contract = require("./helpers/module-syntax.cts");
const path: typeof import("node:path") = require("node:path");
const { test }: typeof import("node:test") = require("node:test");
const vm: typeof import("node:vm") = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/dynamic-background.ts"), "utf8");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const pixels = (rgb: number[]) => new Uint8ClampedArray(Array.from({ length: 1024 }, () => [...rgb, 255]).flat());

function setup(theme = "dynamic", reduced = true) {
  const tasks = new Map<number, { fn: () => void; delay: number | "idle" }>();
  let id = 0;
  const later = (fn: () => void, delay: number | "idle") => { tasks.set(++id, { fn, delay }); return id; };
  const cancel: (id: number) => boolean = (id) => tasks.delete(id);
  const classes = () => {
    const values = new Set();
    return {
      add: (value: unknown) => values.add(value), remove: (value: unknown) => values.delete(value),
      contains: (value: unknown) => values.has(value),
      toggle(value: unknown, on: boolean) { on ? values.add(value) : values.delete(value); },
    };
  };
  const layer: () => { classList: ReturnType<typeof classes>; style: Record<string, unknown> } = () => ({ classList: classes(), style: { setProperty(this: Record<string, unknown>, key: string, value: unknown) { this[key] = value; } } });
  const layers = [layer(), layer()];
  layers[0].classList.add("is-visible");
  const backdrop = { children: layers, classList: classes() };
  const immersive = { classList: classes() };
  const root = { dataset: { theme } };
  const document = Object.assign(new EventTarget(), {
    hidden: false, documentElement: root,
    querySelector: (selector: string) => selector === ".dynamic-background" ? backdrop : immersive,
    createElement() {
      return { getContext: () => ({
        drawImage() { if (app.tainted) throw new Error("SecurityError"); },
        getImageData: () => ({ data: app.pixels }),
      }) };
    },
  });
  const media = Object.assign(new EventTarget(), { matches: reduced });
  const window = Object.assign(new EventTarget(), {
    matchMedia: () => media, requestIdleCallback: (fn: () => void) => later(fn, "idle"), cancelIdleCallback: cancel,
  });
  const observers: (() => void)[] = [];
  type MockImage = { crossOrigin?: string; referrerPolicy?: string; onload?: () => Promise<void>; onerror?: () => void; decode(): Promise<void> };
  const images: MockImage[] = [];
  const context = vm.createContext({
    document, window, setTimeout: later, clearTimeout: cancel,
    Image: class { declare crossOrigin?: string; declare referrerPolicy?: string; declare onload?: () => Promise<void>; declare onerror?: () => void; constructor() { images.push(this); } decode() { return Promise.resolve(); } },
    MutationObserver: class { constructor(fn: () => void) { observers.push(fn); } observe() {} },
  });
  const app = {
    root, document, media, images, layers, tasks, immersive, backdrop,
    pixels: pixels([230, 60, 35]), tainted: false,
    run(delay: number | "idle") {
      for (const [id, task] of [...tasks]) {
        if (task.delay === delay) { tasks.delete(id); task.fn(); }
      }
    },
    track(url: string, hasCurrent = true) {
      window.dispatchEvent(Object.assign(new Event("bilibili-music-trackchange"), { detail: { thumbnailUrl: url, hasCurrent } }));
    },
    available() { observers.forEach((fn) => fn()); },
    palette() { const visible = layers.find((layer) => layer.classList.contains("is-visible"));
      if (!visible) throw new Error("Visible palette layer is missing");
      return visible.style; },
    extract(data: unknown) { return plain(context.extractDynamicPalette(data)); },
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
    assert.ok(channels.every((value: number) => value >= 8 && value <= 110));
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
  if (!image) throw new Error("Artwork image is missing");
  assert.equal(image.crossOrigin, "anonymous");
  assert.equal(image.referrerPolicy, "no-referrer");
  if (!image.onload) throw new Error("Artwork load callback is missing");
  await image.onload();
  assert.equal(app.palette()["--dynamic-color-1"], defaultColor);
  app.run("idle");
  assert.equal(app.palette()["--dynamic-color-1"], app.extract(app.pixels)[0]);
  app.track("tainted");
  app.tainted = true;
  const artwork1 = app.images.at(-1);
  if (!artwork1) throw new Error("Artwork image is missing");
  if (!artwork1.onload) throw new Error("Artwork load callback is missing");
  await artwork1.onload();
  app.run("idle");
  assert.equal(app.palette()["--dynamic-color-1"], defaultColor);
  app.track("failed");
  const artwork2 = app.images.at(-1);
  if (!artwork2) throw new Error("Artwork image is missing");
  if (!artwork2.onerror) throw new Error("Artwork error callback is missing");
  artwork2.onerror();
  assert.equal(app.palette()["--dynamic-color-1"], defaultColor);
  app.track("decode-failed");
  const artwork3 = app.images.at(-1);
  if (!artwork3) throw new Error("Artwork image is missing");
  artwork3.decode = () => Promise.reject(new Error("decode failed"));
  const artwork4 = app.images.at(-1);
  if (!artwork4) throw new Error("Artwork image is missing");
  if (!artwork4.onload) throw new Error("Artwork load callback is missing");
  await artwork4.onload();
  assert.equal(app.palette()["--dynamic-color-1"], defaultColor);
  app.track("timeout");
  let decoded: (() => void) | undefined;
  const artwork5 = app.images.at(-1);
  if (!artwork5) throw new Error("Artwork image is missing");
  artwork5.decode = () => new Promise<void>((resolve) => { decoded = resolve; });
  const artwork6 = app.images.at(-1);
  if (!artwork6) throw new Error("Artwork image is missing");
  if (!artwork6.onload) throw new Error("Artwork load callback is missing");
  const lateDecode = artwork6.onload();
  app.run(8000);
  if (!decoded) throw new Error("Decode resolver is missing");
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
  const artwork7 = app.images.at(-1);
  if (!artwork7) throw new Error("Artwork image is missing");
  if (!artwork7.onload) throw new Error("Artwork load callback is missing");
  const lateLoad = artwork7.onload;
  app.track("new");
  const artwork8 = app.images.at(-1);
  if (!artwork8) throw new Error("Artwork image is missing");
  if (!artwork8.onload) throw new Error("Artwork load callback is missing");
  await artwork8.onload();
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
  const artwork9 = app.images.at(-1);
  if (!artwork9) throw new Error("Artwork image is missing");
  if (!artwork9.onload) throw new Error("Artwork load callback is missing");
  await artwork9.onload();
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
  const artwork10 = app.images.at(-1);
  if (!artwork10) throw new Error("Artwork image is missing");
  if (!artwork10.onload) throw new Error("Artwork load callback is missing");
  await artwork10.onload();
  app.run("idle");
  app.track("green");
  app.pixels = pixels([30, 200, 50]);
  const artwork11 = app.images.at(-1);
  if (!artwork11) throw new Error("Artwork image is missing");
  if (!artwork11.onload) throw new Error("Artwork load callback is missing");
  await artwork11.onload();
  app.run("idle");
  app.track("blue");
  app.pixels = pixels([30, 40, 210]);
  const artwork12 = app.images.at(-1);
  if (!artwork12) throw new Error("Artwork image is missing");
  if (!artwork12.onload) throw new Error("Artwork load callback is missing");
  await artwork12.onload();
  app.run("idle");
  app.run(2500);
  assert.equal(app.palette()["--dynamic-color-1"], app.extract(app.pixels)[0]);
  app.media.matches = true;
  app.media.dispatchEvent(new Event("change"));
  assert.equal(app.tasks.size, 0);
});

test("dynamic texture stays fixed; image retains three controls and ignores legacy content settings", async (t) => {
  const appearance = readFileSync(path.join(__dirname, "../ui/appearance.ts"), "utf8");
  const code = sourceSlice(appearance, "ui/appearance.ts", "const BACKGROUND_PATH_KEY", "const root =")
    + sourceSlice(appearance, "ui/appearance.ts", "function clampNumber(", "function streamSourceLabel(")
    + sourceSlice(appearance, "ui/appearance.ts", "function applyTheme(", "function applyBackground(");
  const stored = new Map<string, string>([
    ["bilibili-music.content-alpha", "75"],
    ...["glass-blur", "panel-alpha", "content-alpha", "background-dim"]
      .map<[string, string]>((key) => [`bilibili-music.${key}.dynamic`, "80"]),
  ]);
  const reads: string[] = [];
  function load() {
    const root = { dataset: {}, style: {
      setProperty(this: Record<string, unknown>, key: string, value: unknown) { this[key] = value; },
      removeProperty(this: Record<string, unknown>, key: string) { delete this[key]; },
    } };
    const imageOnlyGroups = ["image-settings", "texture-settings"].map((id) => ({
      id, classList: { toggle(this: { disabled?: boolean }, name: string, disabled: boolean) { this.disabled = disabled; } },
    }));
    const context = vm.createContext({
      root, themeOptions: [], imageOnlyGroups,
      glassBlurSlider: {}, glassBlurValue: {}, panelAlphaSlider: {}, panelAlphaValue: {},
      backgroundDimSlider: {}, backgroundDimValue: {},
      localStorage: {
        getItem(key: string) { reads.push(key); return stored.get(key) ?? null; },
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    vm.runInContext(code, context);
    return context;
  }
  const context = load();
  const values = (app: import("node:vm").Context) => [app.glassBlurSlider.value, app.panelAlphaSlider.value, app.backgroundDimSlider.value];
  context.applyTheme("image", false);
  assert.deepEqual(values(context), ["40", "72", "90"]);
  assert.equal(context.panelAlphaSlider.min, "20");
  assert.equal(context.backgroundDimSlider.min, "40");
  assert.ok(context.imageOnlyGroups.every((group: { classList: { disabled?: boolean } }) => !group.classList.disabled));
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
  const styleMatch1 = css.match(/:root\[data-theme="dynamic"\] \{([^}]+)\}/);
  if (!styleMatch1) throw new Error("Expected stylesheet rule is missing");
  const dynamicRule = styleMatch1[1];
  for (const [property, value] of Object.entries(defaults)) {
    assert.equal(context.root.style[property], undefined);
    const styleMatch2 = dynamicRule.match(new RegExp(`${property}:\\s*([^;]+);`));
    if (!styleMatch2) throw new Error("Expected stylesheet rule is missing");
    assert.equal(styleMatch2[1], value);
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
    assert.equal(context.root.dataset.theme, (["dark", "light", "image", "dynamic"] as (string | null)[]).includes(theme) ? theme : "dark");
    assert.equal(stored.get("bilibili-music.theme"), context.root.dataset.theme);
    if (theme !== "image") {
      assert.ok(context.imageOnlyGroups.every((group: { classList: { disabled?: boolean } }) => group.classList.disabled));
    }
  }

  // 从实际 CSS 提取固定值及增量；背景图滑块与旧动态保存值不能改变沉浸页。
  const styleMatch3 = css.match(/:root\[data-theme="dynamic"\] \.immersive-sheet \{([^}]+)\}/);
  if (!styleMatch3) throw new Error("Expected stylesheet rule is missing");
  const sheetRule = styleMatch3[1];
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
  ] as [string, number, number, number[]][]) {
    await t.test(name, () => {
      const app = load();
      app.applyTheme("image", false);
      app.setGlassBlur(blur, false);
      app.setPanelAlpha(alpha, false);
      stored.set("bilibili-music.glass-blur.dynamic", String(blur));
      stored.set("bilibili-music.panel-alpha.dynamic", String(alpha));
      app.applyTheme("dynamic", false);
      for (const property of Object.keys(defaults)) assert.equal(app.root.style[property], undefined);
      const styleMatch4 = dynamicRule.match(/--glass-blur:\s*([^;]+);/);
      if (!styleMatch4) throw new Error("Expected stylesheet rule is missing");
      const mainBlur = parseFloat(styleMatch4[1]);
      const styleMatch5 = dynamicRule.match(/--panel-alpha:\s*([^;]+);/);
      if (!styleMatch5) throw new Error("Expected stylesheet rule is missing");
      const mainAlpha = Number(styleMatch5[1]);
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
    const styleMatch6 = css.match(/:root\[data-theme="image"\] \{([^}]+)\}/);
    if (!styleMatch6) throw new Error("Expected stylesheet rule is missing");
    const imageRule = styleMatch6[1];
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
    ] as [number | string, string[]][]) {
      app.setGlassBlur(input);
      app.setPanelAlpha(input);
      app.setBackgroundDim(input);
      assert.deepEqual(values(app), expected);
      ["glass-blur", "panel-alpha", "background-dim"].forEach((key, index) =>
        assert.equal(stored.get(`bilibili-music.${key}`), expected[index]));
    }
  });
});
