import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fixture, deferred, responses, transfer } from "./library-lists-fixture.ts";
import { nextDomEventTurn } from "./event-turn.ts";
import { collection, collectionEntry, collectionPage, videoEntry } from "../helpers/collections.ts";

type Harness = Awaited<ReturnType<typeof fixture>>;
async function fire(h: Harness, target: EventTarget, type: string, fields: Parameters<Harness["fire"]>[2] = {}) {
  await nextDomEventTurn(); return h.fire(target, type, fields);
}
function button(root: ParentNode, label: string): HTMLButtonElement {
  const node = [...root.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === label);
  assert.ok(node, label); return node;
}
function singleVideoReply(command: string, args: Record<string, unknown>) {
  if (command === "get_video_pages") return [{ page: 1, cid: 1, part: "一", durationSeconds: 60 }];
  if (command === "prepare_audio") return { audioUrl: "http://127.0.0.1/audio/fixture", title: String(args.bvId), uploader: "作者", thumbnailUrl: "", durationSeconds: 60 };
  return responses()(command);
}

test("collection refresh failure fixtures preserve dated playable snapshots and library file bytes", async t => {
  const cases: { name: string; error: string }[] = JSON.parse(fs.readFileSync(new URL("../fixtures/collection-refresh-failures.json", import.meta.url), "utf8"));
  const saved: CommandContract.LibraryCollection = JSON.parse(fs.readFileSync(new URL("../fixtures/contract/library-collection.json", import.meta.url), "utf8"));
  const checks = cases.flatMap(failure => ["favorites", "playlist"].map(location => ({ ...failure, location, invalid: false })));
  checks.push({ ...cases[2], name: "previously confirmed invalid source", location: "favorites", invalid: true });
  for (const check of checks) await t.test(`${check.name}: ${check.location}`, async () => {
    const h = await fixture(), directory = fs.mkdtempSync(path.join(os.tmpdir(), "bili-collection-fallback-"));
    try {
      const data = { ...saved, sourceStatus: check.invalid ? "invalid" as const : "active" as const }, entry = collectionEntry(data);
      const favorites = [entry], playlists = [{ id: "a", name: "快照歌单", createdAt: "1", items: [entry] }];
      const files = [path.join(directory, "favorites.json"), path.join(directory, "playlists.json")];
      fs.writeFileSync(files[0], JSON.stringify({ version: 2, items: favorites }));
      fs.writeFileSync(files[1], JSON.stringify({ version: 2, playlists }));
      const originalBytes = files.map(file => fs.readFileSync(file)), gate = deferred();
      h.reply(async (command, args) => {
        if (command === "list_favorites") return favorites;
        if (command === "list_playlists") return playlists;
        if (["list_disabled_pages", "get_cached_video_pages"].includes(command)) return {};
        if (command === "list_unavailable_tracks") return [];
        if (command === "get_collection_page") return gate.promise;
        if (command === "update_collection_entry") {
          fs.writeFileSync(files[args.playlistId ? 1 : 0], JSON.stringify(args.collection)); return true;
        }
        return singleVideoReply(command, args);
      });
      await h.library.loadLibrary();
      const beforeFavorites = h.store.getState().library.favorites, beforePlaylists = h.store.getState().library.playlists;
      h.store.actions.collection.open({ kind: "collection", bvid: data.anchorBvid, id: data.collectionId }, data.title, data.videoCount, "favorites", 0, data, { entryId: entry.entryId, playlistId: check.location === "playlist" ? "a" : null });
      const view = h.doc.querySelector("#view-collection")!;
      const date = () => [...view.querySelectorAll(".search-status")].find(node => node.textContent?.includes("更新于"))?.textContent;
      const originalDate = date(); assert.match(originalDate!, /本地快照 · 更新于/);
      const originalSnapshot = h.store.getState().collection.fullSnapshot;
      gate.reject(Error(check.error)); await h.microtasks();
      assert.equal(h.store.getState().collection.fullSnapshot, originalSnapshot);
      assert.equal(h.store.getState().collection.fullSnapshot?.snapshot.fetchedAt, saved.snapshot.fetchedAt);
      assert.equal(date(), originalDate);
      assert.match(view.textContent!, check.invalid ? /合集来源已失效/ : /来源无法校验/);
      if (!check.invalid) assert.doesNotMatch(view.textContent!, /合集来源已失效/);
      assert.equal(h.store.getState().collection.fullSnapshot?.sourceStatus, data.sourceStatus);
      assert.equal(h.calls.filter(call => call.command === "get_collection_page").length, 1);
      const list = h.doc.querySelector("#collection-results")!;
      assert.equal(list.children.length, saved.snapshot.items.length);
      await fire(h, list.children[1].querySelector("button.track")!, "click", { detail: 0 });
      assert.equal(h.store.getState().playbackQueue.queueSource, "collection");
      assert.deepEqual(h.store.getState().playbackQueue.queue.map(item => item.bvid), saved.snapshot.items.map(item => item.bvid));
      assert.equal(h.store.getState().playbackQueue.currentIndex, 1);
      assert.equal(list.children[1].querySelector("button.track")?.getAttribute("aria-current"), "true");
      assert.equal(h.calls.filter(call => call.command === "prepare_audio").at(-1)?.args.bvId, saved.snapshot.items[1].bvid);
      assert.equal(h.store.getState().library.favorites, beforeFavorites);
      assert.equal(h.store.getState().library.playlists, beforePlaylists);
      assert.equal(h.calls.some(call => call.command === "update_collection_entry"), false);
      assert.equal(date(), originalDate);
      files.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), originalBytes[index]));
      assert.deepEqual(fs.readdirSync(directory).sort(), ["favorites.json", "playlists.json"]);
      assert.equal(h.warnings.length, 0);
    } finally { h.dispose(); fs.rmSync(directory, { recursive: true, force: true }); }
  });
});

