import assert from "node:assert/strict";
import { test } from "node:test";
import { playbackFixture, track } from "./playback-ui-fixture.ts";
import { responses, deferred } from "./tracks-fixture.ts";
import { nextDomEventTurn } from "./event-turn.ts";

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

test("delegated columns drag keyboard reset and restart keep all lists untouched", async () => {
  const { fixture } = await import("./tracks-fixture.ts");
  const { nextDomEventTurn } = await import("./event-turn.ts");
  const probe = { depth: 0, maxDepth: 0, calls: 0 };
  const h = await fixture({ playback: true, rootRenderProbe: probe });
  let saved = "", stop = () => {};
  try {
    h.reply(responses([track(1), track(2)])); h.home.setHomeMode("ranking"); await h.microtasks();
    const header = h.doc.getElementById("home-ranking-list-columns")!;
    const handle = (column: string) => header.querySelector<HTMLElement>(`[data-track-column="${column}"]`)!;
    assert.deepEqual(h.listeners.filter(l => l.target === header).map(l => l.type), ["pointerdown", "keydown"]);
    assert.equal(handle("title").getAttribute("aria-valuenow"), "240");
    assert.equal(handle("title").getAttribute("aria-valuetext"), "自适应");
    assert.equal(h.listeners.filter(l => l.target instanceof h.window.Element && l.target.matches(".column-resize")).length, 0);
    const captured = new Set<number>();
    Object.defineProperties(header, {
      setPointerCapture: { value: (id: number) => captured.add(id) },
      hasPointerCapture: { value: (id: number) => captured.has(id) },
      releasePointerCapture: { value: (id: number) => captured.delete(id) },
    });
    const pointer = async (target: EventTarget, type: string, x: number) => {
      await nextDomEventTurn();
      const event = new h.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
      Object.defineProperties(event, { pointerId: { value: 7 }, isPrimary: { value: true } });
      target.dispatchEvent(event); await h.microtasks();
    };
    let commits = 0; stop = h.store.subscribe(() => commits++);
    h.rowRenders.length = 0; h.regions.length = 0; const renders = probe.calls;
    await pointer(handle("uploader"), "pointerdown", 400);
    assert.equal(captured.has(7), true);
    await pointer(h.window, "pointermove", 360);
    assert.equal(h.doc.documentElement.style.getPropertyValue("--track-uploader-width"), "120px");
    assert.equal(h.window.localStorage.getItem("bilibili-music.track-columns"), null);
    await pointer(h.window, "pointerup", 360);
    assert.equal(captured.size, 0);
    await pointer(h.window, "pointermove", 100);
    assert.equal(h.doc.documentElement.style.getPropertyValue("--track-uploader-width"), "120px");
    await nextDomEventTurn(); await h.fire(handle("plays"), "keydown", { key: "ArrowRight" });
    assert.equal(handle("plays").getAttribute("aria-valuenow"), "88");
    await pointer(handle("plays"), "pointerdown", 500);
    await pointer(h.window, "pointerup", 500);
    await pointer(handle("plays"), "pointerdown", 500);
    assert.equal(handle("plays").getAttribute("aria-valuenow"), "80");
    for (const [column, expected] of [["pages", "82"], ["title", "250"], ["duration", "82"]] as const) {
      await pointer(handle(column), "pointerdown", 600);
      await pointer(h.window, "pointermove", 610);
      await pointer(h.window, "pointerup", 610);
      assert.equal(handle(column).getAttribute("aria-valuenow"), expected);
      await h.fire(handle(column), "keydown", { key: "ArrowRight" });
      assert.equal(handle(column).getAttribute("aria-valuenow"), String(Number(expected) + 8));
      await pointer(handle(column), "pointerdown", 700);
      await pointer(h.window, "pointerup", 700);
      await pointer(handle(column), "pointerdown", 700);
      assert.equal(handle(column).getAttribute(column === "title" ? "aria-valuetext" : "aria-valuenow"), column === "title" ? "自适应" : String(column === "pages" ? 72 : 72));
    }
    for (const separator of h.doc.querySelectorAll('[data-track-column="uploader"]')) assert.equal(separator.getAttribute("aria-valuenow"), "120");
    assert.equal(commits, 0); assert.equal(probe.calls, renders);
    assert.equal(h.rowRenders.length, 0); assert.equal(h.regions.length, 0);
    saved = h.window.localStorage.getItem("bilibili-music.track-columns")!;
    assert.deepEqual(JSON.parse(saved), { title: "auto", uploader: 120, pages: 72, plays: 80, duration: 72 });
  } finally { stop(); h.dispose(); }
  const restored = await fixture({ playback: true, trackColumns: saved });
  try {
    assert.equal(restored.doc.documentElement.style.getPropertyValue("--track-uploader-width"), "120px");
    assert.equal(restored.doc.querySelector('[data-track-column="uploader"]')!.getAttribute("aria-valuenow"), "120");
  } finally { restored.dispose(); }
});

