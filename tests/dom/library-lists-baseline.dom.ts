import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, seed, track, playlist, deferred, responses, transfer, videoMeta } from "./library-lists-fixture.ts";

type Harness = Awaited<ReturnType<typeof fixture>>;
type Kind = "favorites" | "playlistItems" | "playlists";
function list(h: Harness, kind: Kind) { return kind === "favorites" ? h.nodes.favoritesList : kind === "playlistItems" ? h.nodes.playlistTracks : h.nodes.playlistsList; }
async function run(body: (h: Harness) => Promise<void>) { const h = await fixture(); try { await body(h); assert.equal(h.warnings.filter(args => String(args[0]).includes("Vue")).length, 0); } finally { h.dispose(); } }
for (const kind of ["favorites", "playlistItems", "playlists"] as const) {
  test(`library list DOM ${kind} structure selected state and static handles`, () => run(async h => {
    await seed(h, [{ ...track(1), thumbnailUrl: "https://example.invalid/cover.jpg", title: "<&>" }], [playlist("a"), playlist("b")]);
    const host = list(h, kind), row = host.children[0]; assert.equal(row.tagName, "LI"); assert.equal(row.getAttribute("draggable"), "true");
    if (kind === "playlists") { const button = row.querySelector("button")!; assert.equal(button.className, "playlist-card is-selected"); assert.equal(button.getAttribute("data-playlist-id"), "a"); assert.equal(button.querySelector("span")?.textContent, "歌单a"); assert.equal(button.querySelector("small")?.textContent, "2 首"); }
    else { assert.equal(row.className, "track-row"); assert.equal(row.querySelector("button.track")?.getAttribute("data-library-index"), "0"); assert.equal(row.querySelector(".track-play"), null); assert.equal(row.querySelector(".track-duration")?.textContent, "1:00"); assert.equal(row.querySelector(".favorite-button")?.textContent, "♥"); assert.equal(row.querySelector(".track-actions")?.lastElementChild?.textContent, kind === "favorites" ? "+" : "−"); }
  }));
  for (const outcome of ["success", "failure"] as const) test(`library list DOM ${kind} drag ${outcome} preserves visuals saving order and selection`, () => run(async h => {
    await seed(h); const host = list(h, kind), first = host.children[0], second = host.children[1], before = JSON.stringify(h.state());
    const data = transfer(); await h.fire(first, "dragstart", { dataTransfer: data }); assert.equal(first.classList.contains("is-dragging"), true); assert.equal(data.effectAllowed, "move"); assert.deepEqual(data.written, [["text/plain", "0"]]);
    const over = await h.fire(second, "dragover", { dataTransfer: data }); assert.equal(over.defaultPrevented, true); assert.equal(second.classList.contains("is-drop-after"), true);
    await h.fire(second, "dragleave", { relatedTarget: second.querySelector("button") }); assert.equal(second.classList.contains("is-drop-after"), true);
    await h.fire(second, "dragleave", { relatedTarget: h.doc.body }); assert.equal(second.classList.contains("is-drop-after"), false);
    await h.fire(second, "dragover", { dataTransfer: data });
    const gate = deferred(); h.reply(() => gate.promise); await h.fire(second, "drop", { dataTransfer: data });
    assert.equal(h.state().drags[kind].saving, true); assert.equal(first.classList.contains("is-dragging"), false); assert.equal(second.classList.contains("is-drop-after"), false);
    assert.equal((await h.fire(first, "dragstart", { dataTransfer: transfer() })).defaultPrevented, true); assert.equal(h.calls.length, 1);
    if (outcome === "failure") gate.reject(Error("保存失败")); else gate.resolve(kind === "favorites" ? [track(2), track(1)] : kind === "playlistItems" ? [playlist("a", [track(2), track(1)]), playlist("b")] : [playlist("b"), playlist("a")]);
    await h.microtasks(); assert.equal(h.state().drags[kind].saving, false); assert.equal(h.state().selectedPlaylistId, "a");
    const firstLabel = host.children[0].querySelector(kind === "playlists" ? ".playlist-card span" : ".track-title")?.textContent;
    assert.equal(firstLabel, kind === "playlists" ? outcome === "success" ? "歌单b" : "歌单a" : outcome === "success" ? "曲目2" : "曲目1");
    if (outcome === "failure") assert.equal(h.warnings.some(args => String(args[0]).includes("reorder failed")), true);
  }));
  test(`library list DOM ${kind} same-target drop and dragend renew suppression until 400ms`, () => run(async h => {
    await seed(h); const row = list(h, kind).children[0]; await h.fire(row, "dragstart", { dataTransfer: transfer() }); await h.fire(row, "drop", { dataTransfer: transfer() }); assert.equal(h.calls.length, 0);
    h.time(1200); await h.fire(row, "dragend"); h.time(1599); assert.equal((await h.fire(row.querySelector("button")!, "click", { detail: 0 })).defaultPrevented, true);
    h.time(1600); h.reply(responses()); assert.equal((await h.fire(row.querySelector("button")!, "click", { detail: 0 })).defaultPrevented, false);
  }));
}
for (const source of ["favorites", "playlist"] as const) {
  test(`library list DOM ${source} highlight retains exact queue source and playlist identity`, () => run(async h => {
    await seed(h); const host = source === "favorites" ? h.nodes.favoritesList : h.nodes.playlistTracks;
    h.store.actions.playbackQueue.replaceQueue([track(1), track(2)], source, null, source === "playlist" ? "a" : null); h.store.actions.playbackQueue.selectIndex(1, false, null); h.core.updateQueueUi();
    assert.equal(host.children[1].querySelector("button.track")?.getAttribute("aria-current"), "true");
    h.store.actions.playbackQueue.replaceQueue([track(1)], source === "favorites" ? "ranking" : "playlist", null, "b"); h.core.updateQueueUi(); assert.equal(host.querySelectorAll('[aria-current="true"]').length, 0);
  }));
  for (const mode of ["single", "double", "keyboard"] as const) test(`library list DOM ${source} ${mode} activation keeps pages and 250ms boundary`, () => run(async h => {
    await seed(h); h.reply(responses()); const host = source === "favorites" ? h.nodes.favoritesList : h.nodes.playlistTracks, button = host.children[0].querySelector("button.track")!;
    await h.fire(button, "click", { detail: mode === "keyboard" ? 0 : 1 });
    if (mode === "single") { await h.advance(249); assert.equal(h.calls.filter(c => c.command === "prepare_audio").length, 0); await h.advance(1); }
    if (mode === "double") { await h.fire(button, "click", { detail: 2 }); await h.fire(button, "dblclick", { detail: 2 }); await h.advance(250); assert.equal(h.nodes.pagesModal.hidden, false); }
    assert.equal(h.calls.filter(c => c.command === "prepare_audio").length, mode === "double" ? 0 : 1);
  }));
  test(`library list DOM ${source} action and badge clicks do not bubble to play`, () => run(async h => {
    await seed(h); h.store.actions.pages.remember(track(1).bvid, videoMeta); const host = source === "favorites" ? h.nodes.favoritesList : h.nodes.playlistTracks;
    h.reply(async command => command === "toggle_favorite" ? { items: [track(1), track(2)], favorited: true } : command === "remove_from_playlist" ? [playlist("a"), playlist("b")] : responses()(command));
    for (const selector of [".favorite-button", source === "favorites" ? '[aria-label="加入歌单"]' : '[aria-label="从歌单移除"]', ".page-count-badge"]) {
      const button = host.querySelector(selector)!; let bubbled = 0; const watch = () => bubbled++; h.window.addEventListener("click", watch);
      await h.fire(button, "click", { detail: 1 }); await h.fire(button, "dblclick", { detail: 2 }); await h.advance(250); h.window.removeEventListener("click", watch);
      assert.equal(bubbled, 0); assert.equal(h.calls.filter(c => c.command === "prepare_audio").length, 0); h.store.actions.library.closeModal(); h.store.actions.pages.close();
    }
  }));
}
test("library list DOM empty and failed reads keep empty hosts and original text", () => run(async h => {
  await seed(h, [], []); for (const host of [h.nodes.favoritesList, h.nodes.playlistTracks, h.nodes.playlistsList]) { assert.equal(host.innerHTML, ""); assert.equal(host.matches(":empty"), true); }
  assert.equal(h.nodes.favoritesStatus.textContent, "收藏的歌曲会显示在这里。"); assert.equal(h.nodes.playlistsStatus.textContent, "还没有歌单。");
  h.reply(async command => { if (command === "list_favorites") throw Error("坏文件"); return command === "list_disabled_pages" ? {} : []; }); await h.library.loadLibrary(); assert.match(h.nodes.favoritesStatus.textContent, /坏文件/); assert.equal(h.nodes.favoritesList.innerHTML, "");
}));
test("library list DOM switching playlists changes selected card tracks and action shell", () => run(async h => {
  await seed(h, [], [playlist("a"), playlist("b", [track(3)])]); await h.fire(h.nodes.playlistsList.children[1].querySelector("button")!, "click", { detail: 0 });
  assert.equal(h.state().selectedPlaylistId, "b"); assert.equal(h.nodes.playlistTracks.querySelector(".track-title")?.textContent, "曲目3"); assert.equal(h.nodes.playlistsList.children[1].querySelector("button")?.classList.contains("is-selected"), true); assert.equal(h.nodes.playlistTitle.textContent, "歌单b"); assert.equal(h.nodes.playlistActions.hidden, false);
}));
test("library list DOM unavailable markers and badges retain content refresh timing", () => run(async h => {
  await seed(h); h.store.actions.library.markUnavailable(track(1).bvid, "不可用");
  assert.equal(h.nodes.favoritesList.querySelector(".track-unavailable"), null); h.store.actions.library.refreshViews();
  for (const host of [h.nodes.favoritesList, h.nodes.playlistTracks]) { assert.equal(host.children[0].classList.contains("is-unavailable"), true); assert.equal(host.querySelector(".track-unavailable")?.textContent, "!"); }
  h.store.actions.pages.remember(track(1).bvid, videoMeta); for (const host of [h.nodes.favoritesList, h.nodes.playlistTracks]) assert.equal(host.querySelector(".track-actions")?.firstElementChild?.textContent, "2P");
}));