test("mixed collection rows open once, preserve queue, page locally, play and return to the original scroll", async () => {
  const h = await fixture(); try {
    const data = collection(), gate = deferred();
    const entries = [videoEntry(data.snapshot.items[0]), collectionEntry(data), videoEntry(data.snapshot.items[1])];
    h.reply(async (command, args) => command === "list_favorites" ? entries : command === "list_playlists" ? [] : command === "list_disabled_pages" ? {} : command === "list_unavailable_tracks" ? [] : command === "get_collection_page" ? gate.promise : command === "update_collection_entry" ? true : singleVideoReply(command, args));
    await h.library.loadLibrary(); h.store.actions.settings.navigate("favorites");
    const list = h.nodes.favoritesList, row = list.children[1];
    assert.equal(row.querySelector(".page-count-badge")?.textContent, "合集 25"); assert.equal(row.querySelector("button.track")?.hasAttribute("data-bvid"), false);
    assert.match(row.textContent!, /更新于/); assert.equal(h.observed.has(row), false); assert.equal(h.calls.some(c => c.command === "get_collection_page"), false);
    await fire(h, list.children[2].querySelector("button.track")!, "click", { detail: 0 });
    assert.deepEqual(h.store.getState().playbackQueue.queue.map(item => item.bvid), [data.snapshot.items[0].bvid, data.anchorBvid, data.snapshot.items[1].bvid]);
    assert.equal(h.store.getState().playbackQueue.currentIndex, 2); assert.equal(list.children[2].querySelector("button.track")?.getAttribute("aria-current"), "true");
    const queue = h.store.getState().playbackQueue.queue; let restored = -1; list.scrollTop = 117; list.scrollTo = options => { if (typeof options === "object") restored = options.top ?? -1; };
    const open = row.querySelector("button.track")!;
    await fire(h, open, "click", { detail: 1 }); await fire(h, open, "click", { detail: 2 }); await fire(h, open, "dblclick", { detail: 2 });
    assert.equal(h.calls.filter(c => c.command === "get_collection_page").length, 1); assert.equal(h.store.getState().playbackQueue.queue, queue);
    assert.equal(h.doc.querySelectorAll("#collection-results li").length, 20);
    gate.resolve(collectionPage({ ...data, title: "更新后的合集" })); await h.microtasks();
    assert.equal(h.doc.querySelector("#view-collection h1")?.textContent, "更新后的合集"); assert.equal(h.store.getState().playbackQueue.queue, queue);
    const collectionList = h.doc.querySelector<HTMLElement>("#collection-results")!; await fire(h, collectionList, "scroll");
    assert.equal(collectionList.children.length, 25); assert.match(h.doc.querySelector("#view-collection")!.textContent!, /没有更多了/);
    assert.equal(h.calls.filter(c => c.command === "get_collection_page").length, 1); assert.equal(h.store.getState().playbackQueue.queue, queue);
    await fire(h, collectionList.children[3].querySelector("button.track")!, "click", { detail: 0 });
    assert.equal(h.store.getState().playbackQueue.queueSource, "collection"); assert.equal(h.store.getState().playbackQueue.queue.length, 25);
    assert.equal(collectionList.children[3].querySelector("button.track")?.getAttribute("aria-current"), "true");
    await fire(h, h.doc.querySelector("#next-button")!, "click"); assert.equal(h.store.getState().playbackQueue.currentIndex, 4);
    await fire(h, button(h.doc.querySelector("#view-collection")!, "返回"), "click");
    assert.equal(h.store.getState().collection.active, false); assert.equal(h.doc.querySelector<HTMLElement>("#view-favorites")!.hidden, false); assert.equal(restored, 117);
    assert.equal(h.warnings.length, 0);
  } finally { h.dispose(); }
});

