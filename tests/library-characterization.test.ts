import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { collectModuleGraph } from "./helpers/module-graph.ts";

type Transfer = { effectAllowed: string; dropEffect: string; setData(type: string, value: string): void };
type FixtureEvent = { type: string; target: LibraryNode; currentTarget: LibraryNode; dataTransfer?: Transfer | null; relatedTarget?: LibraryNode | null; key?: string; detail?: unknown; defaultPrevented: boolean; stopped: boolean; immediate: boolean; preventDefault(): void; stopPropagation(): void; stopImmediatePropagation(): void };
class LibraryNode {
  value = ""; textContent = ""; innerHTML = ""; className = ""; hidden = false; disabled = false; draggable = false; title = "";
  dataset: Record<string, string> = {}; attributes = new Map<string, string>(); classes = new Set<string>();
  children: LibraryNode[] = []; parent: LibraryNode | null = null;
  listeners = new Map<string, { callback: (event: FixtureEvent) => unknown; capture: boolean }[]>();
  style = { setProperty() {}, removeProperty() {} };
  paused = true; currentTime = 0; duration = 60; readyState = 1; src = "";
  tag: string;
  constructor(tag = "div") { this.tag = tag; }
  get currentSrc() { return this.src; }
  classList = { add: (...xs: string[]) => { xs.forEach(x => this.classes.add(x)); }, remove: (...xs: string[]) => { xs.forEach(x => this.classes.delete(x)); }, contains: (x: string) => this.classes.has(x) || this.className.split(" ").includes(x), toggle: (x: string, force?: boolean) => { const on = force ?? !this.classes.has(x); if (on) this.classes.add(x); else this.classes.delete(x); return on; } };
  setAttribute(x: string, value: string) { this.attributes.set(x, value); }
  getAttribute(x: string) { return this.attributes.get(x) ?? null; }
  removeAttribute(x: string) { if (x === "src") this.src = ""; this.attributes.delete(x); }
  append(...nodes: (LibraryNode | string)[]) { for (const value of nodes) { const n = typeof value === "string" ? Object.assign(new LibraryNode("text"), { textContent: value }) : value; n.parent = this; this.children.push(n); } }
  prepend(...nodes: LibraryNode[]) { nodes.forEach(n => { n.parent = this; }); this.children.unshift(...nodes); }
  replaceChildren(...nodes: LibraryNode[]) { this.children = []; this.append(...nodes); }
  addEventListener(type: string, callback: (event: FixtureEvent) => unknown, capture: boolean | { capture?: boolean } = false) { const list = this.listeners.get(type) ?? []; list.push({ callback, capture: typeof capture === "boolean" ? capture : !!capture.capture }); this.listeners.set(type, list); }
  removeEventListener() {}
  async fire(type: string, fields: Partial<FixtureEvent> = {}) {
    const event: FixtureEvent = { type, target: this, currentTarget: this, defaultPrevented: false, stopped: false, immediate: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.immediate = true; this.stopped = true; }, ...fields };
    const chain: LibraryNode[] = []; for (let n: LibraryNode | null = this; n; n = n.parent) chain.push(n);
    const invoke = async (n: LibraryNode, capture: boolean) => { event.currentTarget = n; for (const h of n.listeners.get(type) ?? []) { if (h.capture === capture) await h.callback(event); if (event.immediate) break; } };
    for (const n of [...chain].reverse()) { await invoke(n, true); if (event.stopped) return event; }
    for (const n of chain) { await invoke(n, false); if (event.stopped) break; }
    return event;
  }
  querySelectorAll(selector: string): LibraryNode[] { return this.children.flatMap(n => [n, ...n.querySelectorAll("*")]).filter(n => selector === "*" || selector.startsWith(".") && n.classList.contains(selector.slice(1)) || selector === "button.track" && n.tag === "button" && n.classList.contains("track") || selector === n.tag); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  contains(n: LibraryNode | null): boolean { return n === this || this.children.some(child => child.contains(n)); }
  pause() { this.paused = true; } load() {} async play() { this.paused = false; }
  focus() { (globalThis.document as unknown as { activeElement: LibraryNode }).activeElement = this; } select() {} scrollIntoView() {}
  click() { void this.fire("click"); }
  *[Symbol.iterator](): IterableIterator<LibraryNode> {}
}
function deferred() { let resolve: (value: unknown) => void = () => {}; let reject: (error: unknown) => void = () => {}; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const track = (i: number) => ({ bvid: "BV" + String(i).padStart(10, "0"), title: "曲目" + i, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: "2026-01-01" });
const playlist = (id: string, items = [track(1), track(2)]) => ({ id, name: "歌单" + id, items, createdAt: "2026-01-01" });
type LibrarySnapshot = { favorites: ReturnType<typeof track>[]; favoriteBvids: ReadonlySet<string>; playlists: ReturnType<typeof playlist>[]; unavailableBvids: ReadonlyMap<string, string>; selectedPlaylistId: string; loadError: string };
type LibraryApi = { loadLibrary(): Promise<void>; toggleFavorite(video?: ReturnType<typeof track>): Promise<void>; createPlaylist(): void; renameSelectedPlaylist(): void; deleteSelectedPlaylist(): void; choosePlaylistAndAdd(video?: ReturnType<typeof track>): void; openLibraryModal(title: string, subtitle: string): void; closeLibraryModal(): void; importFavoritePlaylist(): void; getLibrarySnapshot?: () => LibrarySnapshot };
async function fixture() {
  const source = path.join(import.meta.dirname, "../ui"), root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-library-characterization-"));
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, "player-dom.ts"), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean); assert.ok(names);
  const nodes: Record<string, LibraryNode> = Object.fromEntries(names.map(name => [name, new LibraryNode()]));
  const documentNode = new LibraryNode(), windowNode = new LibraryNode(), frames: (() => void)[] = [], events: { type: string; detail?: unknown }[] = [];
  const doc = { createElement: (tag: string) => new LibraryNode(tag), querySelectorAll: () => [], querySelector: () => new LibraryNode(), addEventListener: documentNode.addEventListener.bind(documentNode), hidden: false, activeElement: new LibraryNode("button") };
  let now = 1000;
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  let reply: (command: string, args: Record<string, unknown>) => Promise<unknown> = async command => {
    if (command === "get_ai_config") return new Promise(() => {});
    if (command === "list_disabled_pages") return {};
    if (command === "get_video_pages") return [{ page: 1, cid: 1, part: "P1", durationSeconds: 60 }];
    if (command === "prepare_audio") return { audioUrl: "http://127.0.0.1/audio/fixture", title: "曲目", uploader: "作者", thumbnailUrl: "", durationSeconds: 60 };
    return [];
  };
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => { globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  install("__libraryFixture", { nodes, invoke(command: string, args: Record<string, unknown> = {}) { calls.push({ command, args }); return reply(command, args); }, bindTrackActivation(_item: LibraryNode, button: LibraryNode, _video: unknown, activate: () => unknown) { button.addEventListener("click", activate); } });
  install("document", doc); install("performance", { now: () => now });
  install("window", { addEventListener: windowNode.addEventListener.bind(windowNode), dispatchEvent(event: { type: string; detail?: unknown }) { events.push({ type: event.type, detail: event.detail }); void windowNode.fire(event.type, { detail: event.detail }); return true; }, recordPlaybackDiag() {}, setTimeout: () => 0, clearTimeout() {} });
  install("localStorage", { getItem: () => null, setItem() {} }); install("HTMLMediaElement", { HAVE_METADATA: 1 }); install("requestAnimationFrame", (callback: () => void) => { frames.push(callback); return frames.length; });
  const warn = console.warn, error = console.error; console.warn = () => {}; console.error = () => {};
  const dispose = () => { console.warn = warn; console.error = error; for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } fs.rmSync(root, { recursive: true, force: true }); };
  try {
    for (const name of collectModuleGraph(source, ["main.ts"])) fs.copyFileSync(path.join(source, name), path.join(root, name));
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(root, "runtime-api.ts"), 'const invoke = globalThis.__libraryFixture.invoke; export { invoke };');
    fs.writeFileSync(path.join(root, "player-dom.ts"), 'const { '+names.join(", ")+' } = globalThis.__libraryFixture.nodes; export { '+names.join(", ")+' };');
    for (const name of ["video-pages.ts", "appearance.ts", "playback-notice.ts", "playback-diagnostics.ts"]) {
      const exports = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, name), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean); assert.ok(exports);
      fs.writeFileSync(path.join(root, name), exports.map(x => x === "bindTrackActivation" ? 'const bindTrackActivation = globalThis.__libraryFixture.bindTrackActivation;' : x === "isLoudnessNormalizationEnabled" ? 'function isLoudnessNormalizationEnabled() { return false; }' : x === "pagesModalContext" ? 'const pagesModalContext = null;' : 'function '+x+'() {}').join("\n")+'\nexport { '+exports.join(", ")+' };');
    }
    await import(pathToFileURL(path.join(root, "main.ts")).href);
    const library = await import(pathToFileURL(path.join(root, "library-ui.ts")).href) as LibraryApi;
    const core = await import(pathToFileURL(path.join(root, "playback-core.ts")).href) as { playListItem(source: string, items: ReturnType<typeof track>[], index: number): void; showLoudnessNormalizationDialog(): void };
    const states = await import(pathToFileURL(path.join(root, "player-state.ts")).href) as { libraryState: LibrarySnapshot };
    const h = { library, core, nodes, doc, events, calls, dispose, state: () => library.getLibrarySnapshot ? library.getLibrarySnapshot() : states.libraryState,
      reply(next: typeof reply) { reply = next; }, time(next: number) { now = next; }, async flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); while (frames.length) frames.shift()?.(); },
      input: () => nodes.libraryModalBody.querySelectorAll("input")[0], primary: () => nodes.libraryModalBody.querySelectorAll(".library-modal-actions").at(-1)?.children.at(-1) ?? nodes.libraryModalBody.querySelectorAll("button").at(-1)!,
    };
    await h.flush(); calls.length = 0; events.length = 0;
    return h;
  } catch (failure) { dispose(); throw failure; }
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
test("library favorite add remove and failure publish existing mini and mascot events only after results", async () => {
  const h = await fixture(); try {
    await seed(h); const gate = deferred(); h.reply(() => gate.promise); const pending = h.library.toggleFavorite(track(3)); await h.flush(); assert.equal(h.events.length, 0);
    gate.resolve({ items: [track(3)], favorited: true }); await pending;
    assert.deepEqual(h.events, [{ type: "bilibili-music-favorite-change", detail: { bvid: track(3).bvid, title: track(3).title, favorited: true } }, { type: "bilibili-music-favorite", detail: { bvid: track(3).bvid, title: track(3).title } }]);
    assert.equal(h.state().favoriteBvids.has(track(3).bvid.toLowerCase()), true); assert.equal(h.nodes.status.textContent, "已加入收藏。");
    h.events.length = 0; h.reply(async () => ({ items: [], favorited: false })); await h.library.toggleFavorite(track(3)); assert.equal(h.events.length, 1); assert.deepEqual(h.events[0].detail, { bvid: track(3).bvid, title: track(3).title, favorited: false });
    h.events.length = 0; h.reply(async () => { throw Error("写入失败"); }); await h.library.toggleFavorite(track(3)); assert.deepEqual(h.events[0].detail, { bvid: track(3).bvid, title: track(3).title, failed: true }); assert.equal(h.state().favorites.length, 0);
  } finally { h.dispose(); }
});
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
    const opener = h.doc.activeElement; h.library.createPlaylist(); const input = h.input(); assert.equal(h.doc.activeElement, input); assert.equal(h.nodes.libraryModal.hidden, false); await h.flush(); assert.equal(h.nodes.libraryModal.classList.contains("is-open"), true);
    h.library.closeLibraryModal(); assert.equal(h.nodes.libraryModal.getAttribute("aria-hidden"), "true"); assert.equal(h.doc.activeElement, input, "old close does not explicitly restore opener focus"); assert.notEqual(h.doc.activeElement, opener); assert.equal(h.nodes.libraryModal.hidden, false);
    await h.nodes.libraryModal.fire("transitionend"); assert.equal(h.nodes.libraryModal.hidden, true);
    h.core.showLoudnessNormalizationDialog(); assert.equal(h.nodes.libraryModalTitle.textContent, "响度归一化"); assert.equal(h.nodes.libraryModalBody.children.length, 5); assert.equal(h.doc.activeElement.textContent, "知道了"); await h.doc.activeElement.fire("click"); assert.equal(h.nodes.libraryModal.classList.contains("is-open"), false);
  } finally { h.dispose(); }
});
test("library playback failure marks unavailable and successful retry clears through existing playback", async () => {
  const h = await fixture(); try {
    await seed(h, [track(1)], []); h.reply(async command => { if (command === "prepare_audio") throw Error("failed with code 62002"); return command === "get_video_pages" ? [{ page: 1, cid: 1, part: "P1", durationSeconds: 60 }] : []; });
    h.core.playListItem("favorites", h.state().favorites, 0); await h.flush(); assert.equal(h.state().unavailableBvids.get(track(1).bvid.toLowerCase()), "该视频已被删除或设为私密"); assert.equal(h.calls.some(c => c.command === "mark_track_unavailable"), true);
    h.reply(async command => command === "prepare_audio" ? { audioUrl: "http://127.0.0.1/audio/fixture", title: "恢复", uploader: "作者", thumbnailUrl: "", durationSeconds: 60 } : command === "get_video_pages" ? [{ page: 1, cid: 1, part: "P1", durationSeconds: 60 }] : []);
    h.core.playListItem("playlist", h.state().favorites, 0); await h.flush(); assert.equal(h.state().unavailableBvids.has(track(1).bvid.toLowerCase()), false, h.calls.map(c => c.command).join(",")); assert.equal(h.calls.some(c => c.command === "clear_track_unavailable"), true);
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
