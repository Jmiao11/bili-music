const MINI_PLAYER_LABEL = "mini";
const MINI_PLAYER_READY_TIMEOUT_MS = 5000;
function readMiniPlayerMessages(document: Document) {
  return { status: document.querySelector("#status")?.textContent || "",
    notice: document.querySelector("#playback-notice")?.textContent || "" };
}
function createMiniPlayerHost({
  eventApi,
  invoke: invokeMini,
  document,
  window,
  setTimeoutFn = window.setTimeout.bind(window),
  clearTimeoutFn = window.clearTimeout.bind(window),
  console,
  getSnapshot = () => window.bilibiliMusicMiniHost.getSnapshot(),
  subscribeTheme = listener => window.bilibiliMusicMiniHost?.subscribeTheme(listener) ?? (() => {}),
  requestFrame = callback => window.requestAnimationFrame(callback),
  cancelFrame = id => window.cancelAnimationFrame(id),
  commands = () => window.bilibiliMusicMiniHost,
  favorite = () => window.bilibiliMusicMiniHost.toggleFavorite(),
}: { eventApi: TauriEventApi; invoke: CommandInvoke; document: Document; window: Window; console: Console; setTimeoutFn?: Window["setTimeout"]; clearTimeoutFn?: Window["clearTimeout"]; subscribeTheme?: Window["bilibiliMusicMiniHost"]["subscribeTheme"]; requestFrame?: (callback: FrameRequestCallback) => number; cancelFrame?: (id: number) => void; getSnapshot?: () => ReturnType<Window["bilibiliMusicMiniHost"]["getSnapshot"]>; commands?: () => Pick<Window["bilibiliMusicMiniHost"], "previous" | "togglePlayPause" | "next">; favorite?: Window["bilibiliMusicMiniHost"]["toggleFavorite"] }) {
  const openButton = document.querySelector("#mini-player-button");
  const status = document.querySelector("#status");
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
    if (status) {
      status.textContent = message;
    }
  }

  function publish() {
    if (disposed || !miniReady) {
      return;
    }
    Promise.resolve(
      eventApi.emitTo(MINI_PLAYER_LABEL, "mini-player-state", { ...getSnapshot(), ...readMiniPlayerMessages(document) }),
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

startMiniPlayerHost();
