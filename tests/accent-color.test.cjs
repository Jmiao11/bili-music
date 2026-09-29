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
const key = "bilibili-music.accent-color";
const colors = {
  pink: { dark: [251, 114, 153], light: [164, 41, 76] },
  blue: { dark: [122, 166, 231], light: [40, 88, 161] },
  purple: { dark: [189, 145, 236], light: [120, 48, 194] },
  green: { dark: [87, 185, 65], light: [40, 102, 25] },
  orange: { dark: [224, 146, 77], light: [128, 77, 32] },
  cyan: { dark: [73, 178, 191], light: [27, 98, 106] },
};

function setup(stored = new Map(), faults = {}) {
  const writes = [];
  const root = { dataset: { theme: "dynamic" }, style: {
    "--dynamic-color-1": "rgb(28, 32, 40)",
    setProperty(name, value) { this[name] = value; },
    removeProperty(name) { delete this[name]; },
  } };
  const options = Object.keys(colors).map((value) => Object.assign(new EventTarget(), {
    value, checked: false, nextElementSibling: { style: {} },
  }));
  const app = vm.createContext({
    MutationObserver: class { observe() {} },
    root, accentColorOptions: options, themeOptions: [], imageOnlyGroups: [],
    glassBlurSlider: {}, glassBlurValue: {}, panelAlphaSlider: {}, panelAlphaValue: {},
    backgroundDimSlider: {}, backgroundDimValue: {},
    localStorage: {
      getItem(name) { if (faults.read) throw Error("Unavailable"); return stored.get(name) ?? null; },
      setItem(name, value) {
        if (faults.write) throw Error("Unavailable");
        writes.push([name, value]);
        stored.set(name, value);
      },
    },
  });
  vm.runInContext(code, app);
  app.initializeAccentColor();
  return { app, root, options, stored, writes };
}

function expectColor(state, color) {
  assert.deepEqual(["r", "g", "b"].map((channel) => Number(state.root.style[`--accent-${channel}`])), colors[color][state.root.dataset.theme === "light" ? "light" : "dark"]);
  assert.deepEqual(state.options.filter((option) => option.checked).map((option) => option.value), [color]);
}

test("missing legacy preference restores exact default pink without writing storage", () => {
  const state = setup(new Map([["bilibili-music.theme", "dynamic"]]));
  expectColor(state, "pink");
  assert.equal(state.app.readAccentColor(), "pink");
  assert.deepEqual(state.writes, []);
  assert.equal(state.root.dataset.theme, "dynamic");
  assert.equal(state.stored.has(key), false);
});

test("all six saved presets restore channels, selection and swatches without rewriting storage", () => {
  for (const color of Object.keys(colors)) {
    const state = setup(new Map([[key, color]]));
    expectColor(state, color);
    assert.equal(state.app.readAccentColor(), color);
    assert.deepEqual(state.writes, []);
    for (const option of state.options) {
      assert.equal(option.nextElementSibling.style.backgroundColor, `rgb(${colors[option.value][state.root.dataset.theme === "light" ? "light" : "dark"].join(", ")})`);
    }
  }
});

test("unknown, malformed and inherited property names in storage fall back to pink", () => {
  for (const value of [null, "", "unknown", "BLUE", " blue ", "#fb7299", "null", "42", "{}", "[1,2,3]", "__proto__", "constructor", "toString"]) {
    const state = setup(new Map([[key, value]]));
    expectColor(state, "pink");
    assert.equal(state.app.readAccentColor(), "pink");
    assert.deepEqual(state.writes, []);
  }
});

test("non-string values fall back without coercion or throwing", () => {
  const state = setup();
  for (const value of [undefined, null, 0, true, [], {}, Symbol("blue"), { toString() { throw Error("Do not coerce"); } }]) {
    state.app.applyAccentColor(value, false);
    expectColor(state, "pink");
  }
  assert.deepEqual(state.writes, []);
});

test("storage read errors safely restore pink", () => {
  const state = setup(new Map(), { read: true });
  expectColor(state, "pink");
  assert.equal(state.app.readAccentColor(), "pink");
  assert.deepEqual(state.writes, []);
});

test("radio changes persist only the color key and survive restart, including a return to pink", () => {
  const state = setup(new Map([["bilibili-music.theme", "image"], ["bilibili-music.background-path", "saved.png"]]));
  for (const color of ["blue", "purple", "green", "orange", "cyan", "pink"]) {
    state.options.find((option) => option.value === color).dispatchEvent(new Event("change"));
    expectColor(state, color);
    assert.equal(state.stored.get(key), color);
    expectColor(setup(state.stored), color);
  }
  assert.ok(state.writes.every(([name]) => name === key));
  assert.equal(state.stored.get("bilibili-music.theme"), "image");
  assert.equal(state.stored.get("bilibili-music.background-path"), "saved.png");
});

test("storage write errors preserve the session choice without throwing", () => {
  const state = setup(new Map(), { write: true });
  state.options.find((option) => option.value === "cyan").dispatchEvent(new Event("change"));
  expectColor(state, "cyan");
  assert.equal(state.stored.has(key), false);
});

test("all 24 color and theme combinations remain independent of each other and dynamic colors", () => {
  const state = setup();
  for (const color of Object.keys(colors)) {
    for (const theme of ["dark", "light", "image", "dynamic"]) {
      state.app.applyTheme(theme);
      const before = { ...state.root.style };
      state.app.applyAccentColor(color);
      assert.equal(state.root.dataset.theme, theme);
      assert.equal(state.stored.get("bilibili-music.theme"), theme);
      for (const [name, value] of Object.entries(before)) {
        if (!["--accent-r", "--accent-g", "--accent-b"].includes(name)) assert.equal(state.root.style[name], value);
      }
      state.app.applyTheme(theme);
      expectColor(state, color);
      assert.equal(state.stored.get(key), color);
      assert.equal(state.root.style["--dynamic-color-1"], "rgb(28, 32, 40)");
    }
  }
});

test("picker uses six named native radios in the existing disclosure before AI settings", () => {
  const html = readFileSync(path.join(__dirname, "../ui/index.html"), "utf8");
  const block = html.match(/<details id="accent-color-settings" class="setting-group collapsible-group">([\s\S]*?)<\/details>/)[1];
  const values = [...block.matchAll(/type="radio" name="accent-color" value="([^"]+)" data-accent-color/g)].map((match) => match[1]);
  assert.deepEqual(values, Object.keys(colors));
  assert.equal((block.match(/ checked/g) || []).length, 1);
  assert.ok(block.includes('value="pink" data-accent-color checked'));
  assert.match(block, /class="theme-row" role="radiogroup" aria-label="主题色"/);
  for (const name of ["粉", "蓝", "紫", "绿", "橙", "青"]) assert.ok(block.includes(`<span>${name}</span>`));
  assert.ok(html.indexOf('id="accent-color-settings"') < html.indexOf('class="setting-group ai-settings collapsible-group"'));
  assert.match(source, /^initializeAccentColor\(\);$/m);
});