test("collection toolbar saves full snapshots and separates whole, split and single-video chooser intents", async () => {
  const h = await fixture(); try {
    const data = collection(3); let favorites: CommandContract.LibraryEntry[] = [];
    let playlists: CommandContract.Playlist[] = [{ id: "a", name: "歌单a", createdAt: "1", items: [] }]; let batch = 0;
    h.reply(async (command, args) => {
      if (command === "list_favorites") return favorites; if (command === "list_playlists") return playlists;
      if (["list_disabled_pages", "get_cached_video_pages"].includes(command)) return {}; if (command === "list_unavailable_tracks") return [];
      if (command === "get_collection_page") return collectionPage(data);
      if (command === "toggle_collection_favorite") { favorites = [collectionEntry(data)]; return { favorited: true, items: favorites }; }
      if (command === "add_collection_to_playlist") { playlists = [{ ...playlists[0], items: [collectionEntry(data, "playlist-reference")] }]; return playlists; }
      if (command === "add_collection_videos_to_playlist") { playlists = [{ ...playlists[0], items: [collectionEntry(data, "playlist-reference"), ...data.snapshot.items.map(videoEntry)] }]; return { playlists, added: batch++ ? 0 : 3, duplicates: batch === 1 ? 0 : 3 }; }
      return singleVideoReply(command, args);
    });
    await h.library.loadLibrary(); h.store.actions.collection.open({ kind: "collection", bvid: data.anchorBvid, id: 31 }, data.title, data.videoCount, "home", 0); await h.microtasks();
    const view = h.doc.querySelector("#view-collection")!;
    await fire(h, button(view, "收藏合集"), "click"); assert.equal(favorites[0].kind, "collection"); assert.equal(h.nodes.favoritesList.querySelector(".page-count-badge")?.textContent, "合集 3");
    const saved = h.calls.find(c => c.command === "toggle_collection_favorite")!.args.collection as CommandContract.LibraryCollection;
    assert.equal(saved.snapshot.items.length, 3); assert.notEqual(saved.snapshot.items, h.store.getState().collection.fullSnapshot?.snapshot.items);
    await fire(h, button(view, "加入歌单"), "click"); assert.equal(h.nodes.libraryModalTitle.textContent, "加入整个合集");
    await fire(h, h.doc.querySelector(".playlist-choice")!, "click"); assert.equal(h.store.getState().library.session.open, false);
    for (let i = 0; i < 2; i++) {
      await fire(h, button(view, "全部加入歌单（拆成单曲）"), "click"); assert.match(h.nodes.libraryModalTitle.textContent!, /加入 3 个视频（拆成单曲）/);
      await fire(h, h.doc.querySelector(".playlist-choice")!, "click");
    }
    assert.match(h.nodes.status.textContent!, /已加入 0 个视频，重复 3 个/);
    await fire(h, h.doc.querySelector('#collection-results [aria-label="加入歌单"]')!, "click");
    assert.match(h.nodes.libraryModal.textContent!, /加入单视频/); assert.equal(h.store.getState().library.session.data.collectionChoose, undefined);
    assert.equal(h.calls.filter(c => c.command === "get_collection_page").length, 1);
  } finally { h.dispose(); }
});

