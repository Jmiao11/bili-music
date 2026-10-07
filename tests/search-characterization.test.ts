import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { collectModuleGraph } from "./helpers/module-graph.ts";

class SearchNode {
  value = ""; textContent = ""; innerHTML = ""; className = ""; hidden = false; disabled = false;
  dataset: Record<string, string> = {}; attributes = new Map<string, string>(); classes = new Set<string>();
  children: SearchNode[] = []; listeners = new Map<string, ((event: { type: string; detail?: unknown; key?: string; preventDefault(): void }) => unknown)[]>();
  style = { setProperty() {}, removeProperty() {} };
  paused = true; currentTime = 0; duration = 60; readyState = 1; src = ""; title = "";
  get currentSrc() { return this.src; }
  classList = { add: (x: string) => { this.classes.add(x); }, remove: (x: string) => { this.classes.delete(x); }, contains: (x: string) => this.classes.has(x), toggle: (x: string, force?: boolean) => { const on = force ?? !this.classes.has(x); if (on) this.classes.add(x); else this.classes.delete(x); return on; } };
  setAttribute(x: string, value: string) { this.attributes.set(x, value); }
  getAttribute(x: string) { return this.attributes.get(x) ?? null; }
  removeAttribute(x: string) { if (x === "src") this.src = ""; this.attributes.delete(x); }
  append(...nodes: SearchNode[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: SearchNode[]) { this.children = nodes; }
  addEventListener(type: string, fn: (event: { type: string; detail?: unknown; key?: string; preventDefault(): void }) => unknown) { const list = this.listeners.get(type) ?? []; list.push(fn); this.listeners.set(type, list); }
  removeEventListener() {}
  async fire(type: string, detail?: unknown) { for (const fn of this.listeners.get(type) ?? []) await fn({ type, detail, preventDefault() {} }); }
  querySelectorAll(selector: string): SearchNode[] { return this.children.flatMap(n => [n, ...n.querySelectorAll("*")]).filter(n => selector === "*" || selector === "button.track" && n.className === "track"); }
  querySelector() { return null; }
  pause() { this.paused = true; }
  load() {}
  async play() { this.paused = false; }
  focus() {} scrollIntoView() {}
  *[Symbol.iterator](): IterableIterator<SearchNode> {}
}
function deferred() { let resolve: (value: unknown) => void = () => {}; let reject: (error: unknown) => void = () => {}; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const track = (index: number) => ({ bvid: "BV" + String(index).padStart(10, "0"), title: "曲目" + index, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, playCount: 1, pubdate: 1 });
const batch = (start = 1) => Array.from({ length: 20 }, (_, i) => track(start + i));
type Snapshot = { results: ReturnType<typeof track>[]; requestVersion: number; page: number; isLoadingMore: boolean; hasMore: boolean; tids: number; sortMode: string; rerank: boolean; userKeyword: string; requestKeyword: string };

async function fixture(saved = "") {
  const source = path.join(import.meta.dirname, "../ui");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-search-characterization-"));
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, "player-dom.ts"), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean);
  assert.ok(names);
  const nodes: Record<string, SearchNode> = Object.fromEntries(names.map(name => [name, new SearchNode()]));
  nodes.result.hidden = true;
  const musicTabs = [3, 28, 31, 30, 59, 267].map(tids => { const n = new SearchNode(); n.dataset.tids = String(tids); return n; });
  const sortModeTabs = ["all", "title", "description"].map(sortMode => { const n = new SearchNode(); n.dataset.sortMode = sortMode; return n; });
  const documentNode = new SearchNode(); const windowNode = new SearchNode();
  const storage = new Map(saved ? [["bilibili-music.last-search", saved]] : []);
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  let reply: (command: string, args: Record<string, unknown>) => Promise<unknown> = async command => {
    if (command === "get_ai_config") return new Promise(() => {});
    if (command === "get_video_pages") return [{ page: 1, cid: 1, part: "P1", durationSeconds: 60 }];
    if (command === "prepare_audio") return { audioUrl: "http://127.0.0.1/audio/fixture", title: "回填标题", uploader: "回填作者", thumbnailUrl: "", durationSeconds: 90 };
    return [];
  };
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => { globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  const environment = {
    nodes, musicTabs, sortModeTabs,
    invoke(command: string, args: Record<string, unknown> = {}) { calls.push({ command, args }); return reply(command, args); },
    bindTrackActivation(item: SearchNode, button: SearchNode, _video: unknown, activate: () => unknown) { button.addEventListener("click", activate); },
  };
  install("__searchFixture", environment);
  install("document", { createElement: () => new SearchNode(), querySelectorAll: () => [], querySelector: () => new SearchNode(), addEventListener: documentNode.addEventListener.bind(documentNode), hidden: false });
  install("window", { addEventListener: windowNode.addEventListener.bind(windowNode), dispatchEvent(event: { type: string; detail?: unknown }) { void windowNode.fire(event.type, event.detail); return true; }, recordPlaybackDiag() {}, setTimeout: () => 0, clearTimeout() {} });
  install("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  install("HTMLMediaElement", { HAVE_METADATA: 1 });
  const warn = console.warn; const error = console.error; console.warn = () => {}; console.error = () => {};
  const dispose = () => { console.warn = warn; console.error = error; for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } fs.rmSync(root, { recursive: true, force: true }); };
  try {
    for (const name of collectModuleGraph(source, ["main.ts"])) fs.copyFileSync(path.join(source, name), path.join(root, name));
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(root, "runtime-api.ts"), 'const invoke = globalThis.__searchFixture.invoke; export { invoke };');
    fs.writeFileSync(path.join(root, "player-dom.ts"), 'const { '+names.filter(x => !["musicTabs", "sortModeTabs"].includes(x)).join(", ")+' } = globalThis.__searchFixture.nodes; const { musicTabs, sortModeTabs } = globalThis.__searchFixture; export { '+names.join(", ")+' };');
    for (const name of ["library-ui.ts", "video-pages.ts", "appearance.ts", "playback-notice.ts", "playback-diagnostics.ts"]) {
      const exports = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, name), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean); assert.ok(exports);
      const declarations = exports.map(x => x === "getLibrarySnapshot" ? 'function getLibrarySnapshot() { return { favoriteBvids: new Set(), unavailableBvids: new Map() }; }' : x === "bindTrackActivation" ? 'const bindTrackActivation = globalThis.__searchFixture.bindTrackActivation;' : x === "isLoudnessNormalizationEnabled" ? 'function isLoudnessNormalizationEnabled() { return false; }' : x === "pagesModalContext" ? 'const pagesModalContext = null;' : 'function '+x+'() {}');
      fs.writeFileSync(path.join(root, name), declarations.join("\n")+'\nexport { '+exports.join(", ")+' };');
    }
    await import(pathToFileURL(path.join(root, "main.ts")).href);
    const search = await import(pathToFileURL(path.join(root, "search.ts")).href) as { runSearch(options?: { userKeyword?: string; recordHistory?: boolean; restored?: boolean }): Promise<void>; loadMoreSearchResults(): Promise<void>; readLastSearchKeyword(): string; getSearchSnapshot?: () => Snapshot };
    const states = await import(pathToFileURL(path.join(root, "player-state.ts")).href) as { searchState?: Snapshot; playerState: { queue: ReturnType<typeof track>[]; queueSource: string; queueSearchVersion: number | null; shuffle: boolean; currentIndex: number; randomRemaining: number[] } };
    return { search, player: states.playerState, state: () => search.getSearchSnapshot ? search.getSearchSnapshot() : states.searchState!, nodes, musicTabs, sortModeTabs, calls, storage, windowNode, dispose,
      reply(next: typeof reply) { reply = next; }, async flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); } };
  } catch (failure) { dispose(); throw failure; }
}

