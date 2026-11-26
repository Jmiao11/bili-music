import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fixture, seed, track, playlist, transfer, videoMeta } from "./library-lists-fixture.ts";
import { fixture as realApp, track as sampleTrack, responses } from "./tracks-fixture.ts";

type Harness = Awaited<ReturnType<typeof fixture>>;
type App = Awaited<ReturnType<typeof realApp>>;
const localVideo = (id: number, title: string) => ({ ...sampleTrack(id), title, uploader: "合成演奏者", thumbnailUrl: "https://example.invalid/cover.jpg" });
const libraryEntry = (video: ReturnType<typeof localVideo>): CommandContract.LibraryEntry => ({kind:"video",entryId:"video:"+video.bvid.toLowerCase(),video});
const demoTracks = [localVideo(1,"晚风"),localVideo(2,"夜曲 白"),localVideo(3,"海边"),localVideo(4,"夜曲 黑"),localVideo(5,"晨雾")];
const demoEntries = demoTracks.map(libraryEntry);

function libraryReplies(h: App, playlists: CommandContract.Playlist[]) {
  const normal = responses();
  h.reply(async (command,args) => {
    if (command === "list_favorites") return demoEntries;
    if (command === "list_playlists") return playlists;
    if (command === "list_unavailable_tracks" || command === "check_audio_cache") return [];
    if (command === "get_play_history") return demoTracks.map((video,index) => ({...video,lastPlayedAt:String(h.clock()-index*1000),count:1}));
    if (command === "get_collection_page") return null;
    return normal(command);
  });
}
const navLibrary = (h: App, view: string) => h.fire(h.doc.querySelector(`#sidebar [data-view="${view}"]`)!, "click");
const libraryDraft = (h: App) => h.doc.querySelector<HTMLInputElement>(".view:not([hidden]) .library-filter-input")!;
const queryLibrary = async (h: App, value: string) => {
  const draft = libraryDraft(h);
  draft.value = value;
  await h.fire(draft, "input");
  await h.advance(100);
};

for (const [page, view, hostId] of [["favorites","favorites","favorites-list"],["recent","recent","recent-list"],["playlist","playlists","playlist-tracks"]] as const) {
  test(`library ${page} filters without lookup and plays the original second match in the full queue`, async t => {
    const h = await realApp({playback:true}); t.after(h.dispose);
    libraryReplies(h, [{id:"album",name:"合成歌单",items:demoEntries,createdAt:"1"}]);
    await navLibrary(h, view);
    if (page === "playlist") await h.fire(h.doc.querySelector("#playlists-list .playlist-card")!, "click");
    await h.advance(800);
    const list = () => h.doc.getElementById(hostId)!;
    const full = () => [...list().querySelectorAll(".track-title")].map(row => row.textContent);
    assert.deepEqual(full(), demoTracks.map(track => track.title));
    const initialCalls = h.calls.length;
    for (let index = 0; index < 10; index++) {
      await queryLibrary(h, "夜曲");
      assert.deepEqual(full(), ["夜曲 白","夜曲 黑"]);
      assert.equal(list().querySelectorAll('[draggable="true"]').length, 0);
      await queryLibrary(h, "");
      assert.equal(list().children.length, 5);
      if (page !== "recent") assert.equal(list().querySelectorAll('[draggable="true"]').length, 5);
    }
    await queryLibrary(h, "夜曲");
    const host = list();
    assert.equal(h.calls.length, initialCalls);
    assert.equal(h.doc.querySelector(".view:not([hidden]) .library-filter-count")?.textContent, "找到 2 首");
    assert.deepEqual([...host.querySelectorAll(".library-title-match")].map(mark => mark.textContent), ["夜曲","夜曲"]);
    assert.deepEqual([...host.querySelectorAll(".track-number")].map(node => node.textContent), ["2","4"]);
    assert.equal(host.children[1].getAttribute("title"), "搜索时不可调整顺序");
    await h.fire(host.children[1].querySelector("button.track")!, "click", {detail:0});
    const queue = h.store.getState().playbackQueue;
    assert.deepEqual(queue.queue.map(item=>item.bvid), demoTracks.map(item=>item.bvid));
    assert.equal(queue.currentIndex, 3, "点击筛选后的行播放正确歌曲");
    assert.equal(queue.queueSource, page);
    assert.equal(host.children[1].querySelector("button.track")?.getAttribute("aria-current"), "true");
    await queryLibrary(h, "找不到的关键字");
    assert.match(h.doc.querySelector(".library-filter-empty")?.textContent ?? "", /没有找到与“找不到的关键字”相关的歌曲/);
    assert.equal(queue.currentIndex, h.store.getState().playbackQueue.currentIndex);
    await h.fire(h.doc.querySelector(".library-filter-empty button")!, "click");
    assert.equal(libraryDraft(h).value, "");
    await queryLibrary(h, "夜曲");
    await h.fire(libraryDraft(h), "keydown", {key:"Escape"});
    assert.equal(libraryDraft(h).value, "");
    await queryLibrary(h, "夜曲");
    await navLibrary(h, "home");
    await navLibrary(h, view);
    if (page === "playlist") await h.fire(h.doc.querySelector("#playlists-list .playlist-card")!, "click");
    assert.equal(libraryDraft(h).value, "");
  });
}

