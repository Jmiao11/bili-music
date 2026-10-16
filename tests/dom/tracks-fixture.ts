import { instrumentComponentRender } from "./render-counter.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { vueFeatureFlags } from "../../scripts/vue/features.ts";

// Track output: search.rs:32-44, ranking.rs:18-29; timestamp: library.rs:329.
const track = (i: number) => ({ bvid: "BV" + String(i).padStart(10, "0"), title: "曲目" + i, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: "1760000000000", playCount: 1, pubdate: 1 });
function deferred() {
  let resolve: (value: unknown) => void = () => {}, reject: (reason: unknown) => void = () => {};
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Reply = (command: string, args: Record<string, unknown>) => Promise<unknown>;
type Store = ReturnType<typeof import("../../ui/app-state.ts").createApplicationStore>;
type Snapshot = ReturnType<Store["getState"]>;
type Selection = { startPage?: CommandContract.VideoPage; pages?: CommandContract.VideoPage[] };
type Modules = {
  home: { getApplicationStore(): Store; getHomeSnapshot(): Snapshot["home"]; setHomeMode(mode: string): void; refreshAiKeyState(): Promise<void>; loadHomeRanking(options?: { forceRefresh?: boolean }): Promise<void>; loadRecommendationHome(): Promise<void>; loadRecommendations(options?: { forceRefresh?: boolean }): Promise<void> };
  search: { getSearchSnapshot(): Snapshot["search"]; readLastSearchKeyword(): string; runSearch(options?: { userKeyword?: string; recordHistory?: boolean }): Promise<void>; loadMoreSearchResults(): Promise<void>; fillSearchMetadata(index: number, version: number, metadata: Pick<CommandContract.AudioResponse, "title" | "uploader" | "thumbnailUrl" | "durationSeconds">): void; renderSearchResults(): void };
  core: { updateQueueUi(): void; playListItem(source: string, videos: readonly CommandContract.TrackSnapshotInput[], index: number): void; getQueueSnapshot(): Snapshot["playbackQueue"]; getSessionSnapshot(): Snapshot["playbackSession"]; restorePlaybackState(): Promise<void> }; notice: { showPlaybackNotice(message: string, options?: { persistent?: boolean; kind?: "error" | "info" }): void; clearPlaybackNotice(): void };
  pages: { bindTrackActivation(item: HTMLElement, button: HTMLButtonElement, video: CommandContract.TrackSnapshotInput, play: (selection?: Selection) => void): void };
  nodes: import("./application-nodes.ts").ApplicationNodes & { status: HTMLParagraphElement }; store: Store; appearance: { setNormalizationGain(gain: unknown): void };
};

async function fixture(options: { homeSpy?: boolean; saved?: string; draft?: string; legacySortTabs?: boolean; playback?: boolean; lyrics?: boolean; settingsPrivacy?: boolean; displayCounters?: boolean; shortcutReply?: Promise<unknown>; normalizationFailure?: boolean } = {}) {
  const project = path.resolve(import.meta.dirname, "../.."), source = path.join(project, "ui");
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "ui"], { cwd: project, encoding: "utf8" }).split("\0").filter(Boolean);
  const renderCounts: Record<string, number> = { TrackList: 0, TrackRow: 0, PlaylistList: 0 };
  if(options.displayCounters) for(const name of ["PlaybackBar","PlaybackNotice","ImmersivePlayer","LyricsDisplay","SettingsPanel"]) renderCounts[name]=0;
  const ipcListeners = new Map<string,(event:{payload?:unknown})=>void>(), emissions: {label:string;name:string;payload:unknown}[]=[];
  const rowRenders: { list: string | null; bvid: string }[] = [];
  const regions: { operation: string; host: Element }[] = [], warnings: unknown[][] = [];
  const savedWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-tracks-dom-"));
  for (const file of tracked) {
    const target = path.join(root, file.slice(3)); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(project, file), target);
  }
  if(options.legacySortTabs) {
    const file=path.join(root,"components/SearchTabs.vue");
    const source=fs.readFileSync(file,"utf8");
    const start=source.indexOf('<div id="search-sort-modes"'),end=source.indexOf('</div>',start);
    if(start<0||end<0) throw Error("Missing real sort component fixture");
    const opening=source.indexOf('>',start)+1;
    const buttons=["all","title","description"].map(mode=>'<button class="music-tab" type="button" role="tab" data-sort-mode="'+mode+'" :aria-selected="sort === \''+mode+'\'" :class="{ \'is-active\':sort === \''+mode+'\' }" @click="callbacks.sort(\''+mode+'\')">'+mode+'</button>').join('');
    fs.writeFileSync(file,source.slice(0,opening)+buttons+source.slice(end));
  }
  for (const name of [".local-data", "cookies.txt", "tools"]) if (fs.existsSync(path.join(root, name))) throw Error("Runtime data in library fixture: " + name);
  const dom = new JSDOM(fs.readFileSync(path.join(source, "index.html"), "utf8"), { url: "http://127.0.0.1/" });
  const window = dom.window as typeof dom.window & { CompositionEvent: typeof CompositionEvent; InputEvent: typeof InputEvent; CustomEvent: typeof CustomEvent; MutationObserver: typeof MutationObserver };
  if (options.playback) Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  if (options.saved) window.localStorage.setItem("bilibili-music.last-search", options.saved);
  const prepareRootInputs = () => {
  (window.document.querySelector("#search-keyword") as HTMLInputElement).value = options.draft ?? "";

  };
  const doc = window.document, frames = new Map<number, FrameRequestCallback>(), timers = new Map<number, { callback: () => void; delay: number; at: number }>();
  const platform: { operation: string; target?: EventTarget; detail?: unknown }[] = [], calls: { command: string; args: Record<string, unknown> }[] = [];
  const listeners: { target: EventTarget; type: string; callback: EventListenerOrEventListenerObject | null; options?: boolean | AddEventListenerOptions }[] = [];
  const descriptors = new Map<string, PropertyDescriptor | undefined>([["__VUE__", Object.getOwnPropertyDescriptor(globalThis, "__VUE__")]]);
  const mutations: MutationObserver[] = [];
  class NativeMutationObserver extends window.MutationObserver { constructor(callback: MutationCallback) { super(callback); mutations.push(this); } }
  let serial = 0, now = 0;
  const played: unknown[][] = [];
  let queueUpdates = 0;
  const install = (name: string, value: unknown) => { descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  // Only startup IPC responses; business commands require an explicit test reply.
  // library.rs:42; playlists.rs:12; disabled_pages.rs:106; ai.rs:75; shortcut_config.rs:31;
  // audio_cache.rs:60,67; commands/runtime.rs:7,13. No API keys or runtime files are read.
  const startup: Reply = async command => {
    if (["list_favorites", "list_playlists", "list_unavailable_tracks"].includes(command)) return [];
    if (["list_disabled_pages", "get_cached_video_pages"].includes(command)) return {};
    if (command === "get_ai_config") return new Promise(() => {});
    if (command === "get_shortcuts") return options.shortcutReply ?? { version: 1, bindings: { previous: null, playPause: null, next: null, volumeUp: null, volumeDown: null } };
    if (command === "get_audio_cache_settings") return { enabled: false, maxBytes: 1073741824 };
    if (command === "get_audio_cache_usage") return { bytes: 0, items: 0 };
    if (command === "get_yt_dlp_availability") return { available: true };
    if (command === "get_stream_source") return "auto";
    if (command === "set_taskbar_playback_state") return null;
    throw Error("Unconfigured fixture IPC: " + command);
  };
  let reply = startup;
  const harness = { played, updated() { queueUpdates++; } };
  const nativeListen = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function(type, callback, options) { listeners.push({ target: this, type, callback, options }); nativeListen.call(this, type, callback, options); };
  const nativeFocus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function(options?: FocusOptions) { platform.push({ operation: "focus", target: this, detail: options }); nativeFocus.call(this, options); };
  window.HTMLElement.prototype.scrollIntoView = function(options?: boolean | ScrollIntoViewOptions) { platform.push({ operation: "scrollIntoView", target: this, detail: options }); };
  for (const method of ["play", "pause", "load"] as const) Object.defineProperty(window.HTMLMediaElement.prototype, method, { configurable: true, value() { platform.push({ operation: method, target: this }); return method === "play" ? Promise.resolve() : undefined; } });
  window.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); platform.push({ operation: "requestAnimationFrame", detail: id }); return id; };
  window.cancelAnimationFrame = id => { frames.delete(id); platform.push({ operation: "cancelAnimationFrame", detail: id }); };
  window.setTimeout = ((callback: () => void, delay = 0) => { const id = ++serial; timers.set(id, { callback, delay, at: now + delay }); platform.push({ operation: "setTimeout", detail: { id, delay } }); return id; }) as typeof window.setTimeout;
  window.clearTimeout = id => { if (id !== undefined) timers.delete(id); };
  const observed = new Set<Element>();
  let intersection: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => {};
  class Observer {
    constructor(callback: typeof intersection) { intersection = callback; platform.push({ operation: "observer" }); }
    observe(target: Element) { observed.add(target); platform.push({ operation: "observe", target }); }
    unobserve(target: Element) { observed.delete(target); platform.push({ operation: "unobserve", target }); }
    disconnect() { observed.clear(); platform.push({ operation: "disconnect" }); }
  }
  Object.defineProperty(window, "IntersectionObserver", { value: Observer, configurable: true });
  Object.defineProperty(window, "__TAURI__", { value: { core: { invoke(command: string, args: Record<string, unknown> = {}) { calls.push({ command, args }); return reply(command, args); } }, event: { async listen(name: string, callback: (event:{payload?:unknown})=>void) { if(options.settingsPrivacy) ipcListeners.set(name,callback); platform.push({ operation: "tauri.listen", detail: name }); return () => platform.push({ operation: "tauri.unlisten", detail: name }); }, ...(options.settingsPrivacy ? {async emitTo(label:string,name:string,payload:unknown){emissions.push({label,name,payload});}} : {}) } } });
  for (const [name, value] of Object.entries({ __rootRowRenders: rowRenders, __rootRenderCounts: renderCounts, __rootFixtureBeforeMain: prepareRootInputs, __tracksHarness: harness, __tracksVueRecords: regions, window, document: doc, localStorage: window.localStorage, sessionStorage: window.sessionStorage, navigator: window.navigator, HTMLElement: window.HTMLElement, Element: window.Element, SVGElement: window.SVGElement, Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent, IntersectionObserver: Observer, ResizeObserver: Observer, MutationObserver: NativeMutationObserver, getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame, performance: { now: () => now } })) install(name, value);
  const microtasks = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const fire = async (target: EventTarget, type: string, fields: MouseEventInit & KeyboardEventInit & InputEventInit & CompositionEventInit = {}) => {
    const options = { bubbles: true, cancelable: true, ...fields };
    const event = type.startsWith("composition") ? new window.CompositionEvent(type, options) : type === "input" ? new window.InputEvent(type, options) : type.startsWith("key") ? new window.KeyboardEvent(type, options) : ["click", "dblclick"].includes(type) ? new window.MouseEvent(type, options) : new window.Event(type, options);
    target.dispatchEvent(event); await microtasks(); return event;
  };
  const raf = (time = 0) => { const pending = [...frames]; frames.clear(); for (const [, callback] of pending) callback(time); };
  const dispose = () => {
    console.warn = savedWarn;
    for (const listener of listeners) listener.target.removeEventListener(listener.type, listener.callback, listener.options);
    for (const observer of mutations) observer.disconnect();
    listeners.length = 0; frames.clear(); timers.clear(); observed.clear(); window.close();
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("bili-tracks-dom-")) throw Error("Unsafe library fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.copyFileSync(path.join(project,"tests/dom/application-nodes.ts"),path.join(root,"application-nodes.fixture.ts"));
    fs.writeFileSync(path.join(root, "fixture-entry.ts"), 'import "./root-mount.ts";' + (options.homeSpy ? 'import { initializeRootLists } from "./track-list-ui.ts"; initializeRootLists();' : 'import "./main.ts";') + 'export * as home from "./home.ts"; export * as search from "./search.ts"; export * as core from "./playback-core.ts"; export * as pages from "./video-pages.ts"; import { readApplicationNodes } from "./application-nodes.fixture.ts"; export const nodes = { ...readApplicationNodes(document), status: document.querySelector("#status") }; import { getApplicationStore } from "./home.ts"; export const store = getApplicationStore();' + 'export * as appearance from "./appearance.ts"; export * as notice from "./playback-notice.ts";' + (options.playback ? 'import { startAppearance } from "./appearance.ts"; startAppearance();' : '') + (options.lyrics ? 'import { initializeLyrics } from "./lyrics.ts"; initializeLyrics();' : '') + (options.settingsPrivacy ? 'import {startMiniPlayerHost} from "./mini-player-host.ts"; startMiniPlayerHost(); import {initializeMainWindowReady} from "./main-window-ready.ts"; initializeMainWindowReady();' : ''));
    await build({ configFile: false, root, logLevel: "silent", plugins: [vue(), { name: "region-call-recorder", transform(code, id) {
      const file = id.replaceAll("\\", "/");
      if(options.normalizationFailure && file.endsWith("/appearance.ts")) return code.replace(/function applyLoudnessNormalization[^{]+\{/, match => match + ' if(enabled === true) throw Error("normalization test failure");');
      const component = /\/components\/(TrackList|TrackRow|PlaylistList|PlaybackBar|PlaybackNotice|ImmersivePlayer|LyricsDisplay|SettingsPanel)\.vue/.exec(file)?.[1];
      if (component && (options.displayCounters || ["TrackList","TrackRow","PlaylistList"].includes(component))) return instrumentComponentRender(code, component);
      if (file.includes("/components/ListHost.vue") && /h\((?:TrackList|PlaylistList),/.test(code)) {
        const hooks = "function rootListHooks(id) { const host = () => document.getElementById(String(id)); return { onVnodeMounted: () => globalThis.__tracksVueRecords.push({operation: 'create', host: host()}), onVnodeUpdated: () => globalThis.__tracksVueRecords.push({operation: 'update', host: host()}), onVnodeBeforeUnmount: () => globalThis.__tracksVueRecords.push({operation: 'unmount', host: host()}) }; }\n";
        return hooks + code.replace(/h\(TrackList,\s*\{/g, "h(TrackList, { ...rootListHooks(attrs.id),").replace(/h\(PlaylistList,\s*\{/g, "h(PlaylistList, { ...rootListHooks(attrs.id),");
      }
      if (file.endsWith("/root-mount.ts")) return code.replace("mountApplication();", "mountApplication(); globalThis.__rootFixtureBeforeMain();");
      if (options.homeSpy && file.endsWith("/playback-core.ts")) {
        return code.replace(/function playListItem\([^]*?\) \{/, match => match + " globalThis.__tracksHarness.played.push([...arguments]); return;")
          .replace("function updateQueueUi() {", "function updateQueueUi() { globalThis.__tracksHarness.updated();");
      }
      if (options.homeSpy && file.endsWith("/video-pages.ts")) {
        // Preserve the old home fixture's playback spy and absent observer collaborator.
        return code.replace(/function queueCachedVideoPagesLookup[^]*?\)(?:: void)? \{/, match => match + " return;")
          .replace(/function (?:bindTrackActivation|createTrackActivationSession)[^]*?\) \{/, match => match + " item.activate = (_index, selection) => onPlay(selection);");
      }
    } }], define: vueFeatureFlags, resolve: { alias: { vue: path.join(project, "node_modules/vue/dist/vue.runtime.esm-bundler.js") } }, build: { outDir: path.join(root, "compiled"), minify: false, lib: { entry: path.join(root, "fixture-entry.ts"), formats: ["es"], fileName: "fixture" } } });
    const modules = await import(pathToFileURL(path.join(root, "compiled/fixture.js")).href) as Modules;
    await microtasks(); calls.length = 0; platform.length = 0;
    return { ...modules, renderCounts, rowRenders, ipcListeners, emissions, window, doc, calls, listeners, platform, regions, warnings, fire, raf, microtasks, dispose, timers, observed, played, queueUpdates: () => queueUpdates, reply(next: Reply) { reply = next; },
      visible(target: Element) { intersection([{ target, isIntersecting: true }]); },
      async advance(milliseconds: number) {
        const end = now + milliseconds;
        for (;;) {
          const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
          if (!due) break;
          now = due[1].at; timers.delete(due[0]); due[1].callback(); await microtasks();
        }
        now = end; await microtasks();
      },
    };
  } catch (error) { dispose(); throw error; }
}

// ranking.rs:15-27; search.rs:32-44; commands/media.rs:13-20; favorites.rs:10-14.
const videoMeta = { videos: 2, pages: [{ page: 1, cid: 11, part: "一", duration: 60 }, { page: 2, cid: 22, part: "二", duration: 90 }] };
type Harness = Awaited<ReturnType<typeof fixture>>;
type Source = "ranking" | "recommendation" | "search";
function responses(items = [track(1)]) {
  return async (command: string) => {
    if (["get_music_ranking", "get_saved_recommendations", "get_recommendations", "search_videos"].includes(command)) return items;
    if (["list_disabled_pages", "get_cached_video_pages"].includes(command)) return {};
    if (command === "get_video_meta") return videoMeta;
    if (command === "get_video_pages") return videoMeta.pages.map(page => ({ ...page, durationSeconds: page.duration }));
    if (command === "prepare_audio") return { audioUrl: "http://127.0.0.1/audio/fixture", title: items[0]?.title, uploader: "作者", thumbnailUrl: "", durationSeconds: 60 };
    if (command === "toggle_favorite") return { favorited: true, items };
    return null;
  };
}
async function seed(h: Harness, source: Source, items = [track(1)]) {
  h.reply(responses(items));
  if (source === "ranking") { h.home.setHomeMode("ranking"); await h.microtasks(); }
  else if (source === "recommendation") { h.home.setHomeMode("recommendation"); await h.microtasks(); await h.home.loadRecommendationHome(); }
  else { h.nodes.searchKeyword.value = "测试"; await h.search.runSearch(); }
  return source === "search" ? h.nodes.searchResults : h.nodes.homeRankingList!;
}

export { fixture, deferred, track, responses, seed, videoMeta };