test("search ignores late old search success and failure while retaining the latest button state", async () => {
  const h = await fixture(); try {
    const old = deferred(); const current = deferred(); h.reply((_c, args) => args.keyword === "旧" ? old.promise : current.promise);
    const p = h.search.runSearch({ userKeyword: "旧" }); const q = h.search.runSearch({ userKeyword: "新" });
    old.resolve([track(1)]); await p; assert.equal(h.nodes.searchButton.disabled, true); assert.equal(h.state().results.length, 0);
    current.resolve([track(2)]); await q; assert.equal(h.state().results[0].bvid, track(2).bvid); assert.equal(h.nodes.searchButton.disabled, false);
    const failed = deferred(); h.reply((_c, args) => args.keyword === "坏" ? failed.promise : Promise.resolve([track(3)]));
    const r = h.search.runSearch({ userKeyword: "坏" }); await h.search.runSearch({ userKeyword: "好" }); failed.reject(new Error("late")); await r;
    assert.equal(h.state().results[0].bvid, track(3).bvid); assert.doesNotMatch(h.nodes.searchStatus.textContent, /late/);
  } finally { h.dispose(); }
});

test("search discards late pagination and edited draft results without changing the current list", async () => {
  const h = await fixture(); try {
    h.nodes.searchKeyword.value = "甲"; h.reply(async () => batch()); await h.search.runSearch();
    const old = deferred(); h.reply(() => old.promise); const p = h.search.loadMoreSearchResults();
    h.reply(async () => [track(50)]); await h.search.runSearch({ userKeyword: "乙" }); old.resolve(batch(21)); await p;
    assert.equal(h.state().results.length, 1); assert.equal(h.state().results[0].bvid, track(50).bvid);
    h.nodes.searchKeyword.value = "甲"; h.reply(async () => batch()); await h.search.runSearch();
    const draft = deferred(); h.reply(() => draft.promise); const q = h.search.loadMoreSearchResults(); h.nodes.searchKeyword.value = "草稿"; draft.resolve(batch(21)); await q;
    assert.equal(h.state().results.length, 20); assert.equal(h.state().page, 1); assert.equal(h.state().isLoadingMore, false);
  } finally { h.dispose(); }
});