test("playlist overview filters cards and distinct playlist occurrences, caps rows, and opens collection results", async t => {
  const h = await realApp({playback:true}); t.after(h.dispose);
  const collection: CommandContract.LibraryEntry = {kind:"collection",entryId:"collection:123",collectionId:123,anchorBvid:sampleTrack(77).bvid,title:"演奏合集",thumbnailUrl:"",videoCount:2,addedAt:"1",sourceStatus:"active",snapshot:{fetchedAt:"1",items:[localVideo(77,"夜曲 一"),localVideo(78,"夜曲 二")]}};
  const shared = demoEntries[1];
  const playlists = [
    {id:"a",name:"夜曲精选",createdAt:"1",items:[demoEntries[0],shared,collection,demoEntries[4]]},
    {id:"b",name:"练习歌单",createdAt:"1",items:[demoEntries[2],shared,...Array.from({length:205},(_,index)=>libraryEntry(localVideo(index+100,"夜曲 "+index)))]},
  ];
  libraryReplies(h, playlists);
  await navLibrary(h, "playlists"); await h.advance(800);
  const calls = h.calls.length;
  for (let i = 0; i < 10; i++) { await queryLibrary(h, "夜曲"); await queryLibrary(h, ""); }
  await queryLibrary(h, "夜曲");
  const cards = h.doc.querySelector("#playlists-list")!;
  const songs = h.doc.querySelector("#playlist-search-tracks")!;
  assert.equal(h.calls.length, calls);
  assert.deepEqual([...cards.querySelectorAll(".playlist-name")].map(node => node.textContent), ["夜曲精选"]);
  assert.equal(cards.querySelector("li")?.getAttribute("draggable"), "false");
  assert.equal(songs.children.length, 200);
  assert.equal(h.doc.querySelector(".library-filter-limit")?.textContent, "仅显示前 200 首，请输入更具体的关键词");
  const occurrences = [...songs.querySelectorAll<HTMLButtonElement>(`button[data-bvid="${demoTracks[1].bvid}"]`)];
  assert.deepEqual(occurrences.map(row => row.querySelector(".library-match-detail")?.textContent), [" · 夜曲精选"," · 练习歌单"]);
  await h.fire(occurrences[1], "click", {detail:0});
  assert.equal(h.store.getState().playbackQueue.playlistId, "b");
  assert.equal(h.store.getState().playbackQueue.queueSource, "playlist");
  assert.equal(h.store.getState().playbackQueue.currentIndex, 1);
  assert.equal(h.store.getState().playbackQueue.queue.length, playlists[1].items.length);
  assert.equal(h.store.getState().library.view.playlistDetail, false);
  const grouped = [...songs.querySelectorAll("button.track")].find(row => row.textContent?.includes("合集内 2 首匹配"))!;
  await h.fire(grouped, "click", {detail:0});
  assert.equal(h.store.getState().collection.reference?.playlistId,"a");
  assert.equal(h.store.getState().collection.active,true);
});

test("playlist detail finds a collection by its title or local members and opens it on a single click", async t => {
  const h = await realApp({playback:true}); t.after(h.dispose);
  const collection: CommandContract.LibraryEntry = {kind:"collection",entryId:"collection:15",collectionId:15,anchorBvid:sampleTrack(80).bvid,title:"演奏合集",thumbnailUrl:"",videoCount:1,addedAt:"1",sourceStatus:"active",snapshot:{fetchedAt:"1",items:[localVideo(80,"夜曲")]}};
  libraryReplies(h, [{id:"a",name:"合成歌单",createdAt:"1",items:[collection]}]);
  await navLibrary(h,"playlists"); await h.fire(h.doc.querySelector("#playlists-list .playlist-card")!,"click");
  await queryLibrary(h, "演奏");
  assert.doesNotMatch(h.doc.querySelector("#playlist-tracks .track-title")?.textContent ?? "", /合集内/);
  await queryLibrary(h, "夜曲");
  const button = h.doc.querySelector("#playlist-tracks button.track")!;
  assert.match(button.textContent ?? "", /合集内 1 首匹配/);
  await h.fire(button,"click",{detail:0});
  assert.equal(h.store.getState().collection.reference?.playlistId,"a");
  assert.equal(h.store.getState().collection.active,true);
});

