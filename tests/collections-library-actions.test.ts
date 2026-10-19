import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { createApplicationStore } from "../ui/store/app-state.ts";
import type { HomeAdapter } from "../ui/store/app-state.ts";
import { collection, collectionEntry, collectionPage, videoEntry } from "./helpers/collections.ts";

function deferred() { let resolve!: (value: CommandContract.CollectionPage) => void; const promise = new Promise<CommandContract.CollectionPage>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function fixture() {
  const calls: { command: string; args: unknown }[] = [];
  let reply: (command: string, args: unknown) => Promise<unknown> = async command => command === "list_favorites" ? [collectionEntry()] : command === "list_playlists" ? [{ id: "a", name: "a", createdAt: "1", items: [] }] : command === "list_disabled_pages" ? {} : command === "get_collection_page" ? collectionPage() : command === "update_collection_entry" ? true : [];
  const adapter: HomeAdapter = { invoke: ((command: string, args: unknown) => { calls.push({ command, args }); return reply(command, args); }) as HomeAdapter["invoke"], setTimeout: () => 0, clearTimeout() {}, report() {} };
  const store = createApplicationStore(adapter, { freeze: true });
  return { store, calls, reply(next: typeof reply) { reply = next; }, open(snapshot = collection()) { store.actions.collection.open({ kind: "collection", bvid: snapshot.anchorBvid, id: snapshot.collectionId }, snapshot.title, snapshot.videoCount, "favorites", 117, snapshot); } };
}

test("collection open refreshes explicitly, coalesces concurrent id requests and ignores the closed view", async () => {
  const h = fixture(), gate = deferred(); h.reply(async () => gate.promise);
  assert.equal(h.calls.length, 0); h.open(); h.store.actions.collection.close(); h.open();
  assert.equal(h.calls.length, 1); assert.deepEqual(h.calls[0].args, { bvid: collection().anchorBvid, collectionId: 31, page: 1, refresh: true });
  gate.resolve(collectionPage({ ...collection(), title: "更新合集" })); await flush();
  assert.equal(h.store.getState().collection.title, "更新合集"); assert.equal(h.store.getState().collection.items.length, 20);
  await h.store.actions.collection.loadNextPage(); assert.equal(h.store.getState().collection.items.length, 25);
  assert.equal(h.store.getState().collection.hasMore, false); assert.equal(h.calls.length, 1);
});

test("risk failure uses the local snapshot without automatic retry or probing another member", async () => {
  const h = fixture(); h.reply(async () => { throw Error("HTTP 412"); }); h.open(); await flush();
  const state = h.store.getState().collection;
  assert.equal(h.calls.length, 1); assert.equal(state.usingSnapshot, true); assert.match(state.error, /来源无法校验/);
  assert.equal(state.fullSnapshot?.sourceStatus, "active"); assert.equal(state.fullSnapshot?.snapshot.fetchedAt, "1700000000000");
  await h.store.actions.collection.loadNextPage(); assert.equal(h.calls.length, 1); assert.match(h.store.getState().collection.error, /来源无法校验/);
  h.reply(async () => collectionPage()); await h.store.actions.collection.retry(); assert.equal(h.calls.length, 2); assert.equal(h.store.getState().collection.usingSnapshot, false);
});

test("wrong id and incomplete refresh never replace or persist a saved snapshot", async () => {
  for (const bad of [collection(25, 32), { ...collection(), snapshot: { fetchedAt: "2000", items: [] } }]) {
    const h = fixture(); await h.store.actions.library.loadLibrary(); const before = h.store.getState().library.favorites;
    h.reply(async () => collectionPage(bad)); h.store.actions.collection.open({ kind: "collection", bvid: collection().anchorBvid, id: 31 }, "测试合集", 25, "favorites", 0, collection(), { entryId: "reference-31", playlistId: null }); await flush();
    assert.equal(h.store.getState().library.favorites, before); assert.equal(h.store.getState().collection.fullSnapshot?.snapshot.fetchedAt, "1700000000000");
    assert.equal(h.calls.some(call => call.command === "update_collection_entry"), false); assert.match(h.store.getState().collection.error, /完整且匹配/);
  }
  const h = fixture(); h.reply(async () => ({ ...collectionPage(), snapshot: null })); h.open(); await flush();
  assert.equal(h.store.getState().collection.fullSnapshot?.snapshot.items.length, 25); assert.match(h.store.getState().collection.error, /完整且匹配/);
});

test("a confirmed invalid source remains distinct from an unverifiable source and a one-member collection can refresh", async () => {
  const h = fixture(); h.reply(async () => { throw Error("offline"); }); h.open({ ...collection(), sourceStatus: "invalid" }); await flush();
  assert.match(h.store.getState().collection.error, /合集来源已失效/); assert.equal(h.store.getState().collection.fullSnapshot?.snapshot.items.length, 25);
  h.reply(async () => collectionPage(collection(1))); await h.store.actions.collection.retry();
  assert.equal(h.store.getState().collection.total, 1); assert.equal(h.store.getState().collection.hasMore, false);
});

test("late refresh cannot restore a removed entry and refresh does not modify an already playing queue", async () => {
  const h = fixture(); await h.store.actions.library.loadLibrary(); const gate = deferred();
  h.reply(async command => command === "get_collection_page" ? gate.promise : command === "remove_collection_entry" ? null : true);
  h.store.actions.collection.open({ kind: "collection", bvid: collection().anchorBvid, id: 31 }, "测试合集", 25, "favorites", 0, collection(), { entryId: "reference-31", playlistId: null });
  h.store.actions.playbackQueue.replaceQueue(collection().snapshot.items, "collection", h.store.getState().collection.requestVersion);
  const queue = h.store.getState().playbackQueue;
  await h.store.actions.library.removeCollection("reference-31", null); gate.resolve(collectionPage({ ...collection(), title: "迟到更新" })); await flush();
  assert.equal(h.store.getState().library.favorites.length, 0); assert.equal(h.calls.some(call => call.command === "update_collection_entry"), false);
  assert.equal(h.store.getState().playbackQueue, queue); assert.match(h.store.getState().collection.error, /已移除/);
});

test("collection chooser keeps whole, split and single-video intents separate", async () => {
  const h = fixture(); await h.store.actions.library.loadLibrary(); const data = collection(2);
  const playlist = { id: "a", name: "a", createdAt: "1", items: [videoEntry(data.snapshot.items[0])] };
  h.reply(async command => command === "add_collection_to_playlist" ? [playlist] : { playlists: [playlist], added: 1, duplicates: 1 });
  h.store.actions.library.showCollectionChoose(data); assert.equal(h.store.getState().library.session.title, "加入整个合集"); await h.store.actions.library.submitChoose("a");
  h.store.actions.library.showCollectionChoose(data, true); assert.match(h.store.getState().library.session.title, /加入 2 个视频/); await h.store.actions.library.submitChoose("a");
  assert.deepEqual(h.calls.filter(call => call.command.startsWith("add_collection")).map(call => call.command), ["add_collection_to_playlist", "add_collection_videos_to_playlist"]);
  assert.match(h.store.getState().library.view.playbackStatus!, /1 个视频，重复 1 个/);
  h.store.actions.library.showChoose(data.snapshot.items[0]); assert.equal(h.store.getState().library.session.data.track?.bvid, data.snapshot.items[0].bvid); assert.equal(h.store.getState().library.session.data.collectionChoose, undefined);
});

test("C1 contract fixtures preserve their real Rust discriminants", () => {
  const read = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/contract/${name}.json`, import.meta.url), "utf8")) as { kind?: unknown; sourceStatus?: unknown };
  assert.equal(read("library-entry-video").kind, "video"); assert.equal(read("library-entry-collection").kind, "collection"); assert.equal(read("library-collection").sourceStatus, "active");
});
