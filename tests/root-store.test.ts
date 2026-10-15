import assert from "node:assert/strict";
import { test } from "node:test";
import { createRootStore } from "../ui/application-store.ts";

test("root subscription runs before nested business commits and never ends on the old snapshot", () => {
  const projected: string[] = [];
  const store = createRootStore({ invoke: () => new Promise(() => {}), setTimeout: () => 0, clearTimeout() {}, report() {} }, state => projected.push(state.home.userHint));
  store.subscribe(state => {
    if (state.home.userHint === "outer") store.actions.setHomeHint("inner");
  });
  store.actions.setHomeHint("outer");
  assert.deepEqual(projected, ["", "outer", "inner"]);
  assert.equal(projected.at(-1), store.getState().home.userHint);
});

test("a failed first root render aborts bootstrap before a store is handed to controllers", () => {
  assert.throws(() => createRootStore({ invoke: () => new Promise(() => {}), setTimeout: () => 0, clearTimeout() {}, report() {} }, () => {
    throw new Error("first render failed");
  }), /first render failed/);
});