test("search deduplicates pagination and extends only the queue with its matching source version", async () => {
  const h = await fixture(); try {
    h.nodes.searchKeyword.value = "甲"; h.reply(async () => batch()); await h.search.runSearch();
    h.player.queue = [track(1)]; h.player.queueSource = "search"; h.player.queueSearchVersion = h.state().requestVersion; h.player.currentIndex = 0; h.player.shuffle = true;
    h.reply(async () => [track(1), track(21), track(21), ...batch(22)]); await h.search.loadMoreSearchResults();
    assert.equal(h.state().results.length, 41); assert.equal(h.player.queue.length, 22); assert.equal(h.player.randomRemaining.length, 21);
    h.player.queueSearchVersion = -1; h.reply(async () => batch(80)); await h.search.loadMoreSearchResults(); assert.equal(h.player.queue.length, 22);
    h.reply(async () => [track(1), track(1)]); await h.search.loadMoreSearchResults(); assert.equal(h.state().hasMore, false); assert.equal(h.nodes.searchStatus.textContent, "没有更多了");
  } finally { h.dispose(); }
});

test("search division and sort clicks preserve hot versus keyword reranking parameters and draft", async () => {
  const h = await fixture(); try {
    h.reply(async () => [track(1)]); await h.musicTabs[1].fire("click"); await h.flush();
    let request = h.calls.filter(c => c.command === "search_videos").at(-1)!;
    assert.deepEqual(request.args, { keyword: "音乐", page: 1, tids: 28, rerank: false, order: "click" }); assert.equal(h.nodes.searchKeyword.value, "");
    assert.equal(h.calls.some(c => c.command === "record_search_history"), false);
    h.nodes.searchKeyword.value = " 输入 "; await h.musicTabs[2].fire("click"); await h.flush(); await h.sortModeTabs[1].fire("click"); await h.flush();
    request = h.calls.filter(c => c.command === "search_videos").at(-1)!; assert.deepEqual(request.args, { keyword: "输入", page: 1, tids: 31, rerank: true, sortMode: "title" });
    await h.sortModeTabs[1].fire("click"); await h.flush(); assert.equal(h.state().sortMode, "all"); assert.equal(h.nodes.searchKeyword.value, " 输入 ");
  } finally { h.dispose(); }
});