test("Ctrl+F focuses the local filter and yields to an existing playback shortcut", async t => {
  const h = await realApp({playback:true}); t.after(h.dispose);
  libraryReplies(h, []);
  await navLibrary(h,"favorites");
  const sidebar = h.doc.querySelector<HTMLButtonElement>('#sidebar [data-view="favorites"]')!;
  sidebar.focus();
  const free = await h.fire(sidebar,"keydown",{ctrlKey:true,key:"f"});
  assert.equal(free.defaultPrevented,true);
  assert.equal(h.doc.activeElement,libraryDraft(h));
  h.reply(async () => ({version:1,bindings:{previous:null,playPause:"Ctrl+F",next:null,volumeUp:null,volumeDown:null}}));
  await h.store.actions.settings.loadShortcuts();
  sidebar.focus();
  const claimed = await h.fire(sidebar,"keydown",{ctrlKey:true,key:"f"});
  assert.equal(claimed.defaultPrevented,false);
  assert.equal(h.doc.activeElement,sidebar);
});

test("long library filter windows reach later original rows without initiating lookups", async t => {
  const h = await realApp({playback:true}); t.after(h.dispose);
  const items = Array.from({length:90},(_,index)=>libraryEntry(localVideo(index+1,"夜曲 "+(index+1))));
  h.reply(async command => command === "list_favorites" ? items : command === "list_playlists" || command === "list_unavailable_tracks" ? [] : {});
  await navLibrary(h,"favorites"); await h.advance(800);
  const unfiltered = h.doc.querySelector("#favorites-list")!;
  const before = h.calls.length;
  await queryLibrary(h,"夜曲");
  const filtered = h.doc.querySelector("#favorites-list")!;
  const firstIndex = () => filtered.querySelector("button.track")?.getAttribute("data-library-index");
  assert.equal(firstIndex(),"0");
  assert.equal(filtered.querySelectorAll(".track-row").length,48);
  assert.equal(h.doc.querySelector(".view:not([hidden]) .library-filter-count")?.textContent,"找到 90 首");
  const viewport = h.doc.querySelector<HTMLElement>("#view-favorites")!;
  viewport.scrollTop = 2600;
  const rect = filtered.getBoundingClientRect();
  Object.defineProperty(rect, "top", { value: -2600 });
  filtered.getBoundingClientRect = () => rect;
  await h.fire(viewport,"scroll");
  assert.equal(firstIndex(),"42");
  assert.equal([...filtered.querySelectorAll("button.track")].at(-1)?.getAttribute("data-library-index"),"89");
  await queryLibrary(h,"");
  assert.equal(h.doc.querySelector("#favorites-list"),unfiltered);
  assert.equal(h.calls.length,before);
});
async function run(body: (h: Harness) => Promise<void>) { const h = await fixture(); try { await body(h); assert.equal(h.warnings.filter(args => String(args[0]).includes("Vue")).length, 0); } finally { h.dispose(); } }
const matrix: { kind: "favorites" | "playlistItems" | "playlists"; state: string; html: string }[] = JSON.parse(fs.readFileSync(new URL("../fixtures/vue/library-lists-baseline.json", import.meta.url), "utf8")).matrix;
for (const entry of matrix) test(`Vue library list matches old ${entry.kind} ${entry.state} HTML`, () => run(async h => {
  const items = entry.state === "empty" ? [] : [{ ...track(1), ...(entry.state === "cover" ? { thumbnailUrl: "https://example.invalid/cover.jpg" } : {}) }];
  const ps = entry.state === "empty" ? [] : [{ ...playlist("a", items), ...(entry.state === "escaped" ? { name: '歌单<&>"' } : {}) }, playlist("b", [])];
  if (entry.state === "unavailable") h.store.actions.library.markUnavailable(track(1).bvid, "不可用");
  if (entry.state === "badge") h.store.actions.pages.remember(track(1).bvid, videoMeta);
  await seed(h, items, ps);
  if (entry.state === "playing") { h.store.actions.playbackQueue.replaceQueue(items, entry.kind === "favorites" ? "favorites" : "playlist", null, "a"); h.core.updateQueueUi(); }
  const host = entry.kind === "favorites" ? h.nodes.favoritesList : entry.kind === "playlistItems" ? h.nodes.playlistTracks : h.nodes.playlistsList;
  assert.equal(host.innerHTML, entry.html); const anchors = [...host.childNodes].filter(node => node.nodeType === 3);
  assert.equal(anchors.length, entry.state === "empty" ? 0 : 2); assert.ok(anchors.every(node => node.textContent === ""));
}));
test("Vue library list projections skip fifty unrelated commits in all three regions", () => run(async h => {
  await seed(h); h.regions.length = 0; let commits = 0; const stop = h.store.subscribe(() => commits++);
  for (let i = 0; i < 50; i++) h.store.actions.library.setModalName("无关" + i); stop();
  assert.equal(commits, 50); assert.equal(h.regions.filter(record => record.operation === "update").length, 0);
}));
for (const kind of ["favorites", "playlistItems", "playlists"] as const) test(`Vue library ${kind} reorder moves keyed nodes and changes current indexes`, () => run(async h => {
  await seed(h); const host = kind === "favorites" ? h.nodes.favoritesList : kind === "playlistItems" ? h.nodes.playlistTracks : h.nodes.playlistsList, nodes = [...host.children];
  const data = transfer(); await h.fire(nodes[0], "dragstart", { dataTransfer: data }); await h.fire(nodes[1], "dragover", { dataTransfer: data, clientX: 100 });
  h.reply(async () => kind === "favorites" ? [track(2), track(1)] : kind === "playlistItems" ? [playlist("a", [track(2), track(1)]), playlist("b")] : [playlist("b"), playlist("a")]);
  await h.fire(nodes[1], "drop", { dataTransfer: data, clientX: 100 }); await h.microtasks();
  assert.deepEqual([...host.children], [nodes[1], nodes[0]]);
  if (kind !== "playlists") assert.equal(nodes[1].querySelector("button.track")?.getAttribute("data-library-index"), "0");
  assert.equal(host.querySelectorAll(".is-dragging,.is-drop-before,.is-drop-after").length, 0);
}));
test("Vue playlist tracks key includes playlist id while directory card nodes remain stable", () => run(async h => {
  await seed(h, [], [playlist("a", [track(1)]), playlist("b", [track(1)])]);
  const row = h.nodes.playlistTracks.children[0], cards = [...h.nodes.playlistsList.children];
  await h.fire(cards[1].querySelector("button")!, "click", { detail: 0 });
  assert.notEqual(h.nodes.playlistTracks.children[0], row); assert.deepEqual([...h.nodes.playlistsList.children], cards); assert.equal(h.state().selectedPlaylistId, "b");
}));
test("Vue library row observation and dataset survive metadata highlights and badge patches", () => run(async h => {
  await seed(h); await h.advance(0); const row = h.nodes.favoritesList.children[0]; assert.ok(h.observed.has(row));
  h.store.actions.playbackQueue.replaceQueue([track(1)], "favorites"); h.core.updateQueueUi(); h.store.actions.pages.remember(track(1).bvid, videoMeta);
  assert.equal(h.nodes.favoritesList.children[0], row); assert.equal((row as HTMLElement).dataset.pageCountBvid, track(1).bvid); assert.equal(row.querySelector(".page-count-badge")?.textContent, "2P");
}));
test("Vue library lists create only on content and unload all empty hosts", () => run(async h => {
  assert.equal(h.regions.length, 0); await seed(h, [], []); assert.equal(h.regions.length, 0); await seed(h);
  assert.equal(h.regions.filter(record => record.operation === "create").length, 3); await seed(h, [], []);
  assert.equal(h.regions.filter(record => record.operation === "unmount").length, 3);
  for (const host of [h.nodes.favoritesList, h.nodes.playlistTracks, h.nodes.playlistsList]) { assert.equal(host.innerHTML, ""); assert.equal(host.matches(":empty"), true); }
}));
test("Vue library drag survives unrelated patches and ends on existing row refresh boundary", () => run(async h => {
  await seed(h); const row = h.nodes.favoritesList.children[0], target = h.nodes.favoritesList.children[1], data = transfer();
  await h.fire(row, "dragstart", { dataTransfer: data }); await h.fire(target, "dragover", { dataTransfer: data, clientX: 100 });
  h.store.actions.pages.remember(track(1).bvid, videoMeta); h.store.actions.playbackQueue.replaceQueue([track(1)], "favorites");
  assert.equal(h.nodes.favoritesList.children[0], row); assert.equal(row.classList.contains("is-dragging"), true); assert.equal(target.classList.contains("is-drop-after"), true);
  h.store.actions.library.refreshViews(); assert.equal(h.state().drags.favorites.drag, null); assert.equal(h.nodes.favoritesList.querySelectorAll(".is-dragging,.is-drop-after").length, 0);
  assert.equal((await h.fire(row.querySelector("button")!, "click", { detail: 0 })).defaultPrevented, true);
}));
test("Vue library component and compatibility registrations keep public boundaries", () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, ["scripts/vue/check.ts"], { cwd: new URL("../..", import.meta.url), stdio: "pipe" }));
});
