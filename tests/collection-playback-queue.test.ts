import assert from "node:assert/strict";
import { test } from "node:test";
import { createStateStore } from "../ui/store/state-store.ts";
import { activeQueueTrack, createPlaybackQueueActions, initialPlaybackQueueState, libraryQueueEntries, playbackQueueEntries, playbackTraversal } from "../ui/features/playback/playback-queue-state.ts";
import { collection, collectionEntry, videoEntry } from "./helpers/collections.ts";

const fixture = (shuffle = true, count = 12) => {
  const store = createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions, { freeze: true });
  const data = collection(count);
  store.actions.replaceQueue(libraryQueueEntries([collectionEntry(data)]), "favorites");
  store.actions.selectIndex(0, false, null); store.actions.changeShuffle(shuffle, () => 0);
  store.actions.freezeCollection(data, "sequential", () => 0);
  return store;
};
const pages = [1, 2, 3].map(page => ({ page, cid: page * 11, part: `P${page}`, durationSeconds: 60 }));
const disabled = new Map<string, Set<number>>();

for (const limit of [0, 1, 3, 5, 10]) test(`collection quota ${limit || "all"} counts audio units across member BVs`, () => {
  const store = fixture(); const heard: string[] = [];
  do {
    heard.push(activeQueueTrack(store.getState())!.bvid);
    store.actions.settleCollectionUnit();
  } while (store.actions.advanceCollection([], disabled, () => 0, { order: "sequential", limit }, 11, true));
  assert.equal(heard.length, limit || 12);
  assert.equal(new Set(heard).size, heard.length);
  assert.equal(store.getState().queue[0].collection?.playedCount, heard.length);
});

test("collection member pages share the outer quota and retain disabled page filtering", () => {
  const store = fixture(), bvid = activeQueueTrack(store.getState())!.bvid;
  const blocked = new Map([[bvid.toLowerCase(), new Set([22])]]);
  store.actions.settleCollectionUnit();
  assert.equal(store.actions.advanceCollection(pages, blocked, () => 0, { order: "sequential", limit: 3 }, 11, true), "page");
  assert.equal(store.getState().currentPageIndex, 2);
  store.actions.settleCollectionUnit();
  assert.equal(store.actions.advanceCollection(pages, blocked, () => 0, { order: "sequential", limit: 3 }, 33, true), "member");
  store.actions.settleCollectionUnit();
  assert.equal(store.actions.advanceCollection(pages, disabled, () => 0, { order: "sequential", limit: 3 }, 11, true), null);
  assert.equal(store.getState().queue[0].collection?.playedCount, 3);
});

test("collection selection and cancellation do not consume quota; a real failure settles once", () => {
  const store = fixture();
  assert.equal(store.actions.advanceCollection([], disabled, () => 0, { order: "sequential", limit: 1 }, null, false), "member");
  assert.equal(store.getState().queue[0].collection?.playedCount, 0);
  assert.equal(store.getState().history.length, 0);
  store.actions.settleCollectionUnit(); store.actions.settleCollectionUnit();
  assert.equal(store.getState().queue[0].collection?.playedCount, 1);
  assert.equal(store.actions.advanceCollection([], disabled, () => 0, { order: "sequential", limit: 1 }, null, false), null);
});

test("collection sequence and random member rounds visit every frozen member once", () => {
  for (const shuffle of [false, true]) for (const order of ["sequential", "random"]) {
    const store = fixture(shuffle, 5), data = collection(5);
    store.actions.freezeCollection(data, order, () => 0);
    const heard: string[] = [];
    do { heard.push(activeQueueTrack(store.getState())!.bvid); store.actions.settleCollectionUnit(); }
    while (store.actions.advanceCollection([], disabled, () => 0, { order, limit: 0 }, 11, true));
    assert.equal(new Set(heard).size, 5);
    assert.deepEqual(new Set(heard), new Set(data.snapshot.items.map(item => item.bvid)));
    if (!shuffle || order === "sequential") assert.deepEqual(heard, data.snapshot.items.map(item => item.bvid));
    else assert.notDeepEqual(heard, data.snapshot.items.map(item => item.bvid));
  }
});

