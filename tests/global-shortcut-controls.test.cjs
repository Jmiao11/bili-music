const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/appearance.js"), "utf8");
const stepDefinition = source.match(/const GLOBAL_SHORTCUT_VOLUME_STEP = [^;]+;/)?.[0];
const volumeFunction = source.slice(
  source.indexOf("function adjustVolumeByStep("),
  source.indexOf("function updateEffectiveVolume("),
);
const eventBridge = source.slice(
  source.indexOf("function initializeGlobalShortcutControls() {"),
  source.indexOf("function syncImmersiveTrack("),
);
assert.ok(stepDefinition);
assert.ok(volumeFunction.startsWith("function adjustVolumeByStep("));
assert.ok(eventBridge.startsWith("function initializeGlobalShortcutControls() {"));

function adjust(userVolume, direction) {
  const calls = [];
  const context = vm.createContext({ calls });
  vm.runInContext(`
    let userVolume = ${userVolume};
    let normalizationGain = 0.37;
    function applyVolume(value) { calls.push(value); }
    ${stepDefinition}
    ${volumeFunction}
    adjustVolumeByStep(${direction});
    globalThis.result = { calls, normalizationGain };
  `, context);
  return context.result;
}

function assertAdjustment(userVolume, direction, expected) {
  const result = adjust(userVolume, direction);
  assert.equal(result.calls.length, 1);
  assert.ok(Math.abs(result.calls[0] - expected) < Number.EPSILON);
  assert.equal(result.normalizationGain, 0.37);
}

test("volume shortcut adds one step through applyVolume", () => {
  assertAdjustment(0.5, 1, 0.55);
});

test("volume shortcut subtracts one step through applyVolume", () => {
  assertAdjustment(0.5, -1, 0.45);
});

test("volume shortcut stays at the upper boundary", () => {
  assertAdjustment(1, 1, 1);
});

test("volume shortcut stays at the lower boundary", () => {
  assertAdjustment(0, -1, 0);
});

test("global shortcut payloads dispatch to the existing controls", async () => {
  const window = new EventTarget();
  const actions = [];
  let receive;
  window.__TAURI__ = { event: { listen(name, handler) {
    assert.equal(name, "global-shortcut");
    receive = handler;
    return Promise.resolve(() => Promise.resolve());
  } } };
  const context = vm.createContext({
    window,
    previousButtonForImmersive: { click: () => actions.push("previous") },
    playPauseButton: { click: () => actions.push("play_pause") },
    nextButtonForImmersive: { click: () => actions.push("next") },
    adjustVolumeByStep: (direction) => actions.push(direction > 0 ? "volume_up" : "volume_down"),
    console: { warn: () => {} },
  });
  vm.runInContext(`${eventBridge}\ninitializeGlobalShortcutControls();`, context);
  await new Promise((resolve) => setImmediate(resolve));

  for (const payload of [
    "previous", "play_pause", "next", "volume_up", "volume_down", "unknown",
  ]) receive({ payload });

  assert.deepEqual(actions, [
    "previous", "play_pause", "next", "volume_up", "volume_down",
  ]);
});
