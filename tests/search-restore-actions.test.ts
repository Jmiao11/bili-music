import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/app-state.ts";

test("search pending restore actions consume once without mutating the previous frozen snapshot", () => {
  const store = createApplicationStore({ invoke: async () => { throw Error("unexpected command"); }, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const initial = store.getState();
  store.actions.search.setPendingRestore("恢复词");
  const pending = store.getState();
  assert.equal(initial.search.pendingSearchRestore, null);
  assert.equal(pending.search.pendingSearchRestore, "恢复词");
  assert.equal(store.actions.search.takePendingRestore(), "恢复词");
  assert.equal(store.getState().search.pendingSearchRestore, null);
  assert.equal(pending.search.pendingSearchRestore, "恢复词");
  assert.equal(store.actions.search.takePendingRestore(), null);
  assert.equal(initial.playbackRequest, pending.playbackRequest);
  assert.equal(initial.playbackSession, pending.playbackSession);
});
