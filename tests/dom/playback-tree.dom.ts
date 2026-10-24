import assert from "node:assert/strict";
import { test } from "node:test";
import { playbackFixture, track } from "./playback-ui-fixture.ts";
import { responses } from "./tracks-fixture.ts";

test("list commits repaint only affected highlights favorites and page metadata", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const items = Array.from({ length: 20 }, (_, index) => track(index + 1));
  const onePage = { videos: 1, pages: [{ cid: 11, page: 1, part: "一", duration: 60 }] };
  h.reply(async command => command === "get_video_meta" ? onePage : command === "get_video_pages" ? onePage.pages.map(page => ({ ...page, durationSeconds: page.duration })) : responses(items)(command));
  h.home.setHomeMode("ranking"); await h.microtasks();
  for (const video of items) h.store.actions.pages.remember(video.bvid, onePage);
  h.core.playListItem("ranking", items, 0); await h.microtasks();
  let previous = h.store.getState(), rows = h.rowRenders.length;
  const commits: { scenario: string; slices: string[]; rows: typeof h.rowRenders }[] = [];
  let scenario = "progress";
  t.after(h.store.subscribe(snapshot => {
    const keys = Object.keys(snapshot) as (keyof typeof snapshot)[];
    commits.push({ scenario, slices: keys.filter(key => snapshot[key] !== previous[key]), rows: h.rowRenders.slice(rows) });
    previous = snapshot; rows = h.rowRenders.length;
  }));
  for (let index = 1; index <= 100; index++) h.store.actions.playbackDisplay.observeProgress({ ...h.media, currentTime: index / 10 });
  assert.equal(commits.flatMap(commit => commit.rows).length, 0);
  const highlight = async (name: string, action: () => void) => {
    scenario = name; const start = commits.length; action(); await h.microtasks();
    const affected = commits.slice(start).flatMap(commit => commit.rows).filter(row => row.list === "home-ranking-list");
    assert.equal(affected.length, 2, JSON.stringify(commits.slice(start)));
    for (const commit of commits.slice(start)) assert.ok(commit.rows.length <= 2, JSON.stringify(commit));
  };
  await highlight("same-list", () => h.core.playListItem("ranking", items, 1));
  await highlight("next", () => h.dispatch(h.node("next-button"), "click"));
  await highlight("previous", () => h.dispatch(h.node("previous-button"), "click"));
  scenario = "favorite"; const favoriteStart = commits.length;
  h.reply(async command => command === "toggle_favorite" ? { favorited: true, items: [items[4]] } : responses(items)(command));
  await h.store.actions.library.toggleFavorite(items[4]);
  const favoriteRows = commits.slice(favoriteStart).flatMap(commit => commit.rows).filter(row => row.list === "home-ranking-list");
  assert.deepEqual(favoriteRows.map(row => row.bvid), [items[4].bvid]);
  scenario = "metadata"; const metadataStart = commits.length;
  h.store.actions.pages.remember(items[5].bvid, { videos: 2, pages: onePage.pages });
  assert.deepEqual(commits.slice(metadataStart).flatMap(commit => commit.rows).map(row => row.bvid), [items[5].bvid]);
  scenario = "new-search"; const searchStart = commits.length;
  h.nodes.searchKeyword.value = "新搜索"; await h.search.runSearch();
  assert.equal(commits.slice(searchStart).flatMap(commit => commit.rows).filter(row => row.list === null).length, items.length);
  scenario = "other-source"; const sourceStart = commits.length;
  h.core.playListItem("search", h.store.getState().search.results, 2); await h.microtasks();
  assert.equal(h.store.getState().playbackQueue.queueSource, "search");
  assert.deepEqual(commits.slice(sourceStart).flatMap(commit => commit.rows).filter(row => row.list === "home-ranking-list").map(row => row.bvid), [items[1].bvid]);
  for (const name of ["progress", "same-list", "next", "previous", "favorite", "metadata", "new-search", "other-source"]) {
    const selected = commits.filter(commit => commit.scenario === name);
    assert.ok(selected.length > 0, name);
    t.diagnostic(JSON.stringify({ scenario: name, commits: selected }));
  }
});

