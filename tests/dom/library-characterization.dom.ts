import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./library-characterization-fixture.ts";

function deferred() { let resolve: (value: unknown) => void = () => {}; let reject: (error: unknown) => void = () => {}; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const track = (i: number) => ({ bvid: "BV" + String(i).padStart(10, "0"), title: "曲目" + i, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: "2026-01-01" });
const playlist = (id: string, items = [track(1), track(2)]) => ({ id, name: "歌单" + id, items, createdAt: "2026-01-01" });
async function seed(h: Awaited<ReturnType<typeof fixture>>, favorites = [track(1), track(2)], playlists = [playlist("a"), playlist("b")]) {
  h.reply(async command => command === "list_favorites" ? favorites : command === "list_playlists" ? playlists : command === "list_disabled_pages" ? {} : []);
  await h.library.loadLibrary(); h.calls.length = 0;
}

test("library playlist create rename delete validate names and repair selected playlist", async () => {
  const h = await fixture(); try {
    await seed(h); h.library.createPlaylist(); h.input().value = "  "; await h.primary().fire("click"); assert.match(h.nodes.libraryModalStatus.textContent, /不能为空/); assert.equal(h.calls.length, 0);
    h.input().value = "歌单a"; await h.primary().fire("click"); assert.match(h.nodes.libraryModalStatus.textContent, /同名/); assert.equal(h.calls.length, 0);
    h.input().value = "新歌单"; h.reply(async (_c, args) => [playlist("a"), playlist("b"), { ...playlist("c"), name: args.name }]); await h.primary().fire("click"); assert.equal(h.state().selectedPlaylistId, "c"); assert.deepEqual(h.calls[0], { command: "create_playlist", args: { name: "新歌单" } });
    h.library.renameSelectedPlaylist(); h.input().value = "改名"; h.reply(async () => [playlist("a"), playlist("b"), { ...playlist("c"), name: "改名" }]); await h.primary().fire("click"); assert.deepEqual(h.calls[1], { command: "rename_playlist", args: { id: "c", name: "改名" } });
    h.library.deleteSelectedPlaylist(); h.reply(async () => [playlist("b")]); await h.primary().fire("click"); assert.equal(h.state().selectedPlaylistId, "b"); assert.deepEqual(h.calls[2], { command: "delete_playlist", args: { id: "c" } });
    h.library.deleteSelectedPlaylist(); h.reply(async () => []); await h.primary().fire("click"); assert.equal(h.state().selectedPlaylistId, "");
  } finally { h.dispose(); }
});
test("library add chooser prevents duplicates and creates then adds a new playlist", async () => {
  const h = await fixture(); try {
    await seed(h); h.library.choosePlaylistAndAdd(track(1)); const choices = h.nodes.libraryModalBody.querySelectorAll(".playlist-choice"); await choices[0].fire("click"); assert.match(h.nodes.libraryModalStatus.textContent, /无需重复/); assert.equal(h.calls.length, 0);
    h.library.choosePlaylistAndAdd(track(3)); h.input().value = "新建并加入";
    h.reply(async command => command === "create_playlist" ? [playlist("a"), { ...playlist("c", []), name: "新建并加入" }] : [playlist("a"), { ...playlist("c", [track(3)]), name: "新建并加入" }]);
    await h.primary().fire("click"); assert.deepEqual(h.calls.map(c => c.command), ["create_playlist", "add_to_playlist"]); assert.equal(h.calls[1].args.id, "c"); assert.equal(h.state().selectedPlaylistId, "c"); assert.equal(h.state().playlists[1].items[0].bvid, track(3).bvid); assert.equal(h.nodes.status.textContent, "已加入歌单“新建并加入”。");
  } finally { h.dispose(); }
});
test("library modal preserves animation and existing focus behavior including loudness explanation", async () => {
  const h = await fixture(); try {
    h.nodes.createPlaylistButton.focus(); const opener = h.doc.activeElement; h.library.createPlaylist(); const input = h.input(); assert.equal(h.doc.activeElement, input); assert.equal(h.nodes.libraryModal.hidden, false); await h.flush(); assert.equal(h.nodes.libraryModal.classList.contains("is-open"), true);
    h.library.closeLibraryModal(); assert.equal(h.nodes.libraryModal.getAttribute("aria-hidden"), "true"); assert.equal(h.doc.activeElement, opener, "close restores opener focus"); assert.notEqual(h.doc.activeElement, input); assert.equal(h.nodes.libraryModal.hidden, false);
    await h.nodes.libraryModal.fire("transitionend"); assert.equal(h.nodes.libraryModal.hidden, true);
    h.core.showLoudnessNormalizationDialog(); assert.equal(h.nodes.libraryModalTitle.textContent, "响度归一化"); assert.equal(h.nodes.libraryModalBody.children.length, 5); assert.equal(h.doc.activeElement.textContent, "知道了"); await h.doc.activeElement.fire("click"); assert.equal(h.nodes.libraryModal.classList.contains("is-open"), false);
  } finally { h.dispose(); }
});
test("library favorite import closes and reopens with request isolation and no partial saves", async () => {
  const h = await fixture(); try {
    const old = deferred(); h.reply(() => old.promise); h.library.importFavoritePlaylist(); h.input().value = "收藏夹一"; const pending = h.primary().fire("click"); await h.flush(); h.library.closeLibraryModal(); h.library.importFavoritePlaylist();
    h.reply(async () => ({ title: "最新收藏夹", total: 1, items: [track(1)], skipped: 0, duplicates: 0, scanned: 1, hasMore: false, truncated: false })); h.input().value = "收藏夹二"; await h.primary().fire("click"); const current = h.nodes.libraryModalStatus.textContent;
    old.resolve({ title: "旧收藏夹", total: 0, items: [], skipped: 0, duplicates: 0, scanned: 0, hasMore: false, truncated: false }); await pending; assert.equal(h.nodes.libraryModalStatus.textContent, current); assert.equal(h.calls.filter(c => c.command === "create_imported_playlist").length, 0);
    h.reply(async (_c, args) => ({ id: "imported", name: args.name, items: args.tracks, createdAt: "2026-01-01" })); await h.primary().fire("click"); assert.equal(h.state().selectedPlaylistId, "imported"); assert.equal(h.state().playlists.length, 1);
  } finally { h.dispose(); }
});