test("invalid column storage falls back without overwriting and cover opens the existing immersive page", async () => {
  const { fixture } = await import("./tracks-fixture.ts");
  const h = await fixture({ playback: true, trackColumns: '{"uploader":1}' });
  try {
    assert.equal(h.doc.documentElement.style.getPropertyValue("--track-uploader-width"), "160px");
    assert.equal(h.window.localStorage.getItem("bilibili-music.track-columns"), '{"uploader":1}');
    h.store.actions.playbackDisplay.setCurrentTrack({ ...track(1), hasCurrent: true });
    const cover = h.doc.getElementById("open-immersive-cover-button")!;
    assert.equal(cover.getAttribute("aria-label"), "打开沉浸页与歌词");
    assert.equal(cover.querySelector("#thumbnail"), h.doc.getElementById("thumbnail"));
    await h.fire(cover, "click"); h.raf();
    assert.equal(h.store.getState().playbackDisplay.presentation.immersiveOpen, true);
    await h.fire(h.doc.getElementById("close-immersive-button")!, "click");
    assert.equal(h.store.getState().playbackDisplay.presentation.immersiveOpen, false);
    assert.ok(h.doc.getElementById("open-immersive-button"));
  } finally { h.dispose(); }
});


test("cover color crossfades and presentation refreshes never redraw track rows", async () => {
  const { fixture } = await import("./tracks-fixture.ts");
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const images: {onload:(()=>Promise<void>)|null;onerror:(()=>void)|null}[] = [];
  class Artwork { src=""; onload:(()=>Promise<void>)|null=null; onerror:(()=>void)|null=null; constructor(){images.push(this);} decode(){return Promise.resolve();} }
  Object.defineProperty(globalThis,"Image",{value:Artwork,configurable:true});
  const h = await fixture({playback:true,nativeWrites:true});
  try {
    Object.defineProperty(h.doc,"hidden",{value:false,configurable:true});
    let pixel = [220,30,80,255];
    Object.defineProperty(Object.getPrototypeOf(h.doc.createElement("canvas")),"getContext",{value:()=>({drawImage(){},getImageData(){return {data:new Uint8ClampedArray(pixel)};}}),configurable:true});
    h.reply(responses([track(1),track(2)]));h.home.setHomeMode("ranking");await h.microtasks();
    h.store.actions.settings.setTheme("dynamic",false);await h.microtasks();
    h.rowRenders.length=0;h.regions.length=0;
    for(const [index,color] of [[0,[220,30,80,255]],[1,[25,160,210,255]]] as const){
      pixel=[...color];
      h.window.dispatchEvent(new h.window.CustomEvent("bilibili-music-trackchange",{detail:{hasCurrent:true,thumbnailUrl:"synthetic-"+index}}));
      await images.at(-1)!.onload!();
      await new Promise(resolve=>setTimeout(resolve,32));
      assert.ok(h.doc.querySelector(".dynamic-background-layer.is-visible[style]"));
      assert.equal(h.rowRenders.length,0);assert.equal(h.regions.length,0);
    }
    const current = h.doc.querySelector(".dynamic-background-layer.is-visible")!.getAttribute("style");
    h.window.dispatchEvent(new h.window.CustomEvent("bilibili-music-trackchange",{detail:{hasCurrent:false}}));
    assert.equal(h.doc.querySelector(".dynamic-background-layer.is-visible")!.getAttribute("style"),current);
  } finally { h.dispose();if(originalImage)Object.defineProperty(globalThis,"Image",originalImage);else Reflect.deleteProperty(globalThis,"Image"); }
});

