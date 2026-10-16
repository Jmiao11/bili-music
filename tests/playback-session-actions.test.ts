import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/store/app-state.ts";

test("session actions preserve immutable snapshots and injected time without platform APIs", () => {
  const store = createApplicationStore({ invoke: async () => { throw Error("Unexpected invoke"); }, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const before = store.getState(); const actions = store.actions.playbackSession;
  actions.setCurrentPages([{ page: 2, cid: 22, part: "P2", durationSeconds: 80 }]);
  actions.setPendingResume({ positionSeconds: 35, page: 2, cid: 22 }); actions.setLastSavedAt(1700000000123);
  assert.equal(before.playbackSession.currentPages.length, 0); assert.equal(before.playbackSession.pendingResume, null);
  assert.equal(store.getState().playbackSession.lastPlaybackStateSavedAt, 1700000000123);
  assert.equal(store.getState().playbackQueue, before.playbackQueue); assert.equal(store.getState().playbackRequest, before.playbackRequest);
  assert.equal(actions.nextLoudnessQuery(), 1); assert.equal(actions.nextLoudnessQuery(), 2);
  assert.throws(() => Object.assign(store.getState().playbackSession, { recoveryAttempts: 3 }), TypeError);
});
