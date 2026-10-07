import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/app-state.ts";
import type { HomeAdapter } from "../ui/app-state.ts";
import type { LibrarySnapshot } from "../ui/library-state.ts";

const track = (n: number) => ({ bvid: "BV" + String(n).padStart(10, "0"), title: "曲目" + n, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: 1 });
const playlist = (id: string, items = [track(1)]) => ({ id, name: id, items, createdAt: 1, updatedAt: 1 });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const calls: { command: string; args: unknown }[] = [], reports: unknown[][] = [];
  let reply: (command: string, args: unknown) => Promise<unknown> = async command => command === "list_favorites" ? [track(1)] : command === "list_playlists" ? [playlist("a"), playlist("b")] : command === "list_disabled_pages" ? {} : [];
  const adapter: HomeAdapter = { invoke: ((command: string, args: unknown) => { calls.push({ command, args }); return reply(command, args); }) as HomeAdapter["invoke"], setTimeout: () => 0, clearTimeout() {}, report(...args) { reports.push(args); } };
  const store = createApplicationStore(adapter, { freeze: true, onSubscriberError: error => reports.push([error]) });
  return { store, actions: store.actions.library, read: () => store.getState().library, calls, reports, reply(next: typeof reply) { reply = next; } };
}

test("library actions load without DOM in one immutable phase and isolate other domains", async () => {
  assert.equal("document" in globalThis, false); assert.equal("window" in globalThis, false);
  const h = fixture(), before = h.store.getState(), phases: LibrarySnapshot[] = [];
  h.store.subscribe(state => phases.push(state.library)); h.store.subscribe(() => { throw Error("subscriber"); });
  await h.actions.loadLibrary(() => {});
  assert.equal(phases.length, 1); assert.equal(h.reports.length, 1);
  assert.equal(before.library.favorites.length, 0); assert.equal(h.read().favoriteBvids.has(track(1).bvid.toLowerCase()), true);
  assert.equal(h.read().selectedPlaylistId, "a"); assert.equal(h.store.getState().home, before.home); assert.equal(h.store.getState().search, before.search);
  assert.throws(() => (h.read().favoriteBvids as Set<string>).add("bad"), TypeError);
  assert.throws(() => (h.read().favorites as unknown as { title: string }[])[0].title = "bad", TypeError);
});

test("library actions never persist empty fallback after read errors", async () => {
  const h = fixture(); h.reply(async command => { if (command === "list_favorites") throw Error("坏文件"); return command === "list_disabled_pages" ? {} : []; });
  await h.actions.loadLibrary(() => {});
  assert.match(h.read().loadError, /坏文件/); assert.equal(h.read().favorites.length, 0);
  assert.deepEqual(h.calls.map(c => c.command), ["list_favorites", "list_playlists", "list_unavailable_tracks", "list_disabled_pages"]);
  h.reply(async () => { throw Error("拒绝写入"); }); await h.actions.toggleFavorite(track(1));
  assert.match(h.read().view.playbackStatus!, /拒绝写入/); assert.match(h.read().loadError, /坏文件/);
});

test("library actions copy unavailable maps and repair selected playlist outside rendering", async () => {
  const h = fixture(); await h.actions.loadLibrary(() => {}); const before = h.read();
  h.actions.markUnavailable("BV0000000001", "失效"); const marked = h.read();
  assert.equal(before.unavailableBvids.size, 0); assert.equal(marked.unavailableBvids.get("bv0000000001"), "失效");
  assert.equal(marked.favorites, before.favorites); assert.equal(h.actions.clearUnavailable("BV0000000001"), true);
  assert.equal(marked.unavailableBvids.size, 1); assert.equal(h.read().unavailableBvids.size, 0); assert.equal(h.actions.clearUnavailable("missing"), false);
  h.actions.choosePlaylist("b"); h.actions.showDelete(); h.reply(async () => [playlist("a")]); await h.actions.submitDelete();
  assert.equal(h.read().selectedPlaylistId, "a"); assert.equal(h.read().session.open, false); assert.equal(h.read().session.busy, false);
});

