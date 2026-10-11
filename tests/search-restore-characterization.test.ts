import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { installColdRendererBoundary } from "./helpers/vue-renderer-boundary.ts";

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

const track = (index: number) => ({ bvid: "BV" + String(index).padStart(10, "0"), title: "曲目" + index, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, playCount: 1, pubdate: 1 });

type Snapshot = { results: ReturnType<typeof track>[]; requestVersion: number; page: number; isLoadingMore: boolean; hasMore: boolean; tids: number; sortMode: string; rerank: boolean; userKeyword: string; requestKeyword: string };

async function fixture(saved = "", draft = "") {
  const source = path.join(import.meta.dirname, "../ui");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-search-characterization-"));
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, "player-dom.ts"), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean);
  assert.ok(names);
  const nodes: Record<string, SearchNode> = Object.fromEntries(names.map(name => [name, new SearchNode()]));
  nodes.result.hidden = true; nodes.searchKeyword.value = draft;
  const musicTabs = [3, 28, 31, 30, 59, 267].map(tids => { const n = new SearchNode(); n.dataset.tids = String(tids); return n; });
  const sortModeTabs = ["all", "title", "description"].map(sortMode => { const n = new SearchNode(); n.dataset.sortMode = sortMode; return n; });
  const documentNode = new SearchNode(); const windowNode = new SearchNode();
  const storage = new Map(saved ? [["bilibili-music.last-search", saved]] : []);
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  let reply: (command: string, args: Record<string, unknown>) => Promise<unknown> = async command => {
    if (command === "get_ai_config") return new Promise(() => {});
    
    
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
    installColdRendererBoundary();
    for (const name of fs.readdirSync(source).filter(name => name.endsWith(".ts"))) fs.copyFileSync(path.join(source, name), path.join(root, name));
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
    const home = await import(pathToFileURL(path.join(root, "home.ts")).href) as { getApplicationStore(): ReturnType<typeof import("../ui/app-state.ts").createApplicationStore> };
    const queueStore = home.getApplicationStore();
    return { store: queueStore, search, queueActions: queueStore.actions.playbackQueue, get player() { return queueStore.getState().playbackQueue; }, state: () => search.getSearchSnapshot ? search.getSearchSnapshot() : states.searchState!, nodes, musicTabs, sortModeTabs, calls, storage, windowNode, dispose,
      reply(next: typeof reply) { reply = next; }, async flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); } };
  } catch (failure) { dispose(); throw failure; }
}


// search_videos 返回 SearchVideo[]：src-tauri/src/search.rs:32；本批回复空结果，不涉及格式猜测。
test("search restore writes saved keyword into the startup draft and restores only once without history", async () => {
  const h = await fixture("  恢复词  "); try {
    assert.equal(h.nodes.searchKeyword.value, "恢复词");
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    const requests = h.calls.filter(x => x.command === "search_videos");
    assert.equal(requests.length, 1); assert.equal(requests[0].args.keyword, "恢复词");
    assert.equal(h.calls.filter(x => x.command === "record_search_history").length, 0);
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 1);
  } finally { h.dispose(); }
});
test("search restore consumes pending keyword even when existing results prevent the first restore", async () => {
  const h = await fixture("恢复词"); try {
    h.store.actions.search.appendResults([track(1)]);
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
    h.store.actions.search.resetForBv();
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
  } finally { h.dispose(); }
});
test("search restore consumes pending keyword after draft edit and never restores on a later navigation", async () => {
  const h = await fixture("恢复词"); try {
    h.nodes.searchKeyword.value = "用户草稿";
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
    h.nodes.searchKeyword.value = "恢复词";
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
  } finally { h.dispose(); }
});
test("search restore clears the pending value before reading the draft in a reentrant navigation", async () => {
  const h = await fixture("恢复词"); try {
    let reads = 0;
    Object.defineProperty(h.nodes.searchKeyword, "value", { configurable: true, get() {
      if (reads++ === 0) void h.windowNode.fire("bilibili-music-viewchange", { view: "search" });
      return "恢复词";
    } });
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 1);
    assert.equal(h.calls.filter(x => x.command === "record_search_history").length, 0);
  } finally { h.dispose(); }
});
test("search restore does nothing without a saved keyword or when the startup draft already exists", async () => {
  for (const [saved, draft] of [["", ""], ["恢复词", "已有草稿"]]) {
    const h = await fixture(saved, draft); try {
      assert.equal(h.nodes.searchKeyword.value, draft);
      await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
      assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
    } finally { h.dispose(); }
  }
});