test("offline collection keeps its dated snapshot, retries only by hand and mixed drag order reloads by entryId", async () => {
  const h = await fixture(); try {
    const data = collection(3), saved = collectionEntry(data); let entries = [videoEntry(data.snapshot.items[0]), saved, videoEntry(data.snapshot.items[1])];
    let online = false;
    h.reply(async (command, args) => {
      if (command === "list_favorites") return entries; if (command === "list_playlists") return [];
      if (["list_disabled_pages", "get_cached_video_pages"].includes(command)) return {}; if (command === "list_unavailable_tracks") return [];
      if (command === "get_collection_page") { if (!online) throw Error("HTTP 412"); return collectionPage(data); }
      if (command === "update_collection_entry") return true;
      if (command === "reorder_favorite") { assert.deepEqual(args, { fromIndex: 1, toIndex: 0 }); entries = [saved, videoEntry(data.snapshot.items[0]), videoEntry(data.snapshot.items[1])]; return entries; }
      return singleVideoReply(command, args);
    });
    await h.library.loadLibrary(); h.store.actions.settings.navigate("favorites"); const list = h.nodes.favoritesList, original = list.children[1];
    const dataTransfer = transfer(); await fire(h, original, "dragstart", { dataTransfer }); await fire(h, list.children[0], "dragover", { dataTransfer }); await fire(h, list.children[0], "drop", { dataTransfer });
    assert.equal(list.children[0], original); await h.library.loadLibrary(); assert.equal(list.children[0], original);
    await h.advance(401); await fire(h, original.querySelector(".page-count-badge")!, "click", { detail: 0 });
    const view = h.doc.querySelector("#view-collection")!; assert.match(view.textContent!, /来源无法校验/); assert.match(view.textContent!, /本地快照 · 更新于/);
    assert.equal(h.store.getState().playbackQueue.queue.length, 0); assert.equal(h.calls.filter(c => c.command === "get_collection_page").length, 1);
    const select = view.querySelector("select")!; select.value = data.snapshot.items[1].bvid; online = true; await fire(h, select, "change");
    assert.equal(h.calls.filter(c => c.command === "get_collection_page").length, 2); assert.equal(h.store.getState().collection.usingSnapshot, false);
    assert.equal(h.calls.filter(c => c.command === "get_collection_page").at(-1)!.args.bvid, data.snapshot.items[1].bvid);
  } finally { h.dispose(); }
});

test("reordering mixed video entries preserves the playing queue and highlights the actual BV", async () => {
  const h = await fixture(); try {
    const data = collection(3), a = videoEntry(data.snapshot.items[0]), b = videoEntry(data.snapshot.items[1]), group = collectionEntry(data);
    let entries = [a, group, b];
    h.reply(async (command, args) => {
      if (command === "list_favorites") return entries; if (command === "list_playlists") return [];
      if (["list_disabled_pages", "get_cached_video_pages"].includes(command)) return {}; if (command === "list_unavailable_tracks") return [];
      if (command === "reorder_favorite") { assert.deepEqual(args, { fromIndex: 2, toIndex: 0 }); entries = [b, a, group]; return entries; }
      return singleVideoReply(command, args);
    });
    await h.library.loadLibrary(); const list = h.nodes.favoritesList;
    await fire(h, list.children[2].querySelector("button.track")!, "click", { detail: 0 }); const queue = h.store.getState().playbackQueue.queue;
    const dataTransfer = transfer(); await fire(h, list.children[2], "dragstart", { dataTransfer }); await fire(h, list.children[0], "dragover", { dataTransfer }); await fire(h, list.children[0], "drop", { dataTransfer });
    assert.equal(h.store.getState().playbackQueue.queue, queue); assert.equal(h.store.getState().playbackQueue.currentIndex, 2);
    assert.equal(list.children[0].querySelector("button.track")?.getAttribute("aria-current"), "true");
    assert.equal(list.children[1].querySelector("button.track")?.hasAttribute("aria-current"), false);
  } finally { h.dispose(); }
});

test("full snapshot paging expands only its matching queue and later refresh keeps the old queue frozen", async () => {
  const h = await fixture(); try {
    const data = collection(); h.reply(async (command, args) => command === "get_collection_page" ? collectionPage(data) : singleVideoReply(command, args));
    h.store.actions.collection.open({ kind: "collection", bvid: data.anchorBvid, id: 31 }, data.title, 25, "home", 0); await h.microtasks();
    let list = h.doc.querySelector<HTMLElement>("#collection-results")!;
    await fire(h, list.children[0].querySelector("button.track")!, "click", { detail: 0 });
    h.store.actions.playbackQueue.changeShuffle(true, () => 0.5);
    assert.equal(h.store.getState().playbackQueue.queue.length, 20);
    await fire(h, list, "scroll"); assert.equal(h.store.getState().playbackQueue.queue.length, 25); assert.equal(h.store.getState().playbackQueue.randomRemaining.length, 24);
    const queue = h.store.getState().playbackQueue.queue, queueVersion = h.store.getState().playbackQueue.queueSearchVersion;
    await fire(h, button(h.doc.querySelector("#view-collection")!, "刷新合集"), "click");
    assert.equal(h.store.getState().playbackQueue.queue, queue); assert.notEqual(h.store.getState().collection.requestVersion, queueVersion);
    list = h.doc.querySelector<HTMLElement>("#collection-results")!; await fire(h, list, "scroll");
    assert.equal(h.store.getState().playbackQueue.queue, queue); assert.equal(h.calls.filter(c => c.command === "get_collection_page").length, 2);
  } finally { h.dispose(); }
});
