import { libraryVideos } from "../../ui/features/library/library-entry.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fixture as realFixture, deferred } from "./library-lists-fixture.ts";

type Transfer = { effectAllowed: string; dropEffect: string; setData(type: string, value: string): void };
type Fired = HTMLElement & { fire(type: string, fields?: { dataTransfer?: Transfer | null }): Promise<Event>; readonly children: HTMLCollectionOf<Fired> };
const track = (i: number) => ({ bvid: "BV" + String(i).padStart(10, "0"), title: "曲目" + i, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: "2026-01-01" });
const playlist = (id: string, items = [track(1), track(2)]) => ({ id, name: "歌单" + id, items, createdAt: "2026-01-01" });

async function fixture() {
  const source = path.resolve(import.meta.dirname, "../../ui");
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, "platform/main-window-refs.ts"), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean); assert.ok(names);
  for (const name of ["features/pages/video-pages.ts", "features/settings/appearance.ts", "features/playback/playback-notice.ts", "features/playback/playback-diagnostics.ts"]) {
    const exports = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, name), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean); assert.ok(exports);
  }
  const h = await realFixture();
  Object.defineProperty(h.window.HTMLElement.prototype, "fire", { configurable: true, value: async function(this: HTMLElement, type: string, fields = {}) {
    const start = h.requests.length, event = await h.fire(this, type, type === "click" ? { ...fields, detail: 0 } : fields);
    await Promise.allSettled(h.requests.slice(start)); await h.microtasks(); return event;
  } });
  return { ...h, nodes: h.nodes as unknown as { [K in keyof typeof h.nodes]: typeof h.nodes[K] extends HTMLElement ? Fired & Omit<typeof h.nodes[K], "children"> : typeof h.nodes[K] }, async flush() { await h.microtasks(); h.raf(); await h.microtasks(); } };
}
async function seed(h: Awaited<ReturnType<typeof fixture>>, favorites = [track(1), track(2)], playlists = [playlist("a"), playlist("b")]) {
  h.reply(async command => command === "list_favorites" ? favorites : command === "list_playlists" ? playlists : command === "list_disabled_pages" ? {} : []);
  await h.library.loadLibrary(); h.calls.length = 0;
}
const transfer = (): Transfer => ({ effectAllowed: "", dropEffect: "", setData() {} });

