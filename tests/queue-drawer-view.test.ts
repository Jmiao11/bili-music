import assert from "node:assert/strict";
import { test } from "node:test";
import { createQueueDrawerProjection } from "../ui/features/playback/queue-drawer-view.ts";
import { createPlaybackQueueActions, initialPlaybackQueueState } from "../ui/features/playback/playback-queue-state.ts";
import { createStateStore } from "../ui/store/state-store.ts";

test("queue drawer retains models across unrelated commits and only replaces old/new current rows", () => {
  const store = createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions, { freeze: true });
  const project = createQueueDrawerProjection(), stage = { hidden: false, open: true };
  store.actions.replaceQueue(Array.from({length:1000}, (_, i) => ({ bvid:`BV${String(i).padStart(10,'0')}`, title:`曲目${i}`, uploader:"作者", thumbnailUrl:"", durationSeconds:60 })));
  store.actions.selectIndex(0, false, null);
  const first = project(store.getState(),stage);
  for (let i=0;i<100;i++) assert.equal(project({...store.getState()},stage),first);
  store.actions.selectIndex(7, true, null);
  const next = project(store.getState(),stage);
  assert.deepEqual(next.rows.flatMap((row,i)=>row !== first.rows[i] ? [i] : []),[0,7]);
  assert.equal(next.count,1000);
  assert.equal(project(store.getState(),{hidden:true,open:false}).rows[3],next.rows[3]);
});
