import { sourceSlice } from "./helpers/source-slice.ts";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(path.join(import.meta.dirname, "../ui/appearance.ts"), "utf8");
const stepDefinition = source.match(/const GLOBAL_SHORTCUT_VOLUME_STEP = [^;]+;/)?.[0];
const volumeFunction = sourceSlice(source, "ui/appearance.ts", "function adjustVolumeByStep(", "function updateEffectiveVolume(");
const eventBridge = sourceSlice(source, "ui/appearance.ts", "function initializeGlobalShortcutControls() {", "function syncImmersiveTrack(");
assert.ok(stepDefinition);
assert.ok(volumeFunction.startsWith("function adjustVolumeByStep("));
assert.ok(eventBridge.startsWith("function initializeGlobalShortcutControls() {"));

function adjust(userVolume: number, direction: number) {
  const calls: number[] = [];
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

function assertAdjustment(userVolume: number, direction: number, expected: number) {
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
  const window = (new EventTarget() as EventTarget & { __TAURI__?: { event: { listen(name: string, handler: (...args: unknown[]) => unknown): Promise<() => Promise<void>> } } });
  const actions: string[] = [];
  let receive: ((...args: unknown[]) => unknown) | undefined;
  window.__TAURI__ = { event: { listen(name: string, handler: (...args: unknown[]) => unknown) {
    assert.equal(name, "global-shortcut");
    receive = handler;
    return Promise.resolve(() => Promise.resolve());
  } } };
  const context = vm.createContext({
    window,
    previousButtonForImmersive: { click: () => actions.push("previous") },
    playPauseButton: { click: () => actions.push("play_pause") },
    nextButtonForImmersive: { click: () => actions.push("next") },
    adjustVolumeByStep: (direction: number) => actions.push(direction > 0 ? "volume_up" : "volume_down"),
    console: { warn: () => {} },
  });
  vm.runInContext(`${eventBridge}\ninitializeGlobalShortcutControls();`, context);
  await new Promise((resolve) => setImmediate(resolve));

  if (receive === undefined) throw new Error("Global shortcut handler is missing");
  for (const payload of [
    "previous", "play_pause", "next", "volume_up", "volume_down", "unknown",
  ]) receive({ payload });

  assert.deepEqual(actions, [
    "previous", "play_pause", "next", "volume_up", "volume_down",
  ]);
});