test("library reads favorites playlists and indexes without writing back after read failures", async () => {
  const h = await fixture(); try {
    await seed(h); assert.equal(h.state().favoriteBvids.has(track(1).bvid.toLowerCase()), true); assert.equal(h.state().selectedPlaylistId, "a"); assert.equal(h.nodes.favoritesCount.textContent, "2 首");
    h.reply(async command => { if (command === "list_favorites") throw Error("坏文件"); return command === "list_disabled_pages" ? {} : []; });
    await h.library.loadLibrary(); assert.match(h.state().loadError, /坏文件/); assert.equal(h.state().favorites.length, 0); assert.equal(h.state().playlists.length, 0);
    assert.deepEqual(h.calls.map(c => c.command).sort(), ["list_disabled_pages", "list_favorites", "list_playlists", "list_unavailable_tracks"].sort());
    await seed(h); assert.equal(h.state().loadError, ""); assert.equal(h.state().favorites.length, 2);
  } finally { h.dispose(); }
});
test("library favorite add remove and failure publish existing mini events only after results", async () => {
  const h = await fixture(); try {
    await seed(h); const gate = deferred(); h.reply(() => gate.promise); const pending = h.library.toggleFavorite(track(3)); await h.flush(); assert.equal(h.events.length, 0);
    gate.resolve({ items: [track(3)], favorited: true }); await pending;
    assert.deepEqual(h.events, [{ type: "bilibili-music-favorite-change", detail: { bvid: track(3).bvid, title: track(3).title, favorited: true } }]);
    assert.equal(h.state().favoriteBvids.has(track(3).bvid.toLowerCase()), true); assert.equal(h.nodes.status.textContent, "已加入收藏。");
    h.events.length = 0; h.reply(async () => ({ items: [], favorited: false })); await h.library.toggleFavorite(track(3)); assert.equal(h.events.length, 1); assert.deepEqual(h.events[0].detail, { bvid: track(3).bvid, title: track(3).title, favorited: false });
    h.events.length = 0; h.reply(async () => { throw Error("写入失败"); }); await h.library.toggleFavorite(track(3)); assert.deepEqual(h.events[0].detail, { bvid: track(3).bvid, title: track(3).title, failed: true }); assert.equal(h.state().favorites.length, 0);
  } finally { h.dispose(); }
});
test("library playback failure marks unavailable and successful retry clears through existing playback", async () => {
  const h = await fixture(); try {
    await seed(h, [track(1)], []); h.reply(async command => { if (command === "prepare_audio") throw Error("failed with code 62002"); return command === "get_video_pages" ? [{ page: 1, cid: 1, part: "P1", durationSeconds: 60 }] : []; });
    h.core.playListItem("favorites", libraryVideos(h.state().favorites), 0); await h.flush(); assert.equal(h.state().unavailableBvids.get(track(1).bvid.toLowerCase()), "该视频已被删除或设为私密"); assert.equal(h.calls.some(c => c.command === "mark_track_unavailable"), true);
    h.reply(async command => command === "prepare_audio" ? { audioUrl: "http://127.0.0.1/audio/fixture", title: "恢复", uploader: "作者", thumbnailUrl: "", durationSeconds: 60 } : command === "get_video_pages" ? [{ page: 1, cid: 1, part: "P1", durationSeconds: 60 }] : []);
    h.core.playListItem("playlist", libraryVideos(h.state().favorites), 0); await h.flush(); assert.equal(h.state().unavailableBvids.has(track(1).bvid.toLowerCase()), false, h.calls.map(c => c.command).join(",")); assert.equal(h.calls.some(c => c.command === "clear_track_unavailable"), true);
  } finally { h.dispose(); }
});
for (const kind of ["favorites", "playlistItems", "playlists"] as const) for (const outcome of ["success", "failure"] as const) {
  test(`library ${kind} drag ${outcome} preserves ordering duplicate save guard and 400ms click suppression`, async () => {
    const h = await fixture(); try {
      await seed(h); const list = kind === "favorites" ? h.nodes.favoritesList : kind === "playlistItems" ? h.nodes.playlistTracks : h.nodes.playlistsList;
      const original = JSON.stringify(kind === "favorites" ? h.state().favorites : h.state().playlists); const first = list.children[0], second = list.children[1];
      const gate = deferred(); h.reply(() => gate.promise); await first.fire("dragstart", { dataTransfer: transfer() }); const dropping = second.fire("drop", { dataTransfer: transfer() }); await h.flush();
      assert.equal(h.calls.length, 1); assert.equal(JSON.stringify(kind === "favorites" ? h.state().favorites : h.state().playlists), original, "visible order stays until persistence succeeds");
      assert.equal((await first.fire("dragstart", { dataTransfer: transfer() })).defaultPrevented, true); await second.fire("drop", { dataTransfer: transfer() }); assert.equal(h.calls.length, 1);
      if (outcome === "failure") gate.reject(Error("保存失败")); else gate.resolve(kind === "favorites" ? [track(2), track(1)] : kind === "playlistItems" ? [playlist("a", [track(2), track(1)]), playlist("b")] : [playlist("b"), playlist("a")]);
      await dropping; if (outcome === "failure") assert.equal(JSON.stringify(kind === "favorites" ? h.state().favorites : h.state().playlists), original); else assert.notEqual(JSON.stringify(kind === "favorites" ? h.state().favorites : h.state().playlists), original);
      assert.equal(h.state().selectedPlaylistId, "a"); assert.equal((await list.children[0].fire("click")).defaultPrevented, true); h.time(1399); assert.equal((await list.children[0].fire("click")).defaultPrevented, true); h.time(1400); assert.equal((await list.children[0].fire("click")).defaultPrevented, false);
      const command = kind === "favorites" ? "reorder_favorite" : kind === "playlistItems" ? "reorder_playlist_item" : "reorder_playlist"; assert.deepEqual(h.calls[0], { command, args: { ...(kind === "playlistItems" ? { id: "a" } : {}), fromIndex: 0, toIndex: 1 } });
    } finally { h.dispose(); }
  });
}
