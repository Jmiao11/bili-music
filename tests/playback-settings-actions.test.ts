import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlaybackSettingsActions, effectivePlaybackVolume, initialPlaybackSettingsState } from "../ui/playback-settings-state.ts";
import { createStateStore } from "../ui/state-store.ts";
import { renderPlaybackSettingsSnapshot } from "../ui/playback-settings-view.ts";

function fixture() {
  return createStateStore(initialPlaybackSettingsState(), createPlaybackSettingsActions, { freeze: true });
}
test("playback settings actions retain immutable volume gain targets and strict enable semantics without DOM", () => {
  const store = fixture(), initial = store.getState(); store.actions.setUserVolume("0.8");
  store.actions.setNormalizationEnabled("true"); assert.equal(store.getState().normalizationEnabled, false);
  store.actions.setNormalizationEnabled(true); store.actions.setGain(0.5);
  const gain = store.getState(); assert.equal(gain.userVolume, 0.8); assert.equal(gain.normalizationGain, 0.5); assert.equal(gain.targetVolume, 0.4); assert.equal(gain.effectiveVolume, 0.8);
  store.actions.applyEffectiveVolume(0.6); assert.equal(store.getState().effectiveVolume, 0.6); assert.equal(gain.effectiveVolume, 0.8); assert.equal(initial.userVolume, 1);
  store.actions.setUserVolume("0.6"); assert.equal(store.getState().effectiveVolume, 0.3); assert.equal(store.getState().targetVolume, 0.3);
  assert.throws(() => { (store.getState() as { userVolume: number }).userVolume = 0; });
});
test("playback settings readonly projection writes media before controls and does not repaint a gain target", () => {
  const store = fixture(), events: unknown[][] = [];
  let previous: ReturnType<typeof store.getState> | null = null;
  const render = () => { const state = store.getState(); renderPlaybackSettingsSnapshot(state, previous, { setMediaVolume: value => events.push(["media", value]), setVolumeControl: value => events.push(["slider", value]), setNormalizationControl: value => events.push(["enabled", value]) }); previous = state; };
  store.subscribe(render); render(); assert.deepEqual(events, []);
  store.actions.setUserVolume(0.7); store.actions.setNormalizationEnabled(true); store.actions.setGain(0.25);
  assert.deepEqual(events, [["media", 0.7], ["slider", 0.7], ["enabled", true]]);
  store.actions.applyEffectiveVolume(0.4); assert.deepEqual(events.at(-1), ["media", 0.4]); assert.equal(effectivePlaybackVolume(store.getState()), 0.175);
});
