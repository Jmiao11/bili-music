import assert from "node:assert/strict";
import { test } from "node:test";
import { createStateStore } from "../ui/state-store.ts";

function counterStore(options = {}) {
  return createStateStore({ count: 0, stable: { label: "unchanged" }, values: [1], map: new Map([["a", { count: 1 }]]), set: new Set([1]) }, (getState, commit) => ({
    increment() { commit({ ...getState(), count: getState().count + 1 }); },
    append() { const before = getState(); commit({ ...before, values: [...before.values, 2], map: new Map([...before.map, ["b", { count: 2 }]]), set: new Set([...before.set, 2]) }); },
  }), options);
}

test("store snapshots retain old paths and copy only changed paths", () => {
  const store = counterStore();
  const before = store.getState();
  store.actions.increment();
  assert.equal(before.count, 0);
  assert.equal(store.getState().count, 1);
  assert.equal(store.getState().stable, before.stable);
  assert.equal(store.getState().values, before.values);
  store.actions.append();
  assert.deepEqual(before.values, [1]);
  assert.equal(before.map.size, 1);
  assert.equal(before.set.size, 1);
  assert.notEqual(store.getState().map, before.map);
  assert.notEqual(store.getState().set, before.set);
  assert.deepEqual(Object.keys(store).sort(), ["actions", "getState", "subscribe"]);
});

test("store subscriptions are synchronous ordered and not immediate and can unsubscribe", () => {
  const store = counterStore();
  const calls: string[] = [];
  const remove = store.subscribe(state => calls.push(`first:${state.count}`));
  store.subscribe(state => calls.push(`second:${state.count}`));
  assert.deepEqual(calls, []);
  store.actions.increment();
  assert.deepEqual(calls, ["first:1", "second:1"]);
  remove(); remove();
  store.actions.increment();
  assert.deepEqual(calls, ["first:1", "second:1", "second:2"]);
});

test("subscriber exceptions are reported without stopping other subscribers or later action steps", () => {
  const failure = new Error("subscriber failed");
  const reported: unknown[] = [];
  const order: string[] = [];
  const store = createStateStore({ count: 0 }, (getState, commit) => ({ run() {
    commit({ count: getState().count + 1 }); order.push("after commit");
  } }), { onSubscriberError: error => reported.push(error) });
  store.subscribe(() => { order.push("throw"); throw failure; });
  store.subscribe(() => order.push("second"));
  store.actions.run();
  assert.deepEqual(reported, [failure]);
  assert.deepEqual(order, ["throw", "second", "after commit"]);
});

test("a failing error reporter is logged and cannot interrupt notification or actions", () => {
  const saved = console.error;
  const reports: unknown[][] = [];
  console.error = (...args: unknown[]) => reports.push(args);
  try {
    const store = counterStore({ onSubscriberError() { throw new Error("report failed"); } });
    let reached = false;
    store.subscribe(() => { throw new Error("listener failed"); });
    store.subscribe(() => { reached = true; });
    store.actions.increment();
    assert.equal(reached, true);
    assert.equal(store.getState().count, 1);
    assert.equal(reports.length, 1);
  } finally { console.error = saved; }
});

test("frozen snapshots reject nested object array Map and Set writes including callback escapes", () => {
  const store = counterStore({ freeze: true });
  const before = store.getState();
  assert.equal(Object.isFrozen(before), true);
  assert.throws(() => { Object.assign(before.stable, { label: "changed" }); }, TypeError);
  assert.throws(() => { Array.prototype.push.call(before.values, 2); }, TypeError);
  for (const method of ["set", "delete", "clear"]) assert.throws(() => Reflect.get(before.map, method)("b", 2), TypeError);
  for (const method of ["add", "delete", "clear"]) assert.throws(() => Reflect.get(before.set, method)(2), TypeError);
  assert.throws(() => Map.prototype.set.call(before.map, "b", 2), TypeError);
  assert.throws(() => Set.prototype.add.call(before.set, 2), TypeError);
  before.map.forEach((entry, _key, owner) => {
    assert.throws(() => Object.assign(entry, { count: 2 }), TypeError);
    assert.throws(() => Reflect.get(owner, "clear")(), TypeError);
  });
  before.set.forEach((_entry, _key, owner) => assert.throws(() => Reflect.get(owner, "clear")(), TypeError));
  store.actions.append();
  assert.equal(before.map.size, 1);
  assert.equal(store.getState().map.size, 2);
  assert.equal(store.getState().stable, before.stable);
});

test("runtime snapshots are not frozen when freeze is disabled", () => {
  assert.equal(Object.isFrozen(counterStore().getState()), false);
});
