import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { vueFeatureFlags } from "../../scripts/vue/features.ts";

// Rust camelCase output: library.rs:42-49, playlists.rs:12-16; timestamp library.rs:329.
const track = (i: number) => ({ bvid: "BV" + String(i).padStart(10, "0"), title: "曲目" + i, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: "1760000000000" });
const playlist = (id: string, name = "歌单" + id, items = [track(1)]) => ({ id, name, items, createdAt: "1760000000000" });
// fav_import.rs:64-73; unavailable.rs:15-26 (markedAt is a JSON number).
const importPage = { mediaId: "123", title: "公开收藏夹", total: 1, items: [track(2)], skipped: 0, duplicates: 0, scanned: 1, hasMore: false, truncated: false };
const unavailable = [{ bvid: track(1).bvid, reason: "该视频已被删除或设为私密", markedAt: 1760000000000 }];
function deferred() {
  let resolve: (value: unknown) => void = () => {}, reject: (reason: unknown) => void = () => {};
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Reply = (command: string, args: Record<string, unknown>) => Promise<unknown>;
type Store = ReturnType<typeof import("../../ui/app-state.ts").createApplicationStore>;
type Modules = { library: { loadLibrary: () => Promise<void>; closeLibraryModal: () => void; createPlaylist: () => void }; nodes: typeof import("../../ui/player-dom.ts"); store: Store };

async function fixture() {
  const project = path.resolve(import.meta.dirname, "../.."), source = path.join(project, "ui");
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "ui"], { cwd: project, encoding: "utf8" }).split("\0").filter(Boolean);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-library-modal-dom-"));
  for (const file of tracked) {
    const target = path.join(root, file.slice(3)); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(project, file), target);
  }
  for (const name of [".local-data", "cookies.txt", "tools"]) if (fs.existsSync(path.join(root, name))) throw Error("Runtime data in library fixture: " + name);
  const dom = new JSDOM(fs.readFileSync(path.join(source, "index.html"), "utf8"), { url: "http://127.0.0.1/" });
  const window = dom.window as typeof dom.window & { CompositionEvent: typeof CompositionEvent; InputEvent: typeof InputEvent; CustomEvent: typeof CustomEvent; MutationObserver: typeof MutationObserver };
  const doc = window.document, frames = new Map<number, FrameRequestCallback>(), timers = new Map<number, { callback: () => void; delay: number }>();
  const platform: { operation: string; target?: EventTarget; detail?: unknown }[] = [], calls: { command: string; args: Record<string, unknown> }[] = [];
  const listeners: { target: EventTarget; type: string; callback: EventListenerOrEventListenerObject | null; options?: boolean | AddEventListenerOptions }[] = [];
  const descriptors = new Map<string, PropertyDescriptor | undefined>([["__VUE__", Object.getOwnPropertyDescriptor(globalThis, "__VUE__")]]);
  const mutations: MutationObserver[] = [];
  class NativeMutationObserver extends window.MutationObserver { constructor(callback: MutationCallback) { super(callback); mutations.push(this); } }
  let serial = 0;
  const install = (name: string, value: unknown) => { descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  // Only startup IPC responses; business commands require an explicit test reply.
  // library.rs:42; playlists.rs:12; disabled_pages.rs:106; ai.rs:75; shortcut_config.rs:31;
  // audio_cache.rs:60,67; commands/runtime.rs:7,13. No API keys or runtime files are read.
  const startup: Reply = async command => {
    if (["list_favorites", "list_playlists", "list_unavailable_tracks"].includes(command)) return [];
    if (["list_disabled_pages", "get_cached_video_pages"].includes(command)) return {};
    if (command === "get_ai_config") return { apiFormat: "openai", baseUrl: "", model: "", hasKey: false, keyHint: null };
    if (command === "get_shortcuts") return { version: 1, bindings: { previous: null, playPause: null, next: null, volumeUp: null, volumeDown: null } };
    if (command === "get_audio_cache_settings") return { enabled: false, maxBytes: 1073741824 };
    if (command === "get_audio_cache_usage") return { bytes: 0, items: 0 };
    if (command === "get_yt_dlp_availability") return { available: true };
    if (command === "get_stream_source") return "auto";
    if (command === "set_taskbar_playback_state") return null;
    throw Error("Unconfigured fixture IPC: " + command);
  };
  let reply = startup;
  const nativeListen = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function(type, callback, options) { listeners.push({ target: this, type, callback, options }); nativeListen.call(this, type, callback, options); };
  const nativeFocus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function(options?: FocusOptions) { platform.push({ operation: "focus", target: this, detail: options }); nativeFocus.call(this, options); };
  window.HTMLElement.prototype.scrollIntoView = function(options?: boolean | ScrollIntoViewOptions) { platform.push({ operation: "scrollIntoView", target: this, detail: options }); };
  for (const method of ["play", "pause", "load"] as const) Object.defineProperty(window.HTMLMediaElement.prototype, method, { configurable: true, value() { platform.push({ operation: method, target: this }); return method === "play" ? Promise.resolve() : undefined; } });
  window.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); platform.push({ operation: "requestAnimationFrame", detail: id }); return id; };
  window.cancelAnimationFrame = id => { frames.delete(id); platform.push({ operation: "cancelAnimationFrame", detail: id }); };
  window.setTimeout = ((callback: () => void, delay = 0) => { const id = ++serial; timers.set(id, { callback, delay }); platform.push({ operation: "setTimeout", detail: { id, delay } }); return id; }) as typeof window.setTimeout;
  window.clearTimeout = id => { if (id !== undefined) timers.delete(id); };
  class Observer {
    constructor() { platform.push({ operation: "observer" }); }
    observe(target: Element) { platform.push({ operation: "observe", target }); }
    unobserve(target: Element) { platform.push({ operation: "unobserve", target }); }
    disconnect() { platform.push({ operation: "disconnect" }); }
  }
  Object.defineProperty(window, "__TAURI__", { value: { core: { invoke(command: string, args: Record<string, unknown> = {}) { calls.push({ command, args }); return reply(command, args); } }, event: { async listen(name: string) { platform.push({ operation: "tauri.listen", detail: name }); return () => platform.push({ operation: "tauri.unlisten", detail: name }); } } } });
  for (const [name, value] of Object.entries({ window, document: doc, localStorage: window.localStorage, sessionStorage: window.sessionStorage, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, SVGElement: window.SVGElement, Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent, IntersectionObserver: Observer, ResizeObserver: Observer, MutationObserver: NativeMutationObserver, requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame, performance: { now: () => 0 } })) install(name, value);
  const microtasks = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const fire = async (target: EventTarget, type: string, fields: KeyboardEventInit & InputEventInit & CompositionEventInit = {}) => {
    const options = { bubbles: true, cancelable: true, ...fields };
    const event = type.startsWith("composition") ? new window.CompositionEvent(type, options) : type === "input" ? new window.InputEvent(type, options) : type.startsWith("key") ? new window.KeyboardEvent(type, options) : new window.Event(type, options);
    target.dispatchEvent(event); await microtasks(); return event;
  };
  const raf = () => { const pending = [...frames]; frames.clear(); for (const [, callback] of pending) callback(0); };
  const dispose = () => {
    for (const listener of listeners) listener.target.removeEventListener(listener.type, listener.callback, listener.options);
    for (const observer of mutations) observer.disconnect();
    listeners.length = 0; frames.clear(); timers.clear(); window.close();
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("bili-library-modal-dom-")) throw Error("Unsafe library fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(root, "fixture-entry.ts"), 'import "./root-mount.ts"; import "./main.ts"; import { startAppearance } from "./appearance.ts"; startAppearance(); export * as library from "./library-ui.ts"; export * as nodes from "./player-dom.ts"; import { getApplicationStore } from "./home.ts"; export const store = getApplicationStore();');
    await build({ configFile: false, root, logLevel: "silent", plugins: [vue()], define: vueFeatureFlags, resolve: { alias: { vue: path.join(project, "node_modules/vue/dist/vue.runtime.esm-bundler.js") } }, build: { outDir: path.join(root, "compiled"), minify: false, lib: { entry: path.join(root, "fixture-entry.ts"), formats: ["es"], fileName: "fixture" } } });
    const modules = await import(pathToFileURL(path.join(root, "compiled/fixture.js")).href) as Modules;
    await microtasks(); raf(); await microtasks(); calls.length = 0; platform.length = 0;
    return { ...modules, window, doc, calls, platform, fire, raf, microtasks, dispose, reply(next: Reply) { reply = next; },
      state: () => modules.store.getState().library,
      input: () => doc.querySelector<HTMLInputElement>("#library-modal-body input")!,
      primary: () => doc.querySelector<HTMLButtonElement>("#library-modal-body .secondary-button")!,
      async click(target: HTMLElement) { target.click(); await microtasks(); },
      async seed(items = [playlist("a"), playlist("b", "歌单b", [])], favorites = [track(1)]) {
        reply = async command => command === "list_favorites" ? favorites : command === "list_playlists" ? items : command === "list_disabled_pages" ? {} : command === "list_unavailable_tracks" ? unavailable : startup(command, {});
        await modules.library.loadLibrary(); calls.length = 0;
      },
    };
  } catch (error) { dispose(); throw error; }
}

export { fixture, deferred, track, playlist, importPage, unavailable };
