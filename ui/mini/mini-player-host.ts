import { readDynamicPalette, readImageScheme, subscribeDynamicBackground } from "../features/settings/dynamic-background.ts";
import { getApplicationStore } from "../features/home/home.ts";
import { toggleFavorite } from "../features/library/library-ui.ts";
import { getPlaybackCommands } from "../features/settings/appearance.ts";
import { selectMiniPlayerMessages, selectMiniPlayerSnapshot } from "./mini-player-projection.ts";
import { setPlaybackStatus } from "../features/playback/playback-messages.ts";

function subscribeMiniPlayerTheme(listener: () => void) {
  const store = getApplicationStore();
  let settings = store.getState().settings;
  let previous = selectMiniPlayerSnapshot(store.getState(), readDynamicPalette(), readImageScheme());
  function check() {
    const next = selectMiniPlayerSnapshot(store.getState(), readDynamicPalette(), readImageScheme());
    if (next.theme === previous.theme && next.accent.r === previous.accent.r && next.accent.g === previous.accent.g && next.accent.b === previous.accent.b && next.backgroundPath === previous.backgroundPath && next.backgroundDim === previous.backgroundDim && next.backgroundVersion === previous.backgroundVersion && next.imageScheme === previous.imageScheme && next.dynamicColors === previous.dynamicColors) return;
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
  return { ...selectMiniPlayerSnapshot(state, readDynamicPalette(), readImageScheme()), ...selectMiniPlayerMessages(state) };
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
  favorite = toggleFavorite,
  readStore = getApplicationStore,
}: { eventApi: TauriEventApi; invoke: CommandInvoke; document: Document; window: Window; console: Console; setTimeoutFn?: Window["setTimeout"]; clearTimeoutFn?: Window["clearTimeout"]; subscribeTheme?: (listener: () => void) => () => void; requestFrame?: (callback: FrameRequestCallback) => number; cancelFrame?: (id: number) => void; getSnapshot?: () => ReturnType<typeof getMiniPlayerHostSnapshot>; commands?: () => Pick<ReturnType<typeof getPlaybackCommands>, "previous" | "togglePlayPause" | "next">; setStatus?: (message: string) => void; favorite?: typeof toggleFavorite; readStore?: typeof getApplicationStore }) {
  const openButton = document.querySelector("#mini-player-button");
  const audio = document.querySelector("#audio") as HTMLAudioElement | null;
  const unlisteners: (() => void)[] = [];
  let disposed = false;
  let miniReady = false;
  let readyTimer: number | null = null;
  let openVersion = 0;
  let themeFrame: number | null = null;
  let unlistenTheme: (() => void) | null = null;
  let watchingClose = false;
  let stopProgress = () => {};
  let progress: MiniPlayerProgress = { seq: 0 };
  let sourceReady = false, advancing = false;
  let lastProgressAt = 0;

  function stopThemeSync() {
    unlistenTheme?.(); unlistenTheme = null;
    if (themeFrame !== null) { cancelFrame(themeFrame); themeFrame = null; }
  }
  function stopMiniSync() {
    miniReady = false;
    stopThemeSync();
    stopProgress();
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
      void eventApi.listen("tauri://destroyed", stopMiniSync, { target: { kind: "Window", label: MINI_PLAYER_LABEL } })
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

  function hasMetadata() {
    return Boolean(audio?.currentSrc && audio.src === audio.currentSrc && audio.readyState > 0);
  }

  function canAdvance() {
    return Boolean(audio && audio.readyState >= 3 && !audio.paused && !audio.ended && !audio.seeking && !audio.error);
  }

  function sampleProgress(force = false) {
    const { playbackDisplay, playbackSession } = readStore().getState();
    const resume = playbackSession.pendingResume;
    const media = sourceReady && hasMetadata() ? audio : null;
    const duration = resume ? playbackDisplay.renderedTrack.actionTrack?.durationSeconds ?? 0 : media?.duration ?? 0;
    const position = resume ? resume.positionSeconds : media?.currentTime ?? 0;
    const rate = media?.playbackRate ?? 1;
    const playing = !resume && !!media && advancing && canAdvance();
    const seq = progress.seq + 1;
    let next: MiniPlayerProgress = { seq };
    if (Number.isFinite(duration) && duration > 0 && Number.isFinite(position)) {
      next = { seq, durationSeconds: duration, positionSeconds: Math.min(Math.max(0, position), duration),
        advancing: playing, playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1, sentAtMs: Date.now() };
    }
    if (!force && ("positionSeconds" in next
      ? "positionSeconds" in progress && next.positionSeconds === progress.positionSeconds &&
        next.durationSeconds === progress.durationSeconds && next.playbackRate === progress.playbackRate && next.advancing === progress.advancing
      : !("positionSeconds" in progress))) return false;
    progress = next;
    lastProgressAt = performance.now();
    return true;
  }

  function publishAudio(event: Event) {
    if (!miniReady) return;
    if (event.type !== "play") {
      advancing = false;
      if (event.type === "emptied") sourceReady = false;
      sampleProgress();
    }
    publish();
  }

  function startProgressSync() {
    if (!audio) return;
    const store = readStore();
    let before = store.getState();
    const observe = (event: Event) => {
      if (event.type === "loadstart") {
        sourceReady = advancing = false;
      } else if (event.type === "timeupdate") {
        if (!("advancing" in progress && progress.advancing) || performance.now() - lastProgressAt < 10_000) return;
      } else if (event.type === "waiting" || event.type === "seeking") {
        advancing = false;
      } else {
        sourceReady = hasMetadata();
        if (event.type === "playing" || event.type === "seeked") advancing = sourceReady && canAdvance();
      }
      if (sampleProgress(event.type === "loadstart")) publish();
    };
    const events = ["loadstart", "playing", "waiting", "seeking", "seeked", "durationchange", "loadedmetadata", "ratechange", "timeupdate"];
    for (const name of events) audio.addEventListener(name, observe);
    const unsubscribe = store.subscribe(state => {
      const resume = state.playbackSession.pendingResume;
      const changedResume = resume !== before.playbackSession.pendingResume ||
        (resume && before.playbackDisplay.renderedTrack !== state.playbackDisplay.renderedTrack);
      before = state;
      if (changedResume && sampleProgress()) publish();
    });
    stopProgress = () => {
      for (const name of events) audio.removeEventListener(name, observe);
      unsubscribe();
      stopProgress = () => {};
    };
  }

  function publish() {
    if (disposed || !miniReady) {
      return;
    }
    Promise.resolve(
      eventApi.emitTo(MINI_PLAYER_LABEL, "mini-player-state", { ...getSnapshot(), progress }),
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
      const track = readStore().getState().playbackDisplay.renderedTrack.actionTrack;
      if (track?.bvid && typeof payload.bvid === "string" &&
          payload.bvid.trim().toLowerCase() === track.bvid.toLowerCase()) {
        void favorite(track);
      }
    }
  }

  function handleReady() {
    if (disposed || miniReady) {
      return;
    }
    openVersion += 1;
    miniReady = true;
    clearReadyTimer();
    sourceReady = hasMetadata();
    advancing = sourceReady && canAdvance();
    sampleProgress(true);
    publish();
    startThemeSync();
    startProgressSync();
  }

  async function openMiniPlayer() {
    const version = ++openVersion;
    stopMiniSync();
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
      stopMiniSync();
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
      audio?.addEventListener(eventName, publishAudio);
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
