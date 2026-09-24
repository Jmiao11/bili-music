const MINI_PLAYER_LABEL = "mini";
const MINI_PLAYER_READY_TIMEOUT_MS = 5000;
const MINI_PLAYER_AUDIO_REQUEST_EVENT = "mini-player-audio-sample-request";
const MINI_PLAYER_AUDIO_FRAME_EVENT = "mini-player-audio-frame";
function miniPlayerAccent(root) {
  const read = (name, fallback) => {
    const value = Number(root?.style?.getPropertyValue?.(name));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    r: read("--accent-r", 251),
    g: read("--accent-g", 114),
    b: read("--accent-b", 153),
  };
}

function miniPlayerState(document) {
  const query = (selector) => document.querySelector(selector);
  const previousButton = query("#previous-button");
  const nextButton = query("#next-button");
  const playPauseButton = query("#play-pause-button");
  const favoriteButton = query("#favorite-current-button");
  const title = query("#title");
  const uploader = query("#uploader");
  const thumbnail = query("#thumbnail");
  const status = query("#status");
  const root = document.documentElement;
  const hasCurrent = favoriteButton
    ? !favoriteButton.disabled
    : previousButton
      ? !previousButton.disabled
      : false;

  return {
    title: title?.textContent || "尚未播放",
    uploader: uploader?.textContent || "—",
    thumbnailUrl: thumbnail?.getAttribute?.("src") || thumbnail?.src || "",
    status: status?.textContent || "",
    hasCurrent,
    canPrevious: previousButton ? !previousButton.disabled : false,
    canNext: nextButton ? !nextButton.disabled : false,
    isPlaying: playPauseButton?.dataset?.playing === "true",
    isFavorited: favoriteButton?.classList?.contains("is-favorited") ?? false,
    theme: root?.dataset?.theme || "dark",
    accent: miniPlayerAccent(root),
    notice: query("#playback-notice")?.textContent || "",
  };
}

function createMiniPlayerHost({
  eventApi,
  invoke,
  document,
  window,
  setTimeoutFn = window.setTimeout.bind(window),
  clearTimeoutFn = window.clearTimeout.bind(window),
  audioReactive = window.bilibiliMusicAudioReactive,
  console,
}) {
  const openButton = document.querySelector("#mini-player-button");
  const previousButton = document.querySelector("#previous-button");
  const playPauseButton = document.querySelector("#play-pause-button");
  const nextButton = document.querySelector("#next-button");
  const favoriteButton = document.querySelector("#favorite-current-button");
  const status = document.querySelector("#status");
  const audio = document.querySelector("#audio");
  const unlisteners = [];
  let disposed = false;
  let miniReady = false;
  let readyTimer = null;
  let openVersion = 0;
  let audioFrameInFlight = false;

  function clearReadyTimer() {
    if (readyTimer !== null) {
      clearTimeoutFn(readyTimer);
      readyTimer = null;
    }
  }

  function reportError(message) {
    if (status) {
      status.textContent = message;
    }
  }

  function publish() {
    if (disposed || !miniReady) {
      return;
    }
    Promise.resolve(
      eventApi.emitTo(MINI_PLAYER_LABEL, "mini-player-state", miniPlayerState(document)),
    ).catch((error) => console.warn("mini player state publish failed:", error));
  }

  function handleCommand({ payload }) {
    const action = payload?.action;
    if (action === "previous") {
      previousButton?.click();
    } else if (action === "toggle_play") {
      playPauseButton?.click();
    } else if (action === "next") {
      nextButton?.click();
    } else if (action === "toggle_favorite") {
      favoriteButton?.click();
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
  }

  function handleAudioFrameRequest() {
    if (disposed || !miniReady || audioFrameInFlight || !audioReactive?.sample) {
      return;
    }
    let frame;
    try {
      frame = audioReactive.sample();
    } catch (error) {
      console.warn("mini player audio sample failed:", error);
      return;
    }
    audioFrameInFlight = true;
    Promise.resolve(
      eventApi.emitTo(MINI_PLAYER_LABEL, MINI_PLAYER_AUDIO_FRAME_EVENT, frame),
    ).catch((error) => console.warn("mini player audio frame publish failed:", error))
      .finally(() => {
        audioFrameInFlight = false;
      });
  }

  async function openMiniPlayer() {
    const version = ++openVersion;
    miniReady = false;
    clearReadyTimer();
    try {
      await invoke("open_mini_player");
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
        await invoke("exit_mini_player");
      } catch (error) {
        console.warn("mini player recovery failed:", error);
      }
    }, MINI_PLAYER_READY_TIMEOUT_MS);
  }

  function listen(name, handler) {
    return eventApi.listen(name, handler).then((unlisten) => {
      if (disposed) {
        Promise.resolve(unlisten()).catch(() => {});
      } else {
        unlisteners.push(unlisten);
      }
    }).catch((error) => console.warn(`mini player listener failed for ${name}:`, error));
  }

  async function start() {
    window.addEventListener("beforeunload", () => {
      disposed = true;
      clearReadyTimer();
      for (const unlisten of unlisteners.splice(0)) {
        Promise.resolve(unlisten()).catch(() => {});
      }
    }, { once: true });
    await Promise.all([
      listen("mini-player-ready", handleReady),
      listen("mini-player-command", handleCommand),
      listen(MINI_PLAYER_AUDIO_REQUEST_EVENT, handleAudioFrameRequest),
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
