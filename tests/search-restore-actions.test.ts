import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/store/app-state.ts";

test("search state preserves its frozen snapshots and playback identity across navigation", () => {
  const store = createApplicationStore({ invoke: async () => { throw Error("unexpected command"); }, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const initial = store.getState();
  store.actions.search.chooseDivision(28);
  const selected = store.getState();
  store.actions.settings.navigate("search");
  store.actions.settings.navigate("home");
  store.actions.settings.navigate("search");
  assert.equal(initial.search.tids, 3);
  assert.equal(selected.search.tids, 28);
  assert.equal(store.getState().search, selected.search);
  assert.equal(initial.playbackRequest, selected.playbackRequest);
  assert.equal(initial.playbackSession, selected.playbackSession);
});
