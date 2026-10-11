import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { vueFeatureFlags } from "../../scripts/vue/features.ts";
import { vueRendererImports, disposeColdRendererBoundary } from "../helpers/vue-renderer-boundary.ts";
import { collectModuleGraph } from "../helpers/module-graph.ts";

const track = (i: number) => ({ bvid: "BV" + String(i).padStart(10, "0"), title: "曲目" + i, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: "2026-01-01" });
// get_video_meta: commands/media.rs:13; disabled commands: library/disabled_pages.rs:66,95,106.
const meta = { videos: 2, pages: [{ page: 1, cid: 11, part: "一", duration: 60 }, { page: 2, cid: 22, part: "二", duration: 90 }] };
function deferred() {
  let resolve: (value: unknown) => void = () => {}, reject: (error: unknown) => void = () => {};
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type EventFields = { detail?: number; key?: string; shiftKey?: boolean };
type Store = ReturnType<typeof import("../../ui/app-state.ts").createApplicationStore>;
type PageNodes = { pagesModal: HTMLElement; pagesModalClose: HTMLButtonElement; pagesModalRestoreAll: HTMLButtonElement; pagesModalList: HTMLUListElement; pagesModalSub: HTMLElement; pagesModalTitle: HTMLElement; pagesModalStatus: HTMLElement; playerPagesButton: HTMLButtonElement; status: HTMLElement };
type Pages = {
  bindTrackActivation(item: HTMLElement, button: HTMLButtonElement, video: ReturnType<typeof track>, play: (selection?: unknown) => void): void;
  changeDisabledPages(bvid: string, cid: number | null, disabled?: boolean): Promise<void>;
  closePagesModal(): void; openCurrentPagesModal(): void;
  getPagesSnapshot(): ReturnType<Store["getState"]>["pages"];
};
async function fixture() {
  const project = path.resolve(import.meta.dirname, "../.."), source = path.join(project, "ui");
  const tracked = new Set(execFileSync("git", ["ls-files", "--", "ui"], { cwd: project, encoding: "utf8" }).trim().split(/\r?\n/));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-pages-dom-"));
  const dom = new JSDOM(fs.readFileSync(path.join(source, "index.html"), "utf8"), { url: "http://127.0.0.1/" });
  const window = dom.window, doc = window.document;
  let now = 0, serial = 0;
  const timers = new Map<number, { at: number; callback: () => void }>(), frames = new Map<number, FrameRequestCallback>();
  const platform: { operation: string; target?: EventTarget; detail?: unknown }[] = [];
  const listeners: { target: EventTarget; type: string; callback: EventListenerOrEventListenerObject | null; options?: boolean | AddEventListenerOptions }[] = [];
  const nativeListen = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function(type, callback, options) {
    listeners.push({ target: this, type, callback, options }); platform.push({ operation: "addEventListener", target: this, detail: type });
    nativeListen.call(this, type, callback, options);
  };
  const calls: { command: string; args: Record<string, unknown>; at: number }[] = [];
  let reply: (command: string, args: Record<string, unknown>) => Promise<unknown> = async command => command === "get_ai_config" ? new Promise(() => {}) : command === "list_disabled_pages" || command === "get_cached_video_pages" ? {} : [];
  const observed = new Set<Element>();
  let intersection: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => {};
  class Observer {
    constructor(callback: typeof intersection) { intersection = callback; platform.push({ operation: "observer" }); }
    observe(target: Element) { observed.add(target); platform.push({ operation: "observe", target }); }
    unobserve(target: Element) { observed.delete(target); platform.push({ operation: "unobserve", target }); }
    disconnect() { observed.clear(); platform.push({ operation: "disconnect" }); }
  }
  const descriptors = new Map<string, PropertyDescriptor | undefined>([["__VUE__", Object.getOwnPropertyDescriptor(globalThis, "__VUE__")]]);
  let disposeVue: (() => void) | undefined;
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  const bridge = {
    regions: 0,
    regionCreated() { this.regions++; platform.push({ operation: "createSyncRegion" }); },
    current: track(1), pages: meta.pages.map(page => ({ ...page, durationSeconds: page.duration })), played: [] as unknown[],
    playObservations: [] as { selection: unknown; hidden: boolean; open: boolean; ariaHidden: string | null; modal: unknown; focus: Element | null }[],
    invoke(command: string, args: Record<string, unknown> = {}) { calls.push({ command, args, at: now }); return reply(command, args); },
    onPlay: (_selection: unknown) => {},
  };
  const originalFocus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function(options?: FocusOptions) { platform.push({ operation: "focus", target: this, detail: options }); originalFocus.call(this, options); };
  window.HTMLElement.prototype.scrollIntoView = function(options?: boolean | ScrollIntoViewOptions) { platform.push({ operation: "scrollIntoView", target: this, detail: options }); };
  for (const method of ["load", "pause", "play"] as const) {
    Object.defineProperty(window.HTMLMediaElement.prototype, method, { configurable: true, value() { platform.push({ operation: method, target: this }); return method === "play" ? Promise.resolve() : undefined; } });
  }
  Object.defineProperty(window, "IntersectionObserver", { value: Observer, configurable: true });
  window.setTimeout = ((callback: () => void, delay = 0) => { const id = ++serial; timers.set(id, { at: now + delay, callback }); platform.push({ operation: "setTimeout", detail: { id, delay } }); return id; }) as typeof window.setTimeout;
  window.clearTimeout = (id: number) => { timers.delete(id); platform.push({ operation: "clearTimeout", detail: id }); };
  window.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); platform.push({ operation: "requestAnimationFrame", detail: id }); return id; };
  window.cancelAnimationFrame = id => { frames.delete(id); platform.push({ operation: "cancelAnimationFrame", detail: id }); };
  for (const [name, value] of Object.entries({ __pagesFixture: bridge, window, document: doc, HTMLElement: window.HTMLElement, Element: window.Element, SVGElement: window.SVGElement, Node: window.Node, localStorage: window.localStorage, performance: { now: () => now }, requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame })) install(name, value);
  const warnings: unknown[][] = [], originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  const dispose = () => {
    disposeColdRendererBoundary(); disposeVue?.();
    for (const listener of listeners) listener.target.removeEventListener(listener.type, listener.callback, listener.options);
    listeners.length = 0; timers.clear(); frames.clear(); observed.clear(); window.close(); console.warn = originalWarn;
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    if (!root.startsWith(path.join(os.tmpdir(), "bili-pages-dom-"))) throw Error("Fixture cleanup outside temporary directory");
    fs.rmSync(root, { recursive: true, force: true });
  };
  const microtasks = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const fire = async (target: EventTarget, type: string, fields: EventFields = {}) => {
    const options = { bubbles: true, cancelable: true, ...fields };
    const event = type.startsWith("key") ? new window.KeyboardEvent(type, options) : ["click", "dblclick"].includes(type) ? new window.MouseEvent(type, options) : new window.Event(type, options);
    platform.push({ operation: "dispatchEvent", target, detail: { type, ...fields } }); target.dispatchEvent(event); await microtasks(); return event;
  };
  Object.defineProperty(window.HTMLElement.prototype, "fire", { value(this: HTMLElement, type: string, fields?: EventFields) { return fire(this, type, fields); }, configurable: true });
  try {
    if (!tracked.has("ui/index.html")) throw Error("Untracked fixture HTML");
    for (const name of collectModuleGraph(source, ["main.ts"])) {
      if (!tracked.has("ui/" + name)) throw Error(`Untracked source: ${name}`);
      fs.copyFileSync(path.join(source, name), path.join(root, name));
    }
    for (const name of [".local-data", "cookies.txt", "tools"]) if (fs.existsSync(path.join(root, name))) throw Error(`Runtime file in fixture: ${name}`);
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(root, "runtime-api.ts"), 'const invoke = globalThis.__pagesFixture.invoke; export { invoke };');
    for (const name of ["playback-core.ts", "appearance.ts", "playback-notice.ts", "playback-diagnostics.ts"]) {
      const exports = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, name), "utf8"))![1].split(",").map(x => x.trim()).filter(Boolean);
      const bodies: Record<string, string> = { currentPlayableTrack: 'return globalThis.__pagesFixture.current;', currentVideoPage: 'return globalThis.__pagesFixture.pages[0];', hasMultipleCurrentPages: 'return globalThis.__pagesFixture.pages.length > 1;', playCurrentVideoPage: 'globalThis.__pagesFixture.onPlay(arguments[0]);', isLoudnessNormalizationEnabled: 'return false;' };
      fs.writeFileSync(path.join(root, name), exports.map(x => 'function '+x+'() {'+(bodies[x] ?? '')+'}').join("\n")+'\nexport { '+exports.join(", ")+' };');
    }
    for (const entry of vueRendererImports) {
      const name = path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), entry.specifier));
      if (!tracked.has("ui/" + name)) throw Error(`Untracked renderer source: ${name}`);
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.copyFileSync(path.join(source, name), path.join(root, name));
    }
    const syncFile = path.join(root, "vue/sync-region.ts");
    const syncSource = fs.readFileSync(syncFile, "utf8");
    const signature = /function createSyncRegion[^\n]+\{/;
    if (!signature.test(syncSource)) throw Error("Missing real region constructor for call tracing");
    fs.writeFileSync(syncFile, syncSource.replace(signature, "$& globalThis.__pagesFixture.regionCreated();"));
    fs.writeFileSync(path.join(root, "fixture-entry.ts"), 'import "./main.ts"; export * as nodes from "./player-dom.ts"; export * as pages from "./video-pages.ts"; export * as library from "./library-ui.ts"; export * as home from "./home.ts"; import { render } from "vue"; export function disposeVue() { render(null, document.getElementById("pages-modal-list")); }');
    await build({ configFile: false, root, plugins: [vue()], logLevel: "silent", define: vueFeatureFlags,
      resolve: { alias: { vue: path.join(project, "node_modules/vue/dist/vue.runtime.esm-bundler.js") } },
      build: { outDir: path.join(root, "compiled"), minify: false, lib: { entry: path.join(root, "fixture-entry.ts"), formats: ["es"], fileName: "fixture" } },
    });
    const compiled = await import(pathToFileURL(path.join(root, "compiled/fixture.js")).href) as { nodes: PageNodes; pages: Pages; library: { loadLibrary(): Promise<void> }; home: { getApplicationStore(): Store }; disposeVue(): void };
    const { nodes, pages, library, home } = compiled;
    disposeVue = compiled.disposeVue;
    const store = home.getApplicationStore(); store.actions.playbackSession.setCurrentPages(bridge.pages);
    bridge.onPlay = selection => {
      bridge.playObservations.push({ selection, hidden: Boolean(nodes.pagesModal.hidden), open: nodes.pagesModal.classList.contains("is-open"), ariaHidden: nodes.pagesModal.getAttribute("aria-hidden"), modal: pages.getPagesSnapshot().modal, focus: doc.activeElement });
      bridge.played.push(selection);
    };
    // Preserve legacy status setup through the real action and native textContent accessor.
    const textContent = Object.getOwnPropertyDescriptor(window.Node.prototype, "textContent")!;
    Object.defineProperty(nodes.status, "textContent", { get() { return textContent.get!.call(this); }, set(value: string) {
      textContent.set!.call(this, value); if (value !== store.getState().playbackMessages.status) store.actions.playbackMessages.setStatus(value);
    }, configurable: true });
    const h = { pages, library, nodes, doc, store, calls, observed, bridge, platform, warnings, dispose, fire, microtasks,
      reply(next: typeof reply) { reply = next; },
      visible(item: Element, isIntersecting = true) { platform.push({ operation: "intersection", target: item, detail: isIntersecting }); intersection([{ target: item, isIntersecting }]); },
      raf() { const pending = [...frames]; frames.clear(); for (const [id, callback] of pending) { platform.push({ operation: "animationFrame", detail: id }); callback(now); } },
      async flush() { await microtasks(); while (frames.size) h.raf(); },
      async advance(delay: number) { const end = now + delay; while (true) { const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]; if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].callback(); await h.flush(); } now = end; await h.flush(); },
      row(i: number, played: unknown[] = []) { const item = doc.createElement("li"), button = doc.createElement("button"), actions = doc.createElement("div"); button.className = "track"; actions.className = "track-actions"; item.append(button, actions); doc.body.append(item); pages.bindTrackActivation(item, button, track(i), selection => played.push(selection ?? "play")); return { item, button, actions, played }; },
      escape: () => fire(window, "keydown", { key: "Escape" }),
    };
    await h.flush(); calls.length = 0; platform.length = 0; return h;
  } catch (error) { dispose(); throw error; }
}

export { fixture, deferred, track, meta };
