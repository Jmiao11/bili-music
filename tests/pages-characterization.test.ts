import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { collectModuleGraph } from "./helpers/module-graph.ts";

type Transfer = { effectAllowed: string; dropEffect: string; setData(type: string, value: string): void };
type FixtureEvent = { type: string; target: LibraryNode; currentTarget: LibraryNode; dataTransfer?: Transfer | null; relatedTarget?: LibraryNode | null; key?: string; shiftKey?: boolean; detail?: unknown; defaultPrevented: boolean; stopped: boolean; immediate: boolean; preventDefault(): void; stopPropagation(): void; stopImmediatePropagation(): void };
class LibraryNode {
  value = ""; textContent = ""; innerHTML = ""; className = ""; hidden = false; disabled = false; draggable = false; title = "";
  dataset: Record<string, string> = {}; attributes = new Map<string, string>(); classes = new Set<string>();
  children: LibraryNode[] = []; parent: LibraryNode | null = null;
  listeners = new Map<string, { callback: (event: FixtureEvent) => unknown; capture: boolean }[]>();
  style = { setProperty() {}, removeProperty() {} };
  paused = true; currentTime = 0; duration = 60; readyState = 1; src = "";
  tag: string;
  constructor(tag = "div") { this.tag = tag; }
  isConnected = true;
  get parentElement() { return this.parent; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  closest(selector: string): LibraryNode | null { return this.classList.contains(selector.slice(1)) ? this : this.parent?.closest(selector) ?? null; }
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
  querySelectorAll(selector: string): LibraryNode[] { return this.children.flatMap(n => [n, ...n.querySelectorAll("*")]).filter(n => selector === "*" || selector.startsWith(".") && n.classList.contains(selector.slice(1)) || selector === "button.track" && n.tag === "button" && n.classList.contains("track") || selector === n.tag || selector === "button:not([disabled])" && n.tag === "button" && !n.disabled || selector === 'button[aria-current="true"]' && n.tag === "button" && n.getAttribute("aria-current") === "true"); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  contains(n: LibraryNode | null): boolean { return n === this || this.children.some(child => child.contains(n)); }
  pause() { this.paused = true; } load() {} async play() { this.paused = false; }
  focus() { (globalThis.document as unknown as { activeElement: LibraryNode }).activeElement = this; } select() {} scrollIntoView() {}
  click() { void this.fire("click"); }
  *[Symbol.iterator](): IterableIterator<LibraryNode> {}
}
function deferred() { let resolve: (value: unknown) => void = () => {}; let reject: (error: unknown) => void = () => {}; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const track = (i: number) => ({ bvid: "BV" + String(i).padStart(10, "0"), title: "曲目" + i, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: "2026-01-01" });
const meta = { videos: 2, pages: [{ page: 1, cid: 11, part: "一", duration: 60 }, { page: 2, cid: 22, part: "二", duration: 90 }] };
async function fixture() {
  const source = path.join(import.meta.dirname, "../ui"), root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-pages-characterization-"));
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, "player-dom.ts"), "utf8"))![1].split(",").map(x => x.trim()).filter(Boolean);
  const nodes: Record<string, LibraryNode> = Object.fromEntries(names.map(name => [name, new LibraryNode()]));
  nodes.pagesModal.hidden = true;
  const documentNode = new LibraryNode(), windowNode = new LibraryNode(), frames: (() => void)[] = [], rows: LibraryNode[] = [];
  const doc = { createElement: (tag: string) => new LibraryNode(tag), querySelectorAll: () => rows.flatMap(row => row.querySelectorAll("button.track")), querySelector: () => new LibraryNode(), addEventListener: documentNode.addEventListener.bind(documentNode), hidden: false, activeElement: new LibraryNode("button") };
  let now = 0, serial = 0; const timers = new Map<number, { at: number; callback: () => void }>();
  const calls: { command: string; args: Record<string, unknown>; at: number }[] = [];
  let reply: (command: string, args: Record<string, unknown>) => Promise<unknown> = async command => command === "get_ai_config" ? new Promise(() => {}) : command === "list_disabled_pages" || command === "get_cached_video_pages" ? {} : [];
  let intersection: (entries: { target: LibraryNode; isIntersecting: boolean }[]) => void = () => {};
  const observed = new Set<LibraryNode>();
  class Observer { constructor(callback: typeof intersection) { intersection = callback; } observe(node: LibraryNode) { observed.add(node); } unobserve(node: LibraryNode) { observed.delete(node); } }
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => { globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  const bridge = { nodes, current: track(1), pages: meta.pages.map(p => ({ ...p, durationSeconds: p.duration })), played: [] as unknown[], invoke(command: string, args: Record<string, unknown> = {}) { calls.push({ command, args, at: now }); return reply(command, args); } };
  install("__pagesFixture", bridge); install("document", doc); install("performance", { now: () => now }); install("HTMLElement", LibraryNode);
  install("window", { IntersectionObserver: Observer, addEventListener: windowNode.addEventListener.bind(windowNode), dispatchEvent() {}, recordPlaybackDiag() {}, setTimeout(callback: () => void, delay: number) { const id = ++serial; timers.set(id, { at: now + delay, callback }); return id; }, clearTimeout(id: number) { timers.delete(id); } });
  install("localStorage", { getItem: () => null, setItem() {} }); install("requestAnimationFrame", (callback: () => void) => { frames.push(callback); return frames.length; });
  const warn = console.warn; console.warn = () => {};
  const dispose = () => { console.warn = warn; for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } fs.rmSync(root, { recursive: true, force: true }); };
  try {
    for (const name of collectModuleGraph(source, ["main.ts"])) fs.copyFileSync(path.join(source, name), path.join(root, name));
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(root, "runtime-api.ts"), 'const invoke = globalThis.__pagesFixture.invoke; export { invoke };');
    fs.writeFileSync(path.join(root, "player-dom.ts"), 'const { '+names.join(", ")+' } = globalThis.__pagesFixture.nodes; export { '+names.join(", ")+' };');
    for (const name of ["playback-core.ts", "appearance.ts", "playback-notice.ts", "playback-diagnostics.ts"]) {
      const exports = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, name), "utf8"))![1].split(",").map(x => x.trim()).filter(Boolean);
      const bodies: Record<string, string> = { currentPlayableTrack: 'return globalThis.__pagesFixture.current;', currentVideoPage: 'return globalThis.__pagesFixture.pages[0];', hasMultipleCurrentPages: 'return true;', playCurrentVideoPage: 'globalThis.__pagesFixture.played.push(arguments[0]);', isLoudnessNormalizationEnabled: 'return false;' };
      fs.writeFileSync(path.join(root, name), exports.map(x => 'function '+x+'() {'+(bodies[x] ?? '')+'}').join("\n")+'\nexport { '+exports.join(", ")+' };');
    }
    await import(pathToFileURL(path.join(root, "main.ts")).href);
    const pages = await import(pathToFileURL(path.join(root, "video-pages.ts")).href) as { bindTrackActivation(item: LibraryNode, button: LibraryNode, video: ReturnType<typeof track>, play: (selection?: unknown) => void): void; changeDisabledPages(bvid: string, cid: number | null, disabled?: boolean): Promise<void>; closePagesModal(): void; openCurrentPagesModal(): void };
    const library = await import(pathToFileURL(path.join(root, "library-ui.ts")).href) as { loadLibrary(): Promise<void> };
    const home = await import(pathToFileURL(path.join(root, "home.ts")).href) as { getApplicationStore(): ReturnType<typeof import("../ui/app-state.ts").createApplicationStore> }; home.getApplicationStore().actions.playbackSession.setCurrentPages(bridge.pages);
    // Legacy status initialization -> real action; renderer output already matches the snapshot.
    let statusText = nodes.status.textContent;
    Object.defineProperty(nodes.status, "textContent", { get: () => statusText, set(value: string) {
      statusText = value; const store = home.getApplicationStore();
      if (value !== store.getState().playbackMessages.status) store.actions.playbackMessages.setStatus(value);
    } });
    const h = { pages, library, nodes, doc, calls, observed, bridge, dispose,
      reply(next: typeof reply) { reply = next; }, visible(item: LibraryNode, isIntersecting = true) { intersection([{ target: item, isIntersecting }]); },
      async flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); while (frames.length) frames.shift()?.(); },
      async advance(delay: number) { const end = now + delay; while (true) { const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].callback(); await h.flush(); } now = end; await h.flush(); },
      row(i: number, played: unknown[] = []) { const item = new LibraryNode("li"), button = new LibraryNode("button"), actions = new LibraryNode(); button.className = "track"; actions.className = "track-actions"; item.append(button, actions); rows.push(item); pages.bindTrackActivation(item, button, track(i), selection => played.push(selection ?? "play")); return { item, button, actions, played }; },
      escape: () => windowNode.fire("keydown", { key: "Escape" }),
    };
    await h.flush(); calls.length = 0; return h;
  } catch (error) { dispose(); throw error; }
}