test("all list sources retain row props for highlights and favorite refreshes", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const items = Array.from({ length: 20 }, (_, index) => track(index + 1));
  h.reply(async command => command === "list_favorites" ? items.slice(0, -1) : command === "list_playlists" ? [{ id: "test", name: "歌单", items }] : command === "list_unavailable_tracks" ? [] : responses(items)(command));
  h.home.setHomeMode("ranking"); await h.microtasks();
  h.nodes.searchKeyword.value = "共享列表"; await h.search.runSearch();
  await h.store.actions.library.loadLibrary();
  for (const [source, list] of [["ranking", "home-ranking-list"], ["search", "search-results"], ["favorites", "favorites-list"], ["playlist", "playlist-tracks"]]) {
    h.store.actions.playbackQueue.replaceQueue(items, source, h.store.getState().search.requestVersion, source === "playlist" ? "test" : null);
    h.store.actions.playbackQueue.selectIndex(0, false, null);
    const start = h.rowRenders.length;
    h.store.actions.playbackQueue.selectIndex(1, false, null);
    assert.deepEqual(h.rowRenders.slice(start), [{ list, bvid: items[0].bvid }, { list, bvid: items[1].bvid }]);
  }
  h.reply(async command => command === "toggle_favorite" ? { favorited: true, items: items.map(item => ({ ...item })) } : responses(items)(command));
  const start = h.rowRenders.length;
  await h.store.actions.library.toggleFavorite(items[19]);
  const changed = h.rowRenders.slice(start);
  assert.equal(changed.length, 4);
  assert.ok(changed.every(row => row.bvid === items[19].bvid), JSON.stringify(changed));
});

test("playback tree commits synchronously while all unrelated lists skip 100 progress updates", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  h.reply(responses(Array.from({ length: 1000 }, (_, index) => track(index + 1))));
  h.home.setHomeMode("ranking"); await h.microtasks();
  assert.equal(h.nodes.homeRankingList!.children.length, 1000);
  const audio = h.audio, controls = h.node("progress-slider"), listenerCount = h.listeners.filter(entry => entry.target === audio).length;
  Object.assign(h.renderCounts, { TrackList: 0, TrackRow: 0, PlaylistList: 0 });
  for (let index = 1; index <= 100; index++) {
    h.store.actions.playbackDisplay.observeProgress({ ...h.media, currentTime: index / 10 });
    assert.equal((controls as HTMLInputElement).value, String(index / 10));
    assert.equal(h.doc.getElementById("audio"), audio);
    assert.equal(h.doc.getElementById("progress-slider"), controls);
    assert.equal(h.listeners.filter(entry => entry.target === audio).length, listenerCount);
  }
  assert.deepEqual(h.renderCounts, { TrackList: 0, TrackRow: 0, PlaylistList: 0 });
});

test("lyrics tree keeps offset limits candidate binding and manual input ownership", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  h.reply(async command => command === "resolve_lyrics" ? { status: "candidates", candidates: [{ song_id: "selected", name: "候选", singer: "作者", duration: 180 }], lyrics: null } : null);
  h.window.dispatchEvent(new h.window.CustomEvent("bili-track-changed", { detail: { bvid: track(1).bvid, cid: 11 } })); await h.microtasks();
  const candidate = h.doc.querySelector<HTMLButtonElement>(".lyrics-candidate")!;
  h.dispatch(candidate, "click"); await h.microtasks();
  assert.deepEqual(h.calls.find(call => call.command === "set_lyrics_binding")?.args, { bvid: track(1).bvid, cid: 11, songId: "selected", songName: "候选", singer: "作者" });
  for (let index = 0; index < 61; index++) h.dispatch(h.node("lyrics-offset-plus"), "click");
  assert.equal(h.node("lyrics-offset-value").textContent, "+30.0s");
  for (let index = 0; index < 121; index++) h.dispatch(h.node("lyrics-offset-minus"), "click");
  assert.equal(h.node("lyrics-offset-value").textContent, "-30.0s");
  const draft = h.node<HTMLInputElement>("lyrics-manual-input"); draft.value = "输入法草稿";
  h.store.actions.lyricsDisplay.setIdle(true); h.store.actions.playbackMessages.setStatus("同步消息");
  assert.equal(draft.value, "输入法草稿"); assert.equal(h.doc.getElementById("lyrics-manual-input"), draft);
});

