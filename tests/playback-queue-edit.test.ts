import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlaybackQueueActions, initialPlaybackQueueState, libraryQueueEntries } from "../ui/features/playback/playback-queue-state.ts";
import { createStateStore } from "../ui/store/state-store.ts";
import { collection, collectionEntry } from "./helpers/collections.ts";

test("插入只移动父索引，当前播放身份与冻结轮次保持", () => {
  const group = collection(4), [first, second, third, added] = group.snapshot.items;
  const store = createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions, { freeze: true });
  const actions = store.actions;
  actions.replaceQueue([first, second, ...libraryQueueEntries([collectionEntry(group)]), third], "playlist", null, "list");
  actions.selectIndex(2, false, null);
  actions.changeShuffle(true, () => 0);
  actions.selectIndex(0, true, 22);
  actions.markPlayed(0);
  actions.setDisplayTrack({ ...first, hasCurrent: true });
  const before = store.getState();
  const notifications: string[] = [];
  store.subscribe(state => notifications.push(state.queueSource));
  assert.equal(actions.insertNextVideo(added), true);
  const after = store.getState();
  assert.deepEqual(notifications, ["direct"]);
  assert.equal(after.queue[after.currentIndex], before.queue[before.currentIndex]);
  assert.equal(after.currentDisplayTrack, before.currentDisplayTrack);
  assert.equal(after.queue[3], before.queue[2]);
  assert.equal(after.queue[3].collection, before.queue[2].collection);
  assert.equal(after.queue[2], before.queue[1]);
  assert.equal(after.queue[4], before.queue[3]);
  assert.deepEqual(after.history, [{ ...before.history[0], index: 3 }]);
  assert.equal(after.history[0].track, before.history[0].track);
  assert.deepEqual(after.randomRemaining, [...before.randomRemaining.map(i => i + 1), 1]);
  assert.deepEqual([after.queueSource, after.queueSearchVersion, after.playlistId], ["direct", null, null]);
  assert.equal(actions.insertNextVideo(added), false);
  assert.equal(store.getState(), after);
  assert.equal(notifications.length, 1);
  actions.insertNextVideo(second);
  assert.deepEqual(store.getState().queue.map(t => t.bvid), [first,second,added,second,first,third].map(t => t.bvid));
});

test("紧邻合集的锚点不参与视频去重，搜索版本随结构编辑清除", () => {
  const data = collection(3), [first, second] = data.snapshot.items;
  const store = createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions);
  store.actions.replaceQueue([second, ...libraryQueueEntries([collectionEntry(data)])], "search", 5);
  store.actions.selectIndex(0, false, null);
  store.actions.insertNextVideo(first);
  assert.equal(store.getState().queue[1].collection, undefined);
  assert.ok(store.getState().queue[2].collection);
  assert.equal(store.getState().queueSearchVersion, null);
});
