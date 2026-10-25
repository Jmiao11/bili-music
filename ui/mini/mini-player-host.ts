import { readDynamicPalette, subscribeDynamicBackground } from "../features/settings/dynamic-background.ts";
import { getApplicationStore } from "../features/home/home.ts";
import { toggleCurrentFavorite } from "../features/library/library-ui.ts";
import { getPlaybackCommands } from "../features/settings/appearance.ts";
import { selectMiniPlayerMessages, selectMiniPlayerSnapshot } from "./mini-player-projection.ts";
import { setPlaybackStatus } from "../features/playback/playback-messages.ts";

function subscribeMiniPlayerTheme(listener: () => void) {
  const store = getApplicationStore();
  let settings = store.getState().settings;
  let previous = selectMiniPlayerSnapshot(store.getState(), readDynamicPalette());
  function check() {
    const next = selectMiniPlayerSnapshot(store.getState(), readDynamicPalette());
    if (next.theme === previous.theme && next.accent.r === previous.accent.r && next.accent.g === previous.accent.g && next.accent.b === previous.accent.b && next.backgroundPath === previous.backgroundPath && next.backgroundDim === previous.backgroundDim && next.backgroundVersion === previous.backgroundVersion && next.dynamicColors === previous.dynamicColors) return;
    previous = next;
    listener();
  }
  const unlistenStore = store.subscribe(state => {
    if (state.settings === settings) return;
    settings = state.settings;
    check();
  });
  const unlistenBackground = subscribeDynamicBackground(check);
  return () => { unlistenStore(); unlistenBackground(); };
}

function getMiniPlayerHostSnapshot() {
  const state = getApplicationStore().getState();
  return { ...selectMiniPlayerSnapshot(state, readDynamicPalette()), ...selectMiniPlayerMessages(state) };
}

