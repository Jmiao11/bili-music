const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { sourceSlice } = require("./helpers/source-slice.cjs");

function slice(file, start, end) {
  return sourceSlice(fs.readFileSync(path.join(__dirname, "../ui", file), "utf8"), `ui/${file}`, start, end);
}

test("theme defaults preserve null, invalid values and all supported themes", () => {
  const root = { dataset: {}, style: { removeProperty() {} } };
  const writes = [];
  const context = vm.createContext({ root, themeOptions: [], imageOnlyGroups: [], THEME_KEY: "theme", GLASS_BLUR_KEY: "blur", PANEL_ALPHA_KEY: "alpha", BACKGROUND_DIM_KEY: "dim",
    localStorage: { getItem: () => null, setItem: (key, value) => writes.push([key, value]) },
    setGlassBlur() {}, setPanelAlpha() {}, setBackgroundDim() {},
  });
  vm.runInContext(slice("appearance.ts", "function applyTheme(", "function setGlassBlur("), context);
  for (const value of [null, undefined, "", "invalid", 0, false, {}, "dark", "light", "image", "dynamic"]) {
    context.applyTheme(value);
    const expected = typeof value === "string" && ["dark", "light", "image", "dynamic"].includes(value) ? value : "dark";
    assert.equal(root.dataset.theme, expected);
    assert.deepEqual(writes.at(-1), ["theme", expected]);
  }
});

test("restoring cache settings cancels the active timer and preserves the null timer no-op", async () => {
  for (const timer of [null, 21]) {
    const cancelled = [];
    const settings = { enabled: true, maxBytes: 1024 };
    const context = vm.createContext({ audioCacheStatusTimer: timer, audioCacheSettings: null,
      audioCacheEnabled: {}, audioCacheCapacity: {}, audioCacheStatus: {},
      clearTimeout: (id) => { if (id !== null) cancelled.push(id); },
      invokeAppearance: async () => settings,
    });
    vm.runInContext(slice("appearance.ts", "async function restoreAudioCacheSettings(", "async function refreshAudioCacheUsage("), context);
    await context.restoreAudioCacheSettings();
    assert.deepEqual(cancelled, timer === null ? [] : [timer]);
    assert.equal(context.audioCacheStatusTimer, null);
    assert.equal(context.audioCacheEnabled.checked, true);
    assert.equal(context.audioCacheCapacity.value, "1024");
  }
});