test("search history is fire and forget and restored search skips history while persisting only success", async () => {
  const h = await fixture("  上次  "); try {
    assert.equal(h.nodes.searchKeyword.value, "上次"); assert.equal(h.search.readLastSearchKeyword(), "上次");
    h.reply(async command => command === "record_search_history" ? new Promise(() => {}) : [track(1)]);
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.some(c => c.command === "record_search_history"), false); assert.match(h.nodes.searchStatus.textContent, /已复用上次搜索关键词「上次」刷新完成/);
    await h.search.runSearch({ userKeyword: "新", recordHistory: true }); assert.equal(h.nodes.searchButton.disabled, false); assert.equal(h.storage.get("bilibili-music.last-search"), "新");
    assert.equal(h.calls.filter(c => c.command === "record_search_history").length, 1);
    h.reply(async () => { throw new Error("failed"); }); await h.search.runSearch({ userKeyword: "失败" }); assert.equal(h.storage.get("bilibili-music.last-search"), "新");
  } finally { h.dispose(); }
});

test("search BV submit races discard the cancelled paste and preserve last-writer busy button semantics", async () => {
  const h = await fixture(); try {
    const cancel = deferred(); const search = deferred(); const prepare = deferred();
    h.reply(async command => command === "cancel_prepare_audio" ? cancel.promise : command === "search_videos" ? search.promise : command === "prepare_audio" ? prepare.promise : [{ page: 1, cid: 1, part: "P1", durationSeconds: 60 }]);
    h.nodes.searchKeyword.value = track(7).bvid; const paste = h.nodes.searchForm.fire("submit");
    h.nodes.searchKeyword.value = "新搜索"; const p = h.search.runSearch(); cancel.resolve(null); await paste;
    assert.equal(h.calls.some(c => c.command === "prepare_audio"), false); search.resolve([track(8)]); await p;
    assert.equal(h.state().results[0].bvid, track(8).bvid);
    h.nodes.searchKeyword.value = track(9).bvid; await h.nodes.searchForm.fire("submit"); await h.flush();
    assert.equal(h.state().results.length, 0); assert.equal(h.nodes.searchButton.disabled, true); assert.match(h.nodes.searchStatus.textContent, /已识别 BV 号/);
    h.reply(async command => command === "search_videos" ? [track(10)] : []); await h.search.runSearch({ userKeyword: "并行搜索" });
    assert.equal(h.nodes.searchButton.disabled, false, "search completion enables the shared button even while BV prepare is pending");
    prepare.resolve({ audioUrl: "http://127.0.0.1/audio/fixture", title: "播放", uploader: "作者", thumbnailUrl: "", durationSeconds: 90 }); await h.flush(); assert.equal(h.nodes.searchButton.disabled, false);
  } finally { h.dispose(); }
});

test("search playback metadata fills the display and queue consistently without rewriting the keyword", async () => {
  const h = await fixture(); try {
    const prepare = deferred(); h.nodes.searchKeyword.value = "搜索原值";
    h.reply(async command => command === "search_videos" ? [track(1)] : command === "prepare_audio" ? prepare.promise : [{ page: 1, cid: 1, part: "P1", durationSeconds: 60 }]);
    await h.search.runSearch(); const row = h.nodes.searchResults.children[0]; await row.children[0].fire("click"); await h.flush();
    assert.equal(h.nodes.searchButton.disabled, true);
    prepare.resolve({ audioUrl: "http://127.0.0.1/audio/fixture", title: "回填", uploader: "新作者", thumbnailUrl: "", durationSeconds: 90 }); await h.flush();
    assert.equal(h.state().results[0].title, "回填"); assert.equal(h.player.queue[0].title, "回填"); assert.equal(h.state().results[0].durationSeconds, 90);
    assert.equal(h.nodes.searchResults.children[0].children[0].children[2].children[0].textContent, "回填");
    assert.equal(h.nodes.searchKeyword.value, "搜索原值"); assert.equal(h.nodes.searchButton.disabled, false);
  } finally { h.dispose(); }
});
