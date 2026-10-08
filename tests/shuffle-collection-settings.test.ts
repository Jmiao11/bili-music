import { attachSettingsVm } from "./helpers/settings-vm.ts";
import nodePath from "node:path";
import { sourceSlice } from "./helpers/source-slice.ts";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const main = readFileSync(path.join(import.meta.dirname, "../ui/main.ts"), "utf8");
const policy = readFileSync(nodePath.join(import.meta.dirname, '../ui/playback-policy.ts'), 'utf8');
const pageSelection = readFileSync(path.join(import.meta.dirname, "../ui/page-selection.ts"), "utf8");
const appearance = readFileSync(path.join(import.meta.dirname, "../ui/appearance.ts"), "utf8");
const html = readFileSync(path.join(import.meta.dirname, "../ui/index.html"), "utf8");
const source = readFileSync(path.join(import.meta.dirname, "../ui/settings-adapter.ts"), "utf8") + sourceSlice(policy, "ui/playback-policy.ts", "function readShuffleCollectionPrefs(", "function shouldRecoverAudio(")
  + sourceSlice(appearance, "ui/appearance.ts", "function openSettings()", "async function restoreAudioCacheSettings()")
  + sourceSlice(appearance, "ui/appearance.ts", "for (const [select, key] of [", "clearAudioCacheButton?.addEventListener(\"click\"");

function setup(stored = new Map()) {
  const handlers: Record<string, () => void> = {};
  const select = (name: string) => ({
    value: "",
    addEventListener: (event: string, handler: () => void) => { handlers[name] = handler; },
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
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: unknown) => stored.set(key, value),
    },
    settingsModal: { hidden: true },
    restoreStreamSource() {}, restoreAudioCacheSettings() {},
    refreshAudioCacheUsage() {}, restoreAiConfig() {}, renderMascotPicker() {},
    requestAnimationFrame() {},
  });
  attachSettingsVm(context);
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