test("library name validation create rename add and duplicate actions preserve command contracts", async () => {
  const h = fixture(); await h.actions.loadLibrary(() => {}); h.calls.length = 0;
  h.actions.showName("create"); await h.actions.submitName("  "); await h.actions.submitName(" A ");
  assert.equal(h.calls.length, 0); assert.match(h.read().session.status, /同名/);
  h.reply(async command => command === "create_playlist" ? [playlist("a"), playlist("new", [])] : [playlist("a"), playlist("new")]);
  h.actions.showName("create", null, track(1)); await h.actions.submitName(" 新建 ");
  assert.deepEqual(h.calls.map(c => c.command), ["create_playlist", "add_to_playlist"]); assert.deepEqual(h.calls[0].args, { name: "新建" });
  assert.equal(h.read().selectedPlaylistId, "new"); assert.match(h.read().view.playbackStatus!, /已加入歌单/);
  h.actions.showChoose(track(1)); h.calls.length = 0; await h.actions.submitChoose("new");
  assert.equal(h.calls.length, 0); assert.match(h.read().session.status, /无需重复/);
  h.actions.showName("rename", h.read().playlists[0]); h.reply(async () => { throw Error("保存失败"); }); await h.actions.submitName("改名");
  assert.equal(h.read().session.open, true); assert.equal(h.read().session.busy, false); assert.match(h.read().session.status, /保存失败/);
  assert.deepEqual(h.calls[0].args, { id: "a", name: "改名" });
});

test("library favorite actions retain previous snapshots and failures do not change data", async () => {
  const h = fixture(); await h.actions.loadLibrary(() => {}); const before = h.read();
  h.reply(async () => ({ favorited: false, items: [] })); const result = await h.actions.toggleFavorite(track(1));
  assert.equal(result?.favorited, false); assert.equal(before.favorites.length, 1); assert.equal(h.read().favorites.length, 0);
  const current = h.read(); h.reply(async () => { throw Error("失败"); }); await h.actions.toggleFavorite(track(2));
  assert.equal(h.read().favorites, current.favorites); assert.equal(h.read().favoriteBvids, current.favoriteBvids);
});

test("library modal import versions discard closed and reopened responses and duplicate submissions", async () => {
  const h = fixture(), pending = deferred<unknown>(); h.reply(() => pending.promise); h.actions.showImport();
  const old = h.actions.submitImport("fixture", ""); await h.actions.submitImport("fixture", ""); assert.equal(h.calls.length, 1);
  h.actions.closeModal(); h.actions.showImport(); const reopened = h.read();
  pending.resolve({ title: "旧", total: 1, items: [track(1)], hasMore: false, skipped: 0, duplicates: 0, scanned: 1 }); await old;
  assert.equal(h.read(), reopened); assert.equal(h.read().session.data.firstPage, null);
});

test("library import page failure never saves partial tracks and permits retry", async () => {
  const h = fixture(); h.actions.showImport(); h.reply(async command => { if (command !== "read_public_favorite_page") throw Error("unexpected save"); return { title: "导入", total: 2, items: [track(1)], hasMore: true, skipped: 0, duplicates: 0, scanned: 1 }; });
  await h.actions.submitImport("fixture", ""); h.reply(async () => { throw Error("第二页失败"); }); await h.actions.submitImport("fixture", "名字");
  assert.equal(h.calls.some(c => c.command === "create_imported_playlist"), false); assert.equal(h.read().session.busy, false); assert.match(h.read().session.status, /未创建歌单/);
});

test("library reorder actions preserve old order on failure and publish success after persistence", async () => {
  for (const kind of ["favorites", "items", "playlists"] as const) {
    const h = fixture(); await h.actions.loadLibrary(() => {}); const before = h.read(); h.reply(async () => { throw Error("保存失败"); });
    const reorder = () => kind === "favorites" ? h.actions.reorderFavorites(0, 1) : kind === "items" ? h.actions.reorderPlaylistItems("a", 0, 1) : h.actions.reorderPlaylists(0, 1);
    await assert.rejects(reorder(), /保存失败/); assert.equal(h.read(), before);
    h.reply(async () => kind === "favorites" ? [track(2), track(1)] : [playlist("b"), playlist("a")]); await reorder();
    assert.equal(before.favorites[0].bvid, track(1).bvid); assert.equal(h.read().selectedPlaylistId, "a");
    assert.deepEqual(h.calls.at(-1)?.args, kind === "items" ? { id: "a", fromIndex: 0, toIndex: 1 } : { fromIndex: 0, toIndex: 1 });
  }
});