test("pages visible queries keep concurrency two interval 300ms and deduplicate failures", async () => {
  const h = await fixture(); try {
    const a = h.row(1), b = h.row(2), c = h.row(3), gates = [deferred(), deferred(), deferred()]; let index = 0;
    h.reply(async command => command === "get_cached_video_pages" ? {} : gates[index++].promise); await h.advance(0);
    assert.equal(h.observed.size, 3); assert.equal(h.calls.filter(c => c.command === "get_video_meta").length, 0);
    h.visible(a.item); h.visible(b.item); h.visible(c.item); await h.advance(299); assert.equal(index, 1);
    await h.advance(1); assert.equal(index, 2); await h.advance(600); assert.equal(index, 2);
    gates[0].reject(Error("失败")); await h.flush(); assert.equal(index, 3); assert.deepEqual(h.calls.filter(c => c.command === "get_video_meta").map(c => c.at), [0, 300, 900]);
    h.visible(a.item); await h.advance(300); assert.equal(index, 3); assert.equal(h.observed.has(a.item), false);
    gates[1].resolve(meta); gates[2].resolve(meta); await h.flush(); assert.equal(b.actions.children[0].textContent, "2P");
  } finally { h.dispose(); }
});
test("pages cached metadata precedes visibility lookup and opens without another request", async () => {
  const h = await fixture(); try {
    h.reply(async command => command === "get_cached_video_pages" ? { [track(1).bvid]: meta } : []); const row = h.row(1); await h.advance(0);
    assert.equal(h.observed.size, 0); assert.equal(row.actions.children[0].textContent, "2P"); await row.actions.children[0].fire("click"); await h.flush();
    assert.equal(h.calls.filter(c => c.command === "get_video_meta").length, 0); assert.equal(h.nodes.pagesModalList.children.length, 2); assert.equal(h.nodes.pagesModal.hidden, false);
  } finally { h.dispose(); }
});
test("pages visibility lost before scheduled lookup prevents querying hidden row", async () => {
  const h = await fixture(); try {
    const a = h.row(1), b = h.row(2); const gate = deferred(); h.reply(async command => command === "get_cached_video_pages" ? {} : gate.promise); await h.advance(0);
    h.visible(a.item); h.visible(b.item); h.visible(b.item, false); await h.advance(300); assert.equal(h.calls.filter(c => c.command === "get_video_meta").length, 1); gate.resolve(meta); await h.flush();
  } finally { h.dispose(); }
});
test("pages single click delays 250ms double click cancels play and keyboard click plays immediately", async () => {
  const h = await fixture(); try {
    h.reply(async command => command === "get_cached_video_pages" ? {} : meta); const row = h.row(1);
    await row.button.fire("click", { detail: 1 }); await h.advance(249); assert.equal(row.played.length, 0); await h.advance(1); assert.deepEqual(row.played, ["play"]);
    await row.button.fire("click", { detail: 1 }); await row.item.fire("dblclick"); await h.advance(300); assert.equal(row.played.length, 1); assert.equal(h.nodes.pagesModal.classList.contains("is-open"), true);
    await row.button.fire("click", { detail: 0 }); assert.equal(row.played.length, 2);
  } finally { h.dispose(); }
});
test("pages modal keeps Escape Tab Shift Tab animation and return focus behavior", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); await h.flush(); 
    // The exported DOM fixture nodes are independent, so assemble the real modal containment used by focus trapping.
    h.nodes.pagesModalClose.tag = "button"; h.nodes.pagesModalRestoreAll.tag = "button"; h.nodes.pagesModal.append(h.nodes.pagesModalClose, h.nodes.pagesModalList, h.nodes.pagesModalRestoreAll);
    const focusable = h.nodes.pagesModal.querySelectorAll("button:not([disabled])"), last = focusable.at(-1)!;
    focusable[0].focus(); const backward = await h.nodes.pagesModal.fire("keydown", { key: "Tab", shiftKey: true }); assert.equal(backward.defaultPrevented, true); assert.equal(h.doc.activeElement, last);
    const forward = await h.nodes.pagesModal.fire("keydown", { key: "Tab" }); assert.equal(forward.defaultPrevented, true); assert.equal(h.doc.activeElement, focusable[0]);
    assert.equal(h.nodes.pagesModalList.children.length, 2); assert.equal(h.nodes.pagesModalList.querySelector('button[aria-current="true"]')?.textContent.includes("当前"), true);
    await h.escape(); assert.equal(h.nodes.pagesModal.classList.contains("is-open"), false); assert.equal(h.doc.activeElement, h.nodes.playerPagesButton); assert.equal(h.nodes.pagesModal.hidden, false);
    await h.nodes.pagesModal.fire("transitionend"); assert.equal(h.nodes.pagesModal.hidden, true);
  } finally { h.dispose(); }
});
test("pages disabled preferences optimistically update rollback reject duplicates and restore all", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); await h.flush(); const gate = deferred(); h.reply(() => gate.promise);
    const pending = h.pages.changeDisabledPages(track(1).bvid, 11, true); await h.flush(); assert.equal(h.nodes.pagesModalList.children[0].classList.contains("is-disabled"), true); assert.equal(h.nodes.pagesModalList.children[0].children[1].disabled, true);
    await h.pages.changeDisabledPages(track(1).bvid, 22, true); assert.equal(h.calls.length, 1); gate.reject(Error("写入失败")); await pending;
    assert.equal(h.nodes.pagesModalList.children[0].classList.contains("is-disabled"), false); assert.match(h.nodes.pagesModalStatus.textContent, /保存分P设置失败：.*写入失败/); assert.equal(h.nodes.pagesModalList.children[0].children[1].disabled, false);
    h.reply(async () => []); await h.pages.changeDisabledPages(track(1).bvid, 11, true); assert.equal(h.nodes.pagesModalRestoreAll.hidden, false);
    await h.nodes.pagesModalRestoreAll.fire("click"); await h.flush(); assert.equal(h.calls.at(-1)?.command, "clear_disabled_pages"); assert.equal(h.nodes.pagesModalRestoreAll.hidden, true);
    assert.deepEqual(h.calls[0].args, { bvid: track(1).bvid, cid: 11, disabled: true });
  } finally { h.dispose(); }
});
test("pages restore all pending preserves visible button busy text and rolls back on failure", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); await h.flush(); h.reply(async () => []); await h.pages.changeDisabledPages(track(1).bvid, 11, true);
    const gate = deferred(); h.reply(() => gate.promise); const pending = h.pages.changeDisabledPages(track(1).bvid, null); await h.flush();
    assert.equal(h.nodes.pagesModalRestoreAll.hidden, false); assert.equal(h.nodes.pagesModalRestoreAll.disabled, true); assert.equal(h.nodes.pagesModalRestoreAll.textContent, "恢复中…");
    gate.reject(Error("失败")); await pending; assert.equal(h.nodes.pagesModalList.children[0].classList.contains("is-disabled"), true); assert.equal(h.nodes.pagesModalRestoreAll.disabled, false); assert.equal(h.nodes.pagesModalRestoreAll.textContent, "全部恢复");
  } finally { h.dispose(); }
});
test("pages query restores captured status even after another writer and track change", async () => {
  const h = await fixture(); try {
    const row = h.row(1), gate = deferred(); h.reply(() => gate.promise); h.nodes.status.textContent = "查询前提示";
    await row.item.fire("dblclick"); await h.flush(); assert.equal(h.nodes.status.textContent, "正在获取分P信息…"); assert.equal(row.button.getAttribute("aria-busy"), "true");
    h.nodes.status.textContent = "其他模块的新提示"; h.bridge.current = track(2); gate.resolve(meta); await h.flush();
    assert.equal(h.nodes.status.textContent, "查询前提示"); assert.match(h.nodes.pagesModalSub.textContent, /曲目1/); assert.equal(row.button.getAttribute("aria-busy"), null);
  } finally { h.dispose(); }
});
test("pages newest modal query discards late old metadata and shares first captured status", async () => {
  const h = await fixture(); try {
    const a = h.row(1), b = h.row(2), first = deferred(), second = deferred(); h.reply((_c, args) => args.bvid === track(1).bvid ? first.promise : second.promise);
    h.nodes.status.textContent = "最初提示"; await a.item.fire("dblclick"); await h.flush(); h.nodes.status.textContent = "中途提示"; await b.item.fire("dblclick"); await h.flush();
    first.resolve(meta); await h.flush(); assert.equal(h.nodes.pagesModal.hidden, true); assert.equal(h.nodes.pagesModalList.children.length, 0); assert.equal(a.button.getAttribute("aria-busy"), null);
    second.resolve(meta); await h.flush(); assert.equal(h.nodes.status.textContent, "最初提示"); assert.match(h.nodes.pagesModalSub.textContent, /曲目2/); assert.equal(h.nodes.pagesModalList.children.length, 2);
  } finally { h.dispose(); }
});
test("pages query failure and one page result retain existing status messages", async () => {
  const h = await fixture(); try {
    const row = h.row(1); h.reply(async () => { throw Error("失败"); }); await row.item.fire("dblclick"); await h.flush(); assert.equal(h.nodes.status.textContent, "获取分P信息失败"); assert.equal(h.nodes.pagesModalList.children.length, 0);
    h.reply(async () => ({ videos: 1, pages: [meta.pages[0]] })); await row.item.fire("dblclick"); await h.flush(); assert.equal(h.nodes.status.textContent, "该视频只有一个分P"); assert.equal(h.nodes.pagesModalList.children.length, 0);
  } finally { h.dispose(); }
});