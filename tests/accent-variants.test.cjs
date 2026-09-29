const { sourceSlice } = require("./helpers/source-slice.cjs");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/appearance.js"), "utf8");
const code = sourceSlice(source, "ui/appearance.js", "const BACKGROUND_PATH_KEY", "const root =")
  + sourceSlice(source, "ui/appearance.js", "function clampNumber(", "function streamSourceLabel(")
  + sourceSlice(source, "ui/appearance.js", "function normalizeAccentColor(", "function applyBackground(");
const expected = {
  pink: { dark: [251, 114, 153], light: [164, 41, 76] },
  blue: { dark: [122, 166, 231], light: [40, 88, 161] },
  purple: { dark: [189, 145, 236], light: [120, 48, 194] },
  green: { dark: [87, 185, 65], light: [40, 102, 25] },
  orange: { dark: [224, 146, 77], light: [128, 77, 32] },
  cyan: { dark: [73, 178, 191], light: [27, 98, 106] },
};
const colorKey = "bilibili-music.accent-color";

function setup(color = "pink", failWrites = false) {
  let notify;
  const stored = new Map([[colorKey, color]]);
  const writes = [];
  const root = {
    dataset: new Proxy({ theme: "dark" }, { set(target, key, value) {
      target[key] = value;
      if (key === "theme") queueMicrotask(() => notify?.());
      return true;
    } }),
    style: {
      "--dynamic-color-1": "rgb(28, 32, 40)",
      setProperty(key, value) { this[key] = value; },
      removeProperty(key) { delete this[key]; },
    },
  };
  const options = Object.keys(expected).map(value => Object.assign(new EventTarget(), {
    value, checked: false, nextElementSibling: { style: {} },
  }));
  const app = vm.createContext({
    root, accentColorOptions: options, themeOptions: [], imageOnlyGroups: [],
    glassBlurSlider: {}, glassBlurValue: {}, panelAlphaSlider: {}, panelAlphaValue: {},
    backgroundDimSlider: {}, backgroundDimValue: {},
    MutationObserver: class {
      constructor(callback) { notify = callback; }
      observe(target, options) {
        assert.equal(target, root);
        assert.deepEqual(JSON.parse(JSON.stringify(options)), { attributes: true, attributeFilter: ["data-theme"] });
      }
    },
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) {
        if (failWrites) throw Error("Unavailable");
        writes.push([key, value]); stored.set(key, value);
      },
    },
  });
  vm.runInContext(code, app);
  app.initializeAccentColor();
  return { app, root, stored, writes, options };
}

function check(state, color, theme) {
  const variant = theme === "light" ? "light" : "dark";
  assert.deepEqual(["r", "g", "b"].map(c => Number(state.root.style[`--accent-${c}`])), expected[color][variant]);
  assert.deepEqual(state.options.filter(o => o.checked).map(o => o.value), [color]);
  for (const option of state.options) {
    assert.equal(option.nextElementSibling.style.backgroundColor, `rgb(${expected[option.value][variant].join(", ")})`);
  }
}

test("six names map to exact RGB variants in all four themes with safe fallbacks", () => {
  const { app } = setup();
  for (const [name, pair] of Object.entries(expected)) {
    for (const theme of ["dark", "light", "image", "dynamic", null, "unknown"]) {
      assert.deepEqual(Array.from(app.accentChannels(name, theme)), pair[theme === "light" ? "light" : "dark"]);
    }
  }
  for (const value of [null, "unknown", "__proto__"]) {
    assert.deepEqual(Array.from(app.accentChannels(value, "light")), expected.pink.light);
    assert.deepEqual(Array.from(app.accentChannels(value, "dark")), expected.pink.dark);
  }
});

test("twelve actual variants meet contrast targets and pairs preserve hue within one degree", () => {
  const { app } = setup();
  const luminance = rgb => rgb.map(v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const mix = (a, b, alpha) => a.map((v, i) => v * alpha + b[i] * (1 - alpha));
  // Reuse the existing RGB/HSL implementation without initializing the background.
  const dynamic = readFileSync(path.join(__dirname, "../ui/dynamic-background.js"), "utf8");
  vm.runInContext(sourceSlice(dynamic, "ui/dynamic-background.js", null, "function initializeDynamicBackground"), app);
  for (const name of Object.keys(expected)) {
    const dark = Array.from(app.accentChannels(name, "dark"));
    const light = Array.from(app.accentChannels(name, "light"));
    assert.ok(app.hueDistance(app.rgbToHsl(dark)[0], app.rgbToHsl(light)[0]) < 1, name);
    for (const [color, base, overlay, alpha] of [
      [dark, [28, 28, 30], [255, 255, 255], 0.024],
      [light, [242, 242, 244], [0, 0, 0], 0.025],
    ]) {
      assert.ok(contrast(color, base) >= 4.5, name);
      for (const panel of [base, mix(overlay, base, alpha)]) {
        assert.ok(contrast(color, mix(color, mix(color, panel, 0.14), 0.14)) >= 3, name);
      }
    }
  }
});

test("startup saved-light restoration and rapid theme changes update through microtasks without color writes", async () => {
  const state = setup("blue");
  state.app.applyTheme("light", false);
  await Promise.resolve();
  check(state, "blue", "light");
  state.app.applyTheme("dark", false);
  state.app.applyTheme("image", false);
  state.app.applyTheme("light", false);
  await Promise.resolve();
  check(state, "blue", "light");
  assert.deepEqual(state.writes, []);
  assert.equal(state.stored.get(colorKey), "blue");
});

test("switching themes updates selected color and all swatches without affecting dynamic palette or color storage", async () => {
  const state = setup();
  for (const name of Object.keys(expected)) {
    state.options.find(o => o.value === name).dispatchEvent(new Event("change"));
    for (const theme of ["dark", "light", "image", "dynamic"]) {
      state.app.applyTheme(theme);
      await Promise.resolve();
      check(state, name, theme);
      assert.equal(state.stored.get(colorKey), name);
      assert.equal(state.root.style["--dynamic-color-1"], "rgb(28, 32, 40)");
    }
  }
  assert.equal(state.writes.filter(([key]) => key === colorKey).length, 6);
  assert.ok(state.writes.every(([key]) => [colorKey, "bilibili-music.theme"].includes(key)));
});

test("theme variants keep the current session color even when its persistence failed", async () => {
  const state = setup("pink", true);
  state.app.applyAccentColor("purple");
  state.app.applyTheme("light", false);
  await Promise.resolve();
  check(state, "purple", "light");
  state.app.applyTheme("dynamic", false);
  await Promise.resolve();
  check(state, "purple", "dynamic");
  assert.equal(state.stored.get(colorKey), "pink");
});
