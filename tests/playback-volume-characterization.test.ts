import { attachPlaybackVolumeVm } from "./helpers/playback-volume-fixture.ts";
import { createControllerContext as createQueueContext } from "./helpers/controller-context.ts";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { readFileSync } from "./helpers/module-syntax.ts";
import { sourceSlice } from "./helpers/source-slice.ts";

const appearance = readFileSync(path.join(import.meta.dirname, "../ui/appearance.ts"), "utf8");
const core = readFileSync(path.join(import.meta.dirname, "../ui/playback-core.ts"), "utf8");
const policy = readFileSync(path.join(import.meta.dirname, "../ui/playback-policy.ts"), "utf8");
const code = sourceSlice(appearance, "ui/appearance.ts", "const VOLUME_KEY", "const root =")
  + sourceSlice(appearance, "ui/appearance.ts", "function clampNumber(", "function isShortcutModifierCode(")
  + sourceSlice(appearance, "ui/appearance.ts", "function applyVolume(", "function startAppearance()", { endAfterStart: true })
  + sourceSlice(policy, "ui/playback-policy.ts", "// 与 src-tauri/", "\n}", { endAfterStart: true, includeEnd: true })
  + sourceSlice(core, "ui/playback-core.ts", "function refreshTrackLoudness(", "function analyzeCurrentTrackAtThreshold(");
const startup = sourceSlice(appearance, "ui/appearance.ts", "applyVolume(localStorage.getItem(VOLUME_KEY), false);", "updateProgress(0);", { endAfterStart: true });
const volumeKey = "bilibili-music.volume", enabledKey = "bilibili-music.loudness-normalization";
function fixture(saved: [string, string][] = []) {
  const stored = new Map(saved), writes: [string, string][] = [], frames = new Map<number, (time: number) => void>(), cancelled: number[] = [];
  const queries: { resolve(value: number | null): void; reject(error: Error): void; key: string }[] = [];
  let serial = 0;
  const playerState = { requestVersion: 1, queue: [{ bvid: "BV1GF4X6MEb1" }], currentIndex: 0, currentPages: [{ cid: 1 }] };
  const audio = { volume: 1 };
  const context = createQueueContext({ playerAudio: audio, playerState, volumeSlider: { value: "" }, loudnessNormalizationToggle: { checked: false },
    localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem(key: string, value: string) { stored.set(key, value); writes.push([key, value]); } },
    currentVideoPage: () => playerState.currentPages[0], updateRangeProgress() {}, console: { warn() {} },
    // src-tauri/src/library/loudness_store.rs:53-71: Option<f64> serializes to a number or null, never an object.
    invoke: (_command: string, args: { key: string }) => new Promise<number | null>((resolve, reject) => queries.push({ resolve, reject, key: args.key })),
    requestAnimationFrame(callback: (time: number) => void) { frames.set(++serial, callback); return serial; }, cancelAnimationFrame(id: number) { cancelled.push(id); frames.delete(id); },
  });
  attachPlaybackVolumeVm(context);
  vm.runInContext(code + startup, context);
  return { context, audio, playerState, stored, writes, frames, cancelled, queries,
    frame(time: number) { const next = frames.entries().next().value; if (!next) throw Error("Missing frame"); frames.delete(next[0]); next[1](time); },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); },
  };
}

test("volume startup restores absent invalid bounded and fractional storage without writing", () => {
  for (const [value, expected] of [[null, 1], ["", 1], ["invalid", 1], ["NaN", 1], ["Infinity", 1], ["-1", 0], ["2", 1], ["0.37", 0.37]] as [string | null, number][]) {
    const h = fixture(value === null ? [] : [[volumeKey, value]]);
    assert.equal(h.audio.volume, expected); assert.equal(h.context.volumeSlider.value, String(expected)); assert.deepEqual(h.writes, []);
    assert.equal(h.context.isLoudnessNormalizationEnabled(), false);
  }
});
test("volume slider persists normalized decimal strings and gain leaves its value untouched", () => {
  const h = fixture(); h.context.applyLoudnessNormalization(true); h.writes.length = 0;
  h.context.applyVolume("0.6500"); assert.deepEqual(h.writes, [[volumeKey, "0.65"]]);
  h.context.setNormalizationGain(0.5); h.frame(10); h.frame(260);
  assert.equal(h.audio.volume, 0.325); assert.equal(h.context.volumeSlider.value, "0.65"); assert.equal(h.stored.get(volumeKey), "0.65");
  h.context.applyVolume("0.20"); assert.equal(h.audio.volume, 0.1); assert.deepEqual(h.writes.at(-1), [volumeKey, "0.2"]);
});
test("volume track change replaces an in-flight fade and discards its late loudness query", async () => {
  const h = fixture([[enabledKey, "true"], [volumeKey, "0.8"]]);
  h.queries[0].resolve(-8); await h.settle(); h.frame(0); h.frame(125);
  const middle = h.audio.volume, pending = [...h.frames.keys()][0];
  h.context.getRequestActions().beginRequest(); h.context.getSessionActions().setCurrentPages([{ cid: 2 }]); h.context.refreshTrackLoudness();
  assert.equal(h.cancelled.includes(pending), true); assert.equal(h.audio.volume, middle); assert.equal(h.queries[1].key, "BV1GF4X6MEb1:2");
  h.frame(125); h.frame(375); assert.equal(h.audio.volume, 0.8);
  h.context.getRequestActions().beginRequest(); h.context.refreshTrackLoudness(); h.queries[1].resolve(0); await h.settle();
  assert.equal(h.audio.volume, 0.8); assert.equal(h.frames.size, 0);
});
test("volume repeated normalization toggles replace fades without persisting intermediate gain", async () => {
  const h = fixture([[volumeKey, "0.8"]]); h.context.applyLoudnessNormalization(true); h.queries[0].resolve(-8); await h.settle(); h.frame(0); h.frame(125);
  const middle = h.audio.volume, old = [...h.frames.keys()][0]; h.context.applyLoudnessNormalization(false);
  assert.equal(h.cancelled.includes(old), true); assert.equal(h.audio.volume, middle);
  h.frame(125); h.frame(250); h.context.applyLoudnessNormalization(true); h.queries[1].resolve(-12); await h.settle(); h.frame(250); h.frame(500);
  assert.equal(h.audio.volume, 0.8 * 10 ** (-2 / 20)); assert.equal(h.context.volumeSlider.value, "0.8");
  assert.deepEqual(h.writes, [[enabledKey, "true"], [enabledKey, "false"], [enabledKey, "true"]]);
});
test("volume slider cancels transition on its first input and strict stored true alone enables normalization", () => {
  for (const value of ["TRUE", " true ", "1", "false", "true"]) {
    const h = fixture([[enabledKey, value]]); assert.equal(h.context.isLoudnessNormalizationEnabled(), value === "true"); assert.equal(h.queries.length, value === "true" ? 1 : 0);
  }
  const h = fixture([[enabledKey, "true"]]); h.context.setNormalizationGain(0.5); h.frame(0); h.frame(125);
  const pending = [...h.frames.keys()][0]; h.context.applyVolume("0.4"); assert.equal(h.cancelled.includes(pending), true); assert.equal(h.frames.size, 0); assert.equal(h.audio.volume, 0.2); assert.equal(h.context.volumeSlider.value, "0.4");
});