test("quality select persists for the next playback while the label follows the actual track", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const items = [track(1), track(2)];
  let audioId: number | null = 30280, isFallback = false;
  h.reply(async command => command === "prepare_audio" ? { audioId, isFallback, audioUrl: "http://127.0.0.1/audio/quality", title: "曲目", uploader: "作者", thumbnailUrl: "", durationSeconds: 60 } : responses(items)(command));
  const select = h.node<HTMLSelectElement>("audio-quality-select");
  assert.equal(select.value, "highest");
  assert.deepEqual([...select.options].map(option => option.text), ["最高可用", "192K", "132K", "64K"]);
  h.core.playListItem("ranking", items, 0); await h.microtasks();
  assert.equal(h.node("player-audio-quality").textContent, "192K");
  const src = h.audio.src, count = h.calls.filter(call => call.command === "prepare_audio").length;
  await h.fire(h.node("open-settings-button"), "click"); h.raf(); await h.microtasks();
  await nextDomEventTurn(); select.value = "64k"; await h.fire(select, "change");
  assert.equal(h.window.localStorage.getItem("bilibili-music.audio-quality"), "64k");
  assert.equal(h.audio.src, src);
  assert.equal(h.calls.filter(call => call.command === "prepare_audio").length, count);
  assert.equal(h.node("player-audio-quality").textContent, "192K");
  audioId = 30232;
  h.core.playListItem("ranking", items, 1); await h.microtasks();
  assert.equal(h.calls.filter(call => call.command === "prepare_audio").at(-1)?.args.quality, "64k");
  assert.equal(h.node("player-audio-quality").textContent, "132K");
  let nextIndex = 0;
  for (const [id, fallback, label] of [[30216, false, "64K"], [null, true, "兜底"], [null, false, "音质"]] as const) {
    audioId = id; isFallback = fallback;
    h.core.playListItem("ranking", items, nextIndex); await h.microtasks();
    nextIndex = 1 - nextIndex;
    assert.equal(h.doc.getElementById("player-audio-quality")?.textContent ?? null, label);
  }
});

