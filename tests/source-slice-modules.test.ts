import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { sourceSlice, sourceSliceModuleExceptions } from "./helpers/source-slice.ts";

test("source slice module exception registration is exactly the two approved appearance slices", () => {
  const modules = ["app-state.ts", "playback-settings-state.ts", "media-adapter.ts", "playback-settings-view.ts"];
  assert.deepEqual(sourceSliceModuleExceptions, [
    { file: "ui/appearance.ts", start: "function applyVolume(", end: "function startAppearance()", modules, reason: "Frozen volume and loudness tests need the real store, media adapter and readonly projection." },
    { file: "ui/appearance.ts", start: "function applyLoudnessNormalization(", end: "function initializeLoudnessNormalization(", modules, reason: "Frozen isolated toggle tests need the same real modules and controller wiring." },
  ]);
});
test("source slice unregistered calls preserve raw bytes options and marker errors", () => {
  const source = "head\r\nfunction a() { return 1; }\r\n// stop\r\nfunction b() {}";
  assert.equal(sourceSlice(source, "plain.js", "function a()", "// stop"), "function a() { return 1; }\r\n");
  assert.equal(sourceSlice(source, "plain.js", null, "// stop", { includeEnd: true }), source.slice(0, source.indexOf("// stop") + 7));
  assert.equal(sourceSlice("start stop start stop", "plain.js", "start", "stop", { startLastBefore: "start stop start", endAfterStart: true }), "start ");
  assert.equal(sourceSlice("const x: number = 1;\n// end", "plain.ts", null, "// end", { stripModules: false }), "const x         = 1;\n");
  assert.throws(() => sourceSlice(source, "plain.js", "absent", "// stop"), /marker not found/);
  assert.throws(() => sourceSlice(source, "plain.js", "function b()", "// stop"), /not after/);
  assert.equal(sourceSlice(source, "ui/appearance.ts", "function a()", "// stop"), "function a() { return 1; }\r\n");
});
test("source slice injection executes real media and state module implementations", () => {
  const appearance = fs.readFileSync(path.join(import.meta.dirname, "../ui/appearance.ts"), "utf8");
  const injected = sourceSlice(appearance, "ui/appearance.ts", "function applyVolume(", "function startAppearance()", { endAfterStart: true });
  const context = vm.createContext({}); vm.runInContext(injected, context);
  const media = { src: "", volume: 1, currentTime: 0, load() {}, play: async () => {}, pause() {}, addEventListener() {}, removeEventListener() {} };
  context.__sliceRealModules.createMediaAdapter(media).setVolume(0.3); assert.equal(media.volume, 0.3);
  let state = context.__sliceRealModules.initialPlaybackSettingsState();
  const actions = context.__sliceRealModules.createPlaybackSettingsActions(() => state, (next: typeof state) => { state = next; });
  actions.setUserVolume(0.8); actions.setNormalizationEnabled(true); actions.setGain(0.5); assert.equal(state.targetVolume, 0.4);
});
