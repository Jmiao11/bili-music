import vm from "node:vm";
import {createControllerContext as createQueueContext} from "./helpers/controller-context.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/app-state.ts";
import { createPlaybackQueueActions, initialPlaybackQueueState } from "../ui/playback-queue-state.ts";
import { createStateStore } from "../ui/state-store.ts";

const track = (n: number) => ({ bvid: "BV" + String(n).padStart(10, "0"), title: "曲目" + n, uploader: "作者", thumbnailUrl: "", durationSeconds: 60 });
const fixture = () => createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions, { freeze: true });

test("queue actions normalize sources and preserve frozen snapshots without DOM", () => {
  const store = fixture(), initial = store.getState(), input = [track(1), track(2)];
  store.actions.replaceQueue(input, "playlist", 9, "list-1"); const queued = store.getState();
  input[0].title = "外部修改"; assert.equal(queued.queue[0].title, "曲目1"); assert.equal(queued.playlistId, "list-1"); assert.equal(queued.queueSearchVersion, null);
  store.actions.selectIndex(1, true, 11); store.actions.fillTrackMetadata(1, { title: "元数据", uploader: "更新", thumbnailUrl: "", durationSeconds: 90 });
  assert.equal(store.getState().queue[1].title, "元数据"); assert.equal(queued.queue[1].title, "曲目2"); assert.equal(initial.queue.length, 0);
  assert.equal(store.getState().queue[0], queued.queue[0]); assert.throws(() => { (store.getState().queue[0] as { title: string }).title = "坏"; }, TypeError);
});

test("queue actions use injected randomness for exact rounds matching pagination and loop boundaries", () => {
  const store = fixture(); let draws = 0; const random = () => { draws++; return 0; };
  store.actions.replaceQueue([track(1), track(2), track(3)], "search", 7); store.actions.selectIndex(0, false, null); store.actions.changeShuffle(true, random);
  assert.deepEqual(store.getState().randomRemaining, [2, 1]); assert.equal(draws, 1);
  assert.deepEqual(store.actions.nextNavigation(false, false, random), { kind: "queue", index: 1 });
  store.actions.selectIndex(1, true, null); assert.deepEqual(store.actions.nextNavigation(false, false, random), { kind: "queue", index: 2 });
  store.actions.selectIndex(2, true, null); assert.deepEqual(store.actions.nextNavigation(false, false, random), { kind: "end" });
  assert.equal(store.actions.appendSearchQueue([track(4)], -1, random), false); assert.equal(store.getState().queue.length, 3);
  assert.equal(store.actions.appendSearchQueue([track(4), track(5)], 7, random), true); assert.deepEqual(store.getState().randomRemaining, [4, 3]); assert.equal(draws, 2);
  store.actions.cycleLoop([{ id: "sequence" }, { id: "list" }, { id: "single" }]); assert.equal(store.getState().loopMode, "list");
});

test("queue part actions retain history round identity limits and disabled filtering", () => {
  const store = fixture(), pages = [1, 2, 3].map(page => ({ cid: page * 11, page, part: "P" + page, durationSeconds: 60 }));
  const disabled = new Map([[track(1).bvid.toLowerCase(), new Set([22])]]);
  store.actions.replaceQueue([track(1)]); store.actions.selectIndex(0, false, null); store.actions.changeShuffle(true, () => 0);
  let draws = 0, preferences = 0;
  assert.equal(store.actions.advancePage(pages, disabled, () => { draws++; return 0; }, () => { preferences++; return { order: "random", limit: 0 }; }), true);
  const round = store.getState().randomPageRound; assert.equal(store.getState().currentPageIndex, 2); assert.deepEqual(store.getState().history, [{ index: 0, cid: 11, pageLevel: true }]);
  assert.deepEqual(store.actions.previousNavigation(pages), { kind: "page" }); assert.equal(store.getState().currentPageIndex, 0); assert.equal(store.getState().randomPageRound, round);
  assert.equal(store.actions.advancePage(pages, disabled, () => { draws++; return 0; }, () => { preferences++; return { order: "random", limit: 1 }; }), false);
  assert.equal(draws, 1); assert.equal(preferences, 2); assert.equal(store.actions.retreatPage(pages, disabled), false);
});

test("queue automatic single loop and history fallbacks preserve navigation parameter distinctions", () => {
  const store = fixture(); store.actions.replaceQueue([track(1), track(2)]); store.actions.selectIndex(0, false, null);
  store.actions.cycleLoop([{ id: "sequence" }, { id: "single" }]);
  assert.deepEqual(store.actions.nextNavigation(true, false, () => 0), { kind: "queue", index: 0, repeat: true });
  assert.deepEqual(store.actions.nextNavigation(true, true, () => 0), { kind: "queue", index: 1 });
  store.actions.selectIndex(1, true, null); assert.deepEqual(store.actions.previousNavigation([]), { kind: "queue", index: 0, cid: null });
  assert.deepEqual(store.actions.previousNavigation([]), { kind: "queue", index: 0 });
});

test("queue application commits notify synchronously and isolate all other domain references", () => {
  const store = createApplicationStore({ invoke: async () => null as never, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const before = store.getState(), snapshots: ReturnType<typeof store.getState>[] = []; store.subscribe(state => snapshots.push(state));
  store.actions.playbackQueue.replaceQueue([track(1)]); assert.equal(snapshots.length, 1); assert.equal(snapshots[0], store.getState());
  for (const key of ["home", "search", "library", "pages", "settings", "playbackSettings", "playbackDisplay"] as const) assert.equal(store.getState()[key], before[key]);
});

test("explicit queue fixture executes real actions and resynchronizes mutable legacy inputs without mutating snapshots", () => {
  const state = { queue: [track(1), track(2)], currentIndex: 0, shuffle: true, randomRemaining: [1], history: [] };
  const context = createQueueContext({ playerState: state }); const before = context.getQueueSnapshot();
  assert.deepEqual(context.getQueueActions().nextNavigation(false, false, () => 0), { kind: "queue", index: 1 });
  assert.deepEqual([...state.randomRemaining], []); assert.deepEqual(before.randomRemaining, [1]); assert.equal(Object.isFrozen(before.queue), true);
  context.seedQueue({randomRemaining:[...state.randomRemaining,1]}); assert.deepEqual(context.getQueueActions().nextNavigation(false, false, () => 0), { kind: "queue", index: 1 });
  assert.deepEqual(before.randomRemaining, [1]); assert.equal(vm.runInContext("1 + 1", context), 2);
});

test("explicit queue fixture preserves unrelated VM bindings and lexical player state setup", () => {
  const context = createQueueContext({ marker: { value: 3 } });
  vm.runInContext('const playerState = { queue: [], currentIndex: -1, requestVersion: 9 }; marker.value++;', context);
  assert.deepEqual(context.getQueueActions().nextNavigation(false, false, () => 0), { kind: "empty" });
  assert.equal(context.marker.value, 4); assert.equal(vm.runInContext("playerState.requestVersion", context), 9);
});
