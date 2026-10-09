import assert from "node:assert/strict";
import vm from "node:vm";
import { test } from "node:test";
import { createRequestContext } from "./helpers/playback-request-fixture.ts";

const fields = ["requestVersion", "activeAudioVersion", "activeAudioUrl", "audioActivatedAt", "consecutiveResolveFailures"] as const;
const initial = () => ({ requestVersion: 7, activeAudioVersion: 6, activeAudioUrl: "private-fixture-source", audioActivatedAt: 91, consecutiveResolveFailures: 3 });
for (const field of fields) {
  test(`request fixture imports ${field} at the business entry boundary`, () => {
    const state = initial(), context = createRequestContext({ playerState: state, expected: state[field] });
    vm.runInContext(`function inspect() { return Object.is(getRequestSnapshot().${field}, expected); }`, context);
    assert.equal(context.inspect(), true);
    assert.equal(Object.is(state[field], context.expected), true);
  });
  test(`request fixture publishes ${field} at the business exit boundary`, () => {
    const state = initial(), context = createRequestContext({ playerState: state });
    const operations = { requestVersion: "beginRequest()", activeAudioVersion: 'activateAudio(11, "replacement-source", 110)', activeAudioUrl: 'replaceAudio("replacement-source", 110)', audioActivatedAt: 'replaceAudio("replacement-source", 110)', consecutiveResolveFailures: "recordFailure()" };
    const expected = { requestVersion: 8, activeAudioVersion: 11, activeAudioUrl: "replacement-source", audioActivatedAt: 110, consecutiveResolveFailures: 4 };
    vm.runInContext(`function change() { getRequestActions().${operations[field]}; }`, context); context.change();
    assert.equal(Object.is(state[field], expected[field]), true);
  });
}
test("request fixture preserves VM globals, original Promise and event listener removal", async () => {
  const handlers = new Set<Function>(); let complete: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { complete = resolve; });
  const state = initial(), context = createRequestContext({ playerState: state, pending, invoke: () => pending,
    audio: { addEventListener(_name: string, callback: Function) { handlers.add(callback); }, removeEventListener(_name: string, callback: Function) { handlers.delete(callback); } } });
  vm.runInContext('function run() { return invoke(); } function event() { getRequestActions().beginRequest(); } audio.addEventListener("play", event);', context);
  assert.equal(context.run() === pending, true); assert.equal(vm.runInContext("typeof Math.random", context), "function");
  state.requestVersion = 20; if (!complete) throw Error("Missing fixture completion"); complete(); await pending;
  assert.equal(context.getRequestSnapshot().requestVersion, 20);
  for (const callback of handlers) callback(); assert.equal(state.requestVersion, 21);
  vm.runInContext('audio.removeEventListener("play", event);', context); assert.equal(handlers.size, 0);
});