const MINI_PLAYER_LABEL = "mini";
const MINI_PLAYER_READY_TIMEOUT_MS = 5000;
function createMiniPlayerHost({
  eventApi,
  invoke: invokeMini,
  document,
  window,
  setTimeoutFn = window.setTimeout.bind(window),
  clearTimeoutFn = window.clearTimeout.bind(window),
  console,
  getSnapshot = getMiniPlayerHostSnapshot,
  subscribeTheme = subscribeMiniPlayerTheme,
  requestFrame = callback => window.requestAnimationFrame(callback),
  cancelFrame = id => window.cancelAnimationFrame(id),
  commands = () => getPlaybackCommands(),
  setStatus = setPlaybackStatus,
  favorite = toggleCurrentFavorite,
}: { eventApi: TauriEventApi; invoke: CommandInvoke; document: Document; window: Window; console: Console; setTimeoutFn?: Window["setTimeout"]; clearTimeoutFn?: Window["clearTimeout"]; subscribeTheme?: (listener: () => void) => () => void; requestFrame?: (callback: FrameRequestCallback) => number; cancelFrame?: (id: number) => void; getSnapshot?: () => ReturnType<typeof getMiniPlayerHostSnapshot>; commands?: () => Pick<ReturnType<typeof getPlaybackCommands>, "previous" | "togglePlayPause" | "next">; setStatus?: (message: string) => void; favorite?: typeof toggleCurrentFavorite }) {
  const openButton = document.querySelector("#mini-player-button");
  const audio = document.querySelector("#audio");
  const unlisteners: (() => void)[] = [];
  let disposed = false;
  let miniReady = false;
  let readyTimer: number | null = null;
  let openVersion = 0;
  let themeFrame: number | null = null;
  let unlistenTheme: (() => void) | null = null;
  let watchingClose = false;

  function stopThemeSync() {
    unlistenTheme?.(); unlistenTheme = null;
    if (themeFrame !== null) { cancelFrame(themeFrame); themeFrame = null; }
  }
  function scheduleThemeSync() {
    if (disposed || !miniReady || themeFrame !== null) return;
    themeFrame = requestFrame(() => { themeFrame = null; publish(); });
  }
  function startThemeSync() {
    if (unlistenTheme === null) unlistenTheme = subscribeTheme(scheduleThemeSync);
    // Register only after ready so startup listener installation remains unchanged.
    if (!watchingClose) {
      watchingClose = true;
      void eventApi.listen("tauri://destroyed", stopThemeSync, { target: { kind: "Window", label: MINI_PLAYER_LABEL } })
        .then(unlisten => { if (disposed) unlisten(); else unlisteners.push(unlisten); })
        .catch(error => { watchingClose = false; console.warn("mini player close listener failed:", error); });
    }
  }

  function clearReadyTimer() {
    if (readyTimer !== null) {
      clearTimeoutFn(readyTimer);
      readyTimer = null;
    }
  }
  function reportError(message: string) {
    setStatus(message);
  }

  function publish() {
    if (disposed || !miniReady) {
      return;
    }
    Promise.resolve(
      eventApi.emitTo(MINI_PLAYER_LABEL, "mini-player-state", getSnapshot()),
    ).catch((error) => console.warn("mini player state publish failed:", error));
  }
  function handleCommand({ payload }: TauriEvent<TauriAppEventMap["mini-player-command"]>) {
    const action = payload?.action;
    if (action === "previous") {
      commands().previous();
    } else if (action === "toggle_play") {
      window.recordPlaybackDiag?.("external-control", "mini player toggle_play");
      void commands().togglePlayPause();
    } else if (action === "next") {
      commands().next();
    } else if (action === "toggle_favorite") {
      void favorite();
    }
  }

  function handleReady() {
    if (disposed) {
      return;
    }
    openVersion += 1;
    miniReady = true;
    clearReadyTimer();
    publish();
    startThemeSync();
  }

  async function openMiniPlayer() {
    const version = ++openVersion;
    miniReady = false;
    stopThemeSync();
    clearReadyTimer();
    try {
      await invokeMini("open_mini_player");
    } catch (error) {
      reportError(`迷你播放器打开失败：${error}`);
      console.warn("open_mini_player failed:", error);
      return;
    }
    if (disposed || version !== openVersion || miniReady) {
      return;
    }
    readyTimer = setTimeoutFn(async () => {
      if (disposed || version !== openVersion || miniReady) {
        return;
      }
      miniReady = false;
      reportError("迷你播放器打开失败，已恢复主窗口。");
      try {
        await invokeMini("exit_mini_player");
      } catch (error) {
        console.warn("mini player recovery failed:", error);
      }
    }, MINI_PLAYER_READY_TIMEOUT_MS);
  }
  function listen<K extends keyof TauriAppEventMap>(name: K, handler: (event: TauriEvent<TauriAppEventMap[K]>) => void) {
    return eventApi.listen(name, handler).then((unlisten) => {
      if (disposed) {
        Promise.resolve(unlisten()).catch(() => {});
      } else {
        unlisteners.push(unlisten);
      }
    }).catch((error) => console.warn(`mini player listener failed for ${name}:`, error));
  }

  async function start() {
    unlistenTheme = subscribeTheme(scheduleThemeSync);
    window.addEventListener("beforeunload", () => {
      disposed = true;
      stopThemeSync();
      clearReadyTimer();
      for (const unlisten of unlisteners.splice(0)) {
        Promise.resolve(unlisten()).catch(() => {});
      }
    }, { once: true });
    await Promise.all([
      listen("mini-player-ready", handleReady),
      listen("mini-player-command", handleCommand),
    ]);
    openButton?.addEventListener("click", () => void openMiniPlayer());
    for (const eventName of ["play", "pause", "ended", "emptied", "error"]) {
      audio?.addEventListener(eventName, publish);
    }
    window.addEventListener("bilibili-music-trackchange", publish);
    window.addEventListener("bilibili-music-favorite-change", publish);
    window.addEventListener("bilibili-music-notice-change", publish);
  }

  return { start, publish, openMiniPlayer };
}

function startMiniPlayerHost() {
  const tauri = window.__TAURI__;
  if (!tauri?.event || !tauri?.core?.invoke) {
    return;
  }
  const host = createMiniPlayerHost({
    eventApi: tauri.event,
    invoke: tauri.core.invoke,
    document,
    window,
    console,
  });
  void host.start();
}

export { startMiniPlayerHost };
