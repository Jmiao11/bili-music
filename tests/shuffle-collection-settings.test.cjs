const { sourceSlice } = require("./helpers/source-slice.cjs");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const main = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const appearance = readFileSync(path.join(__dirname, "../ui/appearance.js"), "utf8");
const html = readFileSync(path.join(__dirname, "../ui/index.html"), "utf8");
const source = sourceSlice(main, "ui/main.js", "function isPageDisabled(", "function setFavoriteButtonState(")
  + sourceSlice(appearance, "ui/appearance.js", "function openSettings()", "async function restoreAudioCacheSettings()")
  + sourceSlice(appearance, "ui/appearance.js", "for (const [select, key] of [", "clearAudioCacheButton?.addEventListener(\"click\"");

function setup(stored = new Map()) {
  const handlers = {};
  const select = (name) => ({
    value: "",
    addEventListener: (event, handler) => { handlers[name] = handler; },
  });
  const order = select("order");
  const limit = select("limit");
  const status = { textContent: "" };
  const context = vm.createContext({
    shuffleCollectionOrder: order,
    shuffleCollectionLimit: limit,
    SHUFFLE_COLLECTION_ORDER_KEY: "bilibili-music.shuffle-collection-order",
    SHUFFLE_COLLECTION_LIMIT_KEY: "bilibili-music.shuffle-collection-limit",
    appearanceStatus: status,
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    settingsModal: { hidden: true },
    restoreStreamSource() {}, restoreAudioCacheSettings() {},
    refreshAudioCacheUsage() {}, restoreAiConfig() {}, renderMascotPicker() {},
    requestAnimationFrame() {},
  });
  vm.runInContext(source, context);
  return { context, order, limit, status, handlers, stored };
}

test("audio settings contain both collection selectors and restore exact saved values on open", () => {
  assert.match(html, /id="shuffle-collection-order"/);
  assert.match(html, /id="shuffle-collection-limit"/);
  const stored = new Map([
    ["bilibili-music.shuffle-collection-order", "sequential"],
    ["bilibili-music.shuffle-collection-limit", "5"],
  ]);
  const { context, order, limit } = setup(stored);
  context.openSettings();
  assert.equal(order.value, "sequential");
  assert.equal(limit.value, "5");
  stored.set("bilibili-music.shuffle-collection-limit", "10");
  context.openSettings();
  assert.equal(limit.value, "10");
});

test("missing and invalid stored preferences show both defaults", () => {
  const { context, order, limit, stored } = setup();
  context.openSettings();
  assert.equal(order.value, "random");
  assert.equal(limit.value, "all");
  stored.set("bilibili-music.shuffle-collection-order", "SEQUENTIAL");
  stored.set("bilibili-music.shuffle-collection-limit", "03");
  context.openSettings();
  assert.equal(order.value, "random");
  assert.equal(limit.value, "all");
});

test("storage read failure shows defaults", () => {
  const { context, order, limit } = setup();
  context.localStorage.getItem = () => { throw Error("read denied"); };
  context.openSettings();
  assert.equal(order.value, "random");
  assert.equal(limit.value, "all");
});

test("changes write their own keys silently and report write failures", () => {
  const { context, order, limit, status, handlers, stored } = setup();
  order.value = "sequential";
  handlers.order();
  limit.value = "3";
  handlers.limit();
  assert.equal(stored.get("bilibili-music.shuffle-collection-order"), "sequential");
  assert.equal(stored.get("bilibili-music.shuffle-collection-limit"), "3");
  assert.equal(status.textContent, "");
  context.localStorage.setItem = () => { throw Error("write denied"); };
  handlers.order();
  assert.match(status.textContent, /随机播放设置保存失败/);
});