test("mixed random rounds select parents and preserve actual entry BV CID history", () => {
  const store = fixture(), data = collection(3), video = { ...data.snapshot.items[0], bvid: "BV9999999999" };
  store.actions.replaceQueue(libraryQueueEntries([collectionEntry(data), videoEntry(video)]), "favorites");
  store.actions.selectIndex(0, false, null); store.actions.changeShuffle(true, () => 0); store.actions.freezeCollection(data, "sequential", () => 0);
  store.actions.settleCollectionUnit();
  assert.equal(store.actions.advanceCollection(pages, disabled, () => 0, { order: "sequential", limit: 0 }, 11, true), "page");
  assert.equal(store.actions.advanceCollection([], disabled, () => 0, { order: "sequential", limit: 0 }, 22, true), "member");
  const actual = activeQueueTrack(store.getState())!.bvid;
  store.actions.selectIndex(1, true, 44);
  assert.deepEqual(store.actions.previousNavigation([]), { kind: "queue", index: 0, cid: 44 });
  store.actions.selectIndex(0, false, null, false);
  assert.equal(activeQueueTrack(store.getState())!.bvid, actual);
  assert.deepEqual(store.actions.previousNavigation(pages), { kind: "queue", index: 0, cid: 22 });
  assert.equal(activeQueueTrack(store.getState())!.bvid, data.snapshot.items[0].bvid);
  assert.deepEqual(store.getState().history[0], { index: 0, cid: 11, pageLevel: true, entryId: "reference-31", bvid: data.snapshot.items[0].bvid, track: data.snapshot.items[0] });
  assert.deepEqual(store.actions.nextNavigation(false, false, () => 0), { kind: "queue", index: 1 });
  store.actions.selectIndex(1, true, 22);
  assert.deepEqual(store.actions.nextNavigation(false, false, () => 0), { kind: "end" });
});

test("collection persistence restores frozen members cursor rounds history and quota without refresh", () => {
  const store = fixture(); store.actions.settleCollectionUnit();
  store.actions.advanceCollection([], disabled, () => 0, { order: "sequential", limit: 3 }, 11, true);
  const before = store.getState(), restored = fixture();
  restored.actions.replaceQueue(playbackQueueEntries(before)); restored.actions.restoreSelection(before.currentIndex);
  restored.actions.restoreTraversal(playbackTraversal(before));
  assert.deepEqual(playbackQueueEntries(restored.getState()), playbackQueueEntries(before));
  assert.deepEqual(playbackTraversal(restored.getState()), playbackTraversal(before));
  assert.equal(restored.getState().collectionNeedsRefresh, false);
  assert.equal(activeQueueTrack(restored.getState())?.bvid, activeQueueTrack(before)?.bvid);
});

test("history retains an actually played member removed by a later complete refresh", () => {
  const store = fixture(true, 3), original = collection(3);
  store.actions.advanceCollection([], disabled, () => 0, { order: "sequential", limit: 0 }, 11, true);
  const fresh = { ...original, videoCount: 2, snapshot: { fetchedAt: "1800000000000", items: original.snapshot.items.slice(1) } };
  store.actions.freezeCollection(fresh, "sequential", () => 0);
  assert.deepEqual(store.actions.previousNavigation([]), { kind: "queue", index: 0, cid: 11 });
  assert.equal(activeQueueTrack(store.getState())?.bvid, original.snapshot.items[0].bvid);
  store.actions.fillTrackMetadata(0, { title: "历史成员的新元数据", uploader: "作者", thumbnailUrl: "", durationSeconds: 70 });
  assert.equal(activeQueueTrack(store.getState())?.title, "历史成员的新元数据");
  assert.deepEqual(store.getState().queue[0].collection?.data.snapshot.items, fresh.snapshot.items);
  assert.deepEqual(store.getState().queue[0].collection?.data.snapshot.items.map(item => item.bvid), fresh.snapshot.items.map(item => item.bvid));
});

test("returning through page history does not charge an already completed audio unit twice", () => {
  const store = fixture(), prefs = { order: "sequential", limit: 0 };
  store.actions.settleCollectionUnit(11);
  store.actions.advanceCollection(pages, disabled, () => 0, prefs, 11, true);
  store.actions.settleCollectionUnit(22);
  assert.deepEqual(store.actions.previousNavigation(pages), { kind: "page" });
  store.actions.settleCollectionUnit(11);
  store.actions.advanceCollection(pages, disabled, () => 0, prefs, 11, true);
  store.actions.settleCollectionUnit(22);
  assert.equal(store.getState().queue[0].collection?.playedCount, 2);
});
