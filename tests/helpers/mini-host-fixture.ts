import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { readDynamicPalette, readImageScheme, subscribeDynamicBackground } from "../../ui/features/settings/dynamic-background.ts";
import { selectMiniPlayerSnapshot, selectMiniPlayerMessages } from "../../ui/mini/mini-player-projection.ts";
import { createApplicationStore } from "../../ui/store/app-state.ts";
import { stripModuleSyntax } from "./module-syntax.ts";
import { createPlaybackControlFixture } from "./playback-control-fixture.ts";

async function createMiniHostFixture() {
  const h = await createPlaybackControlFixture(), ui = path.join(import.meta.dirname, "../../ui");
  const listeners = new Map<string, (event: { payload: { action?: string } | null }) => void>();
  const emissions: { label: string; name: string; payload: MiniPlayerStatePayload }[] = [];
  const listenTargets: { name: string; target?: { kind: string; label: string } }[] = [];
  const invoked: string[] = [], changes: string[] = [], installed: string[] = [];
  const windowHandlers = new Map<string, (() => void)[]>();
  const add = h.context.window.addEventListener;
  h.context.window.addEventListener = (name: string, handler: () => void, options?: unknown) => {
    installed.push("window:" + name); add(name, handler, options);
    windowHandlers.set(name, [...windowHandlers.get(name) ?? [], handler]);
  };
  h.context.window.dispatchEvent = (event: { type: string }) => {
    changes.push(event.type); for (const handler of windowHandlers.get(event.type) ?? []) handler(); return true;
  };
  vm.runInContext('const CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };', h.context);
  let favorited = false;
  const library = createApplicationStore({
    // src-tauri/src/library/favorites.rs:10–13,69–80: { favorited, items }.
    invoke: async (command, ...args) => {
      invoked.push(command);
      if (command !== "toggle_favorite") throw Error("Unexpected fixture command");
      favorited = !favorited;
      const track = (args[0] as CommandMap["toggle_favorite"]["args"]).track;
      // src-tauri/src/library.rs:329–331: Unix milliseconds serialized as a string.
      return { favorited, items: favorited ? [{ kind: "video", entryId: `video:${track.bvid.toLowerCase()}`, video: { ...track, addedAt: "1700000000000" } }] : [] } as CommandMap[typeof command]["result"];
    }, setTimeout: () => 0, clearTimeout() {}, report() {},
  });
  h.context.getLibraryActions = () => library.actions.library;
  h.context.getLibrarySnapshot = () => library.getState().library;
  h.context.currentPlayableTrack = () => h.store.getState().playbackQueue.queue[h.store.getState().playbackQueue.currentIndex] ?? null;
  const favorite = stripModuleSyntax(fs.readFileSync(path.join(ui, "features/library/library-ui.ts"), "utf8"), "ui/features/library/library-ui.ts");
  vm.runInContext(favorite.slice(favorite.indexOf("async function toggleFavorite("), favorite.indexOf("function closeLibraryModal(")), h.context);
  const main = stripModuleSyntax(fs.readFileSync(path.join(ui, "app/main.ts"), "utf8"), "ui/app/main.ts");
  h.context.favoriteCurrentButton = h.node("#favorite-current-button");
  const favoriteLine = main.split(/\r?\n/).find(line => line.startsWith('installPlaybackCallbacks({ favorite:'));
  if (!favoriteLine) throw Error("Favorite handler is missing");
  vm.runInContext(favoriteLine, h.context);
  const root = h.context.document.documentElement, channels = new Map([['--accent-r', '251'], ['--accent-g', '114'], ['--accent-b', '153']]);
  Object.assign(root.style, { getPropertyValue: (name: string) => channels.get(name) ?? "" }); root.dataset.theme = "dark";
  Object.assign(h.node("#thumbnail"), { getAttribute: (name: string) => h.node("#thumbnail").attributes.get(name) ?? null });
  h.node("#thumbnail").src = "";
  const favoriteButton = h.node("#favorite-current-button");
  favoriteButton.classList = { contains: () => favorited };
  const timers: { handler: () => Promise<void>; delay: number }[] = [];
  // src-tauri/src/mini_player.rs:29,85: both window commands return unit (null).
  const invoke = async (command: string) => { invoked.push(command); return null; };
  const hostSource = stripModuleSyntax(fs.readFileSync(path.join(ui, "mini/mini-player-host.ts"), "utf8"), "ui/mini/mini-player-host.ts");
  const tauri = h.context.window.__TAURI__; h.context.window.__TAURI__ = undefined;
  const createHost = vm.runInContext(hostSource + "\ncreateMiniPlayerHost", h.context);
  h.context.window.__TAURI__ = tauri;
  Object.defineProperty(root.dataset, "theme", { configurable: true, get: () => h.store.getState().settings.theme || "dark",
    // Explicit fixture setting input -> real action; publishing remains event-driven.
    set: value => { h.store.actions.settings.setTheme(value, false); } });
  const setChannel = channels.set.bind(channels);
  channels.set = (name, value) => {
    setChannel(name, value);
    if (['--accent-r', '--accent-g', '--accent-b'].map(key => channels.get(key)).join(',') === '40,88,161') h.store.actions.settings.setAccent('blue', root.dataset.theme, false);
    return channels;
  };
  const frames = new Map<number, FrameRequestCallback>(); let frameId = 0, themeSubscribers = 0;
  const observedStore = { ...h.store, subscribe(listener: Parameters<typeof h.store.subscribe>[0]) {
    themeSubscribers++; const unlisten = h.store.subscribe(listener);
    return () => { themeSubscribers--; unlisten(); };
  } };
  h.context.getApplicationStore = () => observedStore;
  h.context.subscribeDynamicBackground = subscribeDynamicBackground;
  h.context.readDynamicPalette = readDynamicPalette;
  h.context.readImageScheme = readImageScheme;
  h.context.selectMiniPlayerSnapshot = (state: Parameters<typeof selectMiniPlayerSnapshot>[0], colors: readonly string[], scheme?: "light"|"dark") => selectMiniPlayerSnapshot(state, colors, scheme);
  h.context.selectMiniPlayerMessages = selectMiniPlayerMessages;
  const subscribeTheme = vm.runInContext("subscribeMiniPlayerTheme", h.context);
  const flushFrame = async () => {
    const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(0);
    await h.flush();
  };
  const flush = async () => { await h.flush(); await flushFrame(); };
  const host = createHost({ subscribeTheme,
    setStatus: (text: string) => h.store.actions.playbackMessages.setStatus(text),
    requestFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }, cancelFrame: (id: number) => { frames.delete(id); },
    getSnapshot: () => {
      return { ...selectMiniPlayerSnapshot({ ...h.store.getState(), library: library.getState().library }, readDynamicPalette(), readImageScheme()), ...selectMiniPlayerMessages(h.store.getState()) };
    }, commands: () => h.context.getPlaybackCommands(), favorite: () => h.context.toggleCurrentFavorite(), document: h.context.document, window: h.context.window, console,
    invoke, eventApi: { listen: async (name: string, handler: (event: { payload: { action?: string } | null }) => void, options?: { target: { kind: string; label: string } }) => { listenTargets.push({ name, target: options?.target }); installed.push("tauri:" + name); listeners.set(name, handler); return () => listeners.delete(name); },
      emitTo: async (label: string, name: string, payload: MiniPlayerStatePayload) => { emissions.push({ label, name, payload: structuredClone(payload) }); } },
    setTimeoutFn: (handler: () => Promise<void>, delay: number) => { timers.push({ handler, delay }); return timers.length; }, clearTimeoutFn() {},
  });
  await host.start();
  const setTrack = (pages = 1) => {
    const track = { bvid: "BV0000000001", title: "曲目", uploader: "作者", thumbnailUrl: "https://example.com/cover.jpg", durationSeconds: 60 };
    h.store.actions.playbackQueue.replaceQueue([track]); h.store.actions.playbackQueue.selectIndex(0, false, null);
    // src-tauri/src/guest_playurl.rs:45–51: VideoPage uses durationSeconds.
    h.store.actions.playbackSession.setCurrentPages(Array.from({ length: pages }, (_, index) => ({ cid: index + 1, page: index + 1, part: "分P" + (index + 1), durationSeconds: 60 })));
    const displayed = { ...track, title: pages > 1 ? "分P1" : track.title, hasCurrent: true };
    h.store.actions.playbackQueue.setDisplayTrack(displayed);
    h.store.actions.playbackDisplay.setRenderedTrack(displayed);
    h.node("#title").textContent = displayed.title;
    h.node("#uploader").textContent = track.uploader; h.node("#thumbnail").setAttribute("src", track.thumbnailUrl); favoriteButton.disabled = false;
    return track;
  };
  // Legacy initialization nodes -> real message actions; renderer remains the production writer.
  for (const [selector, kind] of [["#status", "status"], ["#playback-notice", "notice"]]) {
    const node = h.node(selector); let text = node.textContent;
    Object.defineProperty(node, "textContent", { configurable: true, get: () => text, set(value: string) {
      text = value; const messages = h.store.getState().playbackMessages;
      if (kind === "status" && value !== messages.status) h.store.actions.playbackMessages.setStatus(value);
      if (kind === "notice" && value !== messages.notice.text) h.store.actions.playbackMessages.showNotice(value, "info");
    } });
  }
  favoriteButton.disabled = true;
  const fire = async (name: string, action?: string) => { listeners.get(name)?.({ payload: name === "mini-player-ready" || name === "tauri://destroyed" ? null : { action } }); await h.flush(); };
  const publishEvent = async (name: string) => { for (const handler of windowHandlers.get(name) ?? []) handler(); await h.flush(); };
  return { ...h, flush, flushFrame, themeSubscriberCount: () => themeSubscribers, frameCount: () => frames.size, listenTargets, host, library, emissions, invoked, changes, installed, timers, root, channels, setTrack, fire, publishEvent };
}
export { createMiniHostFixture };
