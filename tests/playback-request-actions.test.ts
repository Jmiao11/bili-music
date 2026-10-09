import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/app-state.ts";

test("request actions preserve immutable stages and take activation time as an argument", () => {
  const store = createApplicationStore({ invoke: async () => { throw Error("Unexpected platform access"); }, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const initial = store.getState(), stages: number[] = []; store.subscribe(state => stages.push(state.playbackRequest.requestVersion));
  assert.equal(store.actions.playbackRequest.beginRequest(), 1); assert.equal(store.actions.playbackRequest.isCurrent(0), false); assert.equal(store.actions.playbackRequest.isCurrent(1), true);
  store.actions.playbackRequest.activateAudio(1, "private-source", 123);
  const active = store.getState(); assert.equal(active.playbackRequest.activeAudioUrl === "private-source", true); assert.equal(active.playbackRequest.audioActivatedAt, 123);
  assert.equal(initial.playbackRequest.activeAudioUrl === "", true); assert.equal(active.playbackQueue, initial.playbackQueue);
  assert.throws(() => { (active.playbackRequest as { audioActivatedAt: number }).audioActivatedAt = 999; }, TypeError);
  store.actions.playbackRequest.replaceAudio("replacement", 456); assert.equal(store.getState().playbackRequest.activeAudioVersion, 1); assert.equal(active.playbackRequest.audioActivatedAt, 123);
  assert.equal(store.actions.playbackRequest.recordFailure(), 1); assert.equal(store.actions.playbackRequest.recordFailure(), 2); store.actions.playbackRequest.resetFailures(); assert.equal(store.getState().playbackRequest.consecutiveResolveFailures, 0);
  store.actions.playbackRequest.invalidateAudio(); assert.equal(store.getState().playbackRequest.activeAudioVersion, -1); assert.equal(store.getState().playbackRequest.activeAudioUrl === "", true); assert.equal(store.getState().playbackRequest.audioActivatedAt, Infinity);
  assert.deepEqual(stages, [1, 1, 1, 1, 1, 1, 1]);
});