test("quality menu opens and closes with paired transient listeners and shares the settings action", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const button = h.node<HTMLButtonElement>("player-audio-quality");
  assert.equal(button.textContent, "音质"); assert.equal(button.disabled, true);
  assert.equal(h.store.getState().playbackDisplay.audioQualityMenu, null);
  assert.equal(h.listeners.some(item => /outsideQualityMenu|qualityMenuKeydown|dismissQualityMenu/.test(typeof item.callback === "function" ? item.callback.name : "")), false);
  h.reply(responses([track(1)])); h.core.playListItem("ranking", [track(1)], 0); await h.microtasks();
  assert.equal(button.disabled, false);
  const calls = h.calls.length, media = h.platform.filter(item => ["play", "pause", "load"].includes(item.operation)).length, source = h.audio.src;
  const before = h.listeners.length;
  const removed: { type: string; callback: EventListenerOrEventListenerObject | null }[] = [];
  const docRemove = h.doc.removeEventListener.bind(h.doc), winRemove = h.window.removeEventListener.bind(h.window);
  h.doc.removeEventListener = (type: string, callback: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => { removed.push({ type, callback }); docRemove(type, callback, options); };
  h.window.removeEventListener = (type: string, callback: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => { removed.push({ type, callback }); winRemove(type, callback, options); };
  await h.fire(button, "click");
  assert.equal(button.getAttribute("aria-haspopup"), "menu"); assert.equal(button.getAttribute("aria-expanded"), "true");
  const menu = h.node("player-quality-menu"); assert.equal(menu.getAttribute("role"), "menu");
  const options = [...menu.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")];
  assert.deepEqual(options.map(item => item.textContent), ["最高可用", "192K", "132K", "64K"]);
  assert.equal(options[0].getAttribute("aria-checked"), "true"); assert.equal(h.doc.activeElement, options[0]);
  assert.equal(menu.querySelector("p")?.textContent, "切换后从下一首开始生效");
  const transient = h.listeners.slice(before).filter(item => item.target === h.doc || item.target === h.window);
  assert.deepEqual(transient.map(item => item.type), ["click", "keydown", "resize"]);
  await h.fire(button, "click"); assert.equal(h.doc.getElementById("player-quality-menu"), null);
  for (const item of transient) assert.ok(removed.some(value => value.type === item.type && value.callback === item.callback));
  await h.fire(button, "click");
  await h.fire(h.doc.querySelector("[data-quality='132k']")!, "click");
  assert.equal(h.store.getState().settings.audioQuality, "132k");
  assert.equal(h.window.localStorage.getItem("bilibili-music.audio-quality"), "132k");
  assert.equal(h.node<HTMLSelectElement>("audio-quality-select").value, "132k");
  assert.equal(button.getAttribute("aria-expanded"), "false"); assert.equal(h.doc.activeElement, button);
  assert.equal(h.audio.src, source); assert.equal(h.calls.length, calls);
  assert.equal(h.platform.filter(item => ["play", "pause", "load"].includes(item.operation)).length, media);
  await h.fire(button, "click"); assert.equal(h.doc.querySelector("[data-quality='132k']")?.getAttribute("aria-checked"), "true");
  await h.fire(h.node("title"), "click"); assert.equal(h.doc.getElementById("player-quality-menu"), null);
});

test("quality menu keyboard navigation selects with Enter and Space and Escape restores focus", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  h.reply(responses([track(1)])); h.core.playListItem("ranking", [track(1)], 0); await h.microtasks();
  const button = h.node("player-audio-quality");
  const active = () => h.doc.activeElement as HTMLElement;
  const key = (value: string) => h.fire(active(), "keydown", { key: value });
  button.focus(); await key("ArrowDown"); assert.equal(active().dataset.quality, "highest");
  await key("ArrowDown"); assert.equal(active().dataset.quality, "192k");
  await key("Enter"); assert.equal(h.store.getState().settings.audioQuality, "192k"); assert.equal(active(), button);
  await key("ArrowUp"); assert.equal(active().dataset.quality, "192k");
  await key("End"); assert.equal(active().dataset.quality, "64k");
  await key("ArrowDown"); assert.equal(active().dataset.quality, "highest");
  await key("Home"); await key("ArrowUp"); assert.equal(active().dataset.quality, "64k");
  await key(" "); assert.equal(h.store.getState().settings.audioQuality, "64k"); assert.equal(active(), button);
  await h.fire(button, "click"); await key("Escape");
  assert.equal(button.getAttribute("aria-expanded"), "false"); assert.equal(active(), button);
  await h.fire(button, "click"); await key("Tab"); assert.equal(h.doc.getElementById("player-quality-menu"), null);
});

test("late quality response cannot overwrite the current label or its cache identity", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const items = [track(1), track(2)].map(item => ({ ...item, thumbnailUrl: "https://example.test/cover" })), old = deferred();
  Object.defineProperty(h.audio, "currentSrc", { configurable: true, get: () => h.audio.src });
  h.reply(async (command, args) => command === "prepare_audio" ? args.bvId === items[0].bvid ? old.promise : { audioId: 30216, isFallback: false, audioUrl: "http://127.0.0.1/audio/new", title: "当前", uploader: "作者", thumbnailUrl: "https://example.test/cover", durationSeconds: 60 } : responses(items)(command));
  h.core.playListItem("ranking", items, 0); await h.microtasks();
  h.core.playListItem("ranking", items, 1); await h.microtasks();
  old.resolve({ audioId: 30280, isFallback: false, audioUrl: "http://127.0.0.1/audio/old", title: "迟到", uploader: "作者", thumbnailUrl: "", durationSeconds: 60 });
  await h.microtasks();
  assert.equal(h.node("player-audio-quality").textContent, "64K");
  assert.equal(h.store.getState().playbackDisplay.audioQuality.audioId, 30216);
  h.media.currentTime = 31;
  await nextDomEventTurn(); await h.fire(h.audio, "timeupdate");
  const cache = h.calls.find(call => call.command === "cache_track_audio");
  assert.ok(cache);
  assert.equal(cache.args.bvid, items[1].bvid);
  assert.equal(cache.args.audioId, 30216);
  assert.equal(cache.args.audioUrl, "http://127.0.0.1/audio/new");
});