test("both playback surfaces invoke favorite and playlist callbacks exactly once", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  let favorited = false;
  h.reply(async command => {
    if (command === "toggle_favorite") { favorited = !favorited; return { favorited, items: favorited ? [track(1)] : [] }; }
    return responses()(command);
  });
  h.core.playListItem("ranking", [track(1)], 0); await h.microtasks();
  for (const [index, id] of ["favorite-current-button", "immersive-favorite-button"].entries()) {
    h.dispatch(h.node(id), "click"); await h.microtasks();
    assert.equal(h.calls.filter(call => call.command === "toggle_favorite").length, index + 1);
    assert.equal(h.node("favorite-current-button").classList.contains("is-favorited"), favorited);
    assert.equal(h.node("immersive-favorite-button").classList.contains("is-favorited"), favorited);
  }
  for (const id of ["add-playlist-current-button", "immersive-add-playlist-button"]) {
    h.dispatch(h.node(id), "click");
    assert.equal(h.store.getState().library.session.kind, "choose");
    assert.equal(h.store.getState().library.session.data.track?.bvid, track(1).bvid);
    h.dispatch(h.node("close-library-modal-button"), "click");
  }
});

test("playlist navigation separates sidebar details and overview and returns after deleting", async t => {
  const { fixture } = await import("./tracks-fixture.ts");
  const h = await fixture({ playback: true }); t.after(h.dispose);
  const a = { id: "a", name: "清晨", items: [track(1)], createdAt: "0" };
  const b = { id: "b", name: "夜晚", items: [track(2)], createdAt: "0" };
  let playlists = [a, b];
  h.reply(async command => command === "list_playlists" ? playlists : command === "delete_playlist" ? (playlists = [a]) : command === "create_playlist" ? (playlists = [a, b]) : command === "list_favorites" || command === "list_unavailable_tracks" ? [] : command === "list_disabled_pages" ? {} : responses()(command));
  await h.store.actions.library.loadLibrary();
  const detail = h.doc.querySelector<HTMLElement>(".playlist-detail")!;
  const directory = h.doc.querySelector<HTMLElement>(".playlist-directory-surface")!;
  assert.equal(h.store.getState().settings.session.currentView, "home");
  await h.fire(h.doc.querySelectorAll(".sidebar-playlist")[1], "click");
  assert.equal(h.store.getState().settings.session.currentView, "playlists");
  assert.equal(h.store.getState().library.selectedPlaylistId, "b");
  assert.equal(detail.hidden, false); assert.equal(directory.hidden, true);
  assert.equal(h.doc.querySelector('.sidebar-playlist[aria-current="page"]')?.textContent, "夜晚1 首");
  await h.fire(h.doc.querySelector('[data-view="playlists"]')!, "click");
  assert.equal(detail.hidden, true); assert.equal(directory.hidden, false);
  await h.fire(h.doc.querySelector('.playlist-card[data-playlist-id="b"]')!, "click");
  assert.equal(detail.hidden, false); assert.equal(directory.hidden, true);
  h.store.actions.library.showDelete(); await h.store.actions.library.submitDelete();
  assert.equal(detail.hidden, true); assert.equal(directory.hidden, false);
  assert.equal(h.doc.querySelectorAll(".sidebar-playlist").length, 1);
  h.store.actions.library.showName("create"); await h.store.actions.library.submitName("新歌单");
  assert.equal(h.store.getState().library.selectedPlaylistId, "b");
  assert.equal(detail.hidden, false); assert.equal(directory.hidden, true);
});
