const MINI_POSITION_KEY = "bilibili-music.mini-player-position";
const MINI_AUDIO_REQUEST_EVENT = "mini-player-audio-sample-request";
const MINI_AUDIO_FRAME_EVENT = "mini-player-audio-frame";
const MINI_AUDIO_FRAME_INTERVAL_MS = 1000 / 15;
const MINI_AUDIO_FRAME_TIMEOUT_MS = 1000;
const MINI_REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MINI_AUDIO_SCALE_RANGE = 0.075;
const MINI_AUDIO_BRIGHTNESS_RANGE = 0.075;
const MINI_AUDIO_GLOW_RANGE_PX = 28;
const MINI_AUDIO_GLOW_ALPHA_RANGE = 0.38;
function readMiniPosition(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(MINI_POSITION_KEY));
    if (!parsed || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }
    return { x: Math.round(parsed.x), y: Math.round(parsed.y) };
  } catch {
    return null;
  }
}

function clampMiniPosition(position, monitors, windowSize) {
  if (!position || !Array.isArray(monitors) || monitors.length === 0) {
    return position;
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const monitor of monitors) {
    const x = Number(monitor?.position?.x);
    const y = Number(monitor?.position?.y);
    const width = Number(monitor?.size?.width);
    const height = Number(monitor?.size?.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      continue;
    }
    const maxX = x + width - Number(windowSize?.width || 0);
    const maxY = y + height - Number(windowSize?.height || 0);
    const clampedX = clamp(position.x, x, maxX);
    const clampedY = clamp(position.y, y, maxY);
    const distance = (clampedX - position.x) ** 2 + (clampedY - position.y) ** 2;
    if (distance < bestDistance) {
      best = { x: Math.round(clampedX), y: Math.round(clampedY) };
      bestDistance = distance;
    }
  }

  return best ?? position;
}

function createMiniPlayerController({
  eventApi,
  invoke,
  windowApi,
  availableMonitors,
  dpi,
  document,
  storage,
  window,
  console,
}) {
  const query = (selector) => document.querySelector(selector);
  const title = query("#mini-title");
  const titleViewport = query("#mini-title-viewport");
  const cover = query("#mini-cover");
  const previousButton = query("#mini-previous");
  const playPauseButton = query("#mini-play-pause");
  const nextButton = query("#mini-next");
  const favoriteButton = query("#mini-favorite");
  const restoreButton = query("#mini-restore");
  const dragRegion = query("#mini-drag-region");
  const notice = query("#mini-notice");
  const noticeMoreButton = query("#mini-notice-more");
  const noticeFull = query("#mini-notice-full");
  const root = document.documentElement;
  const unlisteners = [];
  let disposed = false;
  let lastPosition = null;
  let lastTitle = null;
  let titleScrollFrame = null;
  let audioSampleFrame = null;
  let audioFrameTimeout = null;
  let audioRequestInFlight = false;
  let audioRequestWarned = false;
  let lastAudioRequestAt = Number.NEGATIVE_INFINITY;
  let lastAudioFrameSequence = -1;
  let playbackActive = false;
  let isPlaying = false;
  const reducedMotion = window?.matchMedia?.(MINI_REDUCED_MOTION_QUERY) ?? null;

  function warn(message, error) {
    console?.warn?.(message, error);
  }

  function clampUnit(value) {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  }

  function applyAudioFrame(frame = {}) {
    frame ??= {};
    const sequence = Number(frame.sequence);
    if (!Number.isFinite(sequence) || sequence <= lastAudioFrameSequence) {
      return;
    }
    lastAudioFrameSequence = sequence;
    const pulse = frame.active ? clampUnit(Number(frame.pulse)) : 0;
    const glow = frame.active ? clampUnit(Number(frame.glow)) : 0;
    cover.style.setProperty("--audio-cover-scale", (1 + pulse * MINI_AUDIO_SCALE_RANGE).toFixed(4));
    cover.style.setProperty("--audio-cover-brightness", (1 + glow * MINI_AUDIO_BRIGHTNESS_RANGE).toFixed(4));
    cover.style.setProperty("--audio-cover-glow-size", `${(glow * MINI_AUDIO_GLOW_RANGE_PX).toFixed(2)}px`);
    cover.style.setProperty("--audio-cover-glow-alpha", (glow * MINI_AUDIO_GLOW_ALPHA_RANGE).toFixed(4));
    if (audioFrameTimeout != null) {
      window.clearTimeout?.(audioFrameTimeout);
    }
    audioFrameTimeout = window.setTimeout?.(() => {
      audioFrameTimeout = null;
      resetAudioFrame();
    }, MINI_AUDIO_FRAME_TIMEOUT_MS) ?? null;
  }

  function resetAudioFrame() {
    cover.style.setProperty("--audio-cover-scale", "1.0000");
    cover.style.setProperty("--audio-cover-brightness", "1.0000");
    cover.style.setProperty("--audio-cover-glow-size", "0.00px");
    cover.style.setProperty("--audio-cover-glow-alpha", "0.0000");
  }

  function stopAudioSampling() {
    if (audioSampleFrame != null) {
      window.cancelAnimationFrame?.(audioSampleFrame);
      audioSampleFrame = null;
    }
    if (audioFrameTimeout != null) {
      window.clearTimeout?.(audioFrameTimeout);
      audioFrameTimeout = null;
    }
  }

  function requestAudioSample(timestamp) {
    audioSampleFrame = null;
    if (disposed || !isPlaying || typeof window?.requestAnimationFrame !== "function") {
      return;
    }
    if (!audioRequestInFlight && timestamp - lastAudioRequestAt >= MINI_AUDIO_FRAME_INTERVAL_MS) {
      lastAudioRequestAt = timestamp;
      audioRequestInFlight = true;
      Promise.resolve(eventApi.emit(MINI_AUDIO_REQUEST_EVENT))
        .catch((error) => {
          if (!audioRequestWarned) {
            audioRequestWarned = true;
            warn("mini player audio sample request failed:", error);
          }
        })
        .finally(() => {
          audioRequestInFlight = false;
        });
    }
    audioSampleFrame = window.requestAnimationFrame(requestAudioSample);
  }

  function updateAudioSampling(playing) {
    playbackActive = Boolean(playing);
    isPlaying = playbackActive && !reducedMotion?.matches;
    if (!isPlaying) {
      stopAudioSampling();
      resetAudioFrame();
      return;
    }
    if (audioSampleFrame == null && typeof window?.requestAnimationFrame === "function") {
      audioSampleFrame = window.requestAnimationFrame(requestAudioSample);
    }
  }

  function handleMotionPreferenceChange() {
    updateAudioSampling(playbackActive);
  }

  function clearTitleScroll() {
    title.classList.remove("is-scrolling");
    titleViewport.classList.remove("has-scrolling-title");
    title.style.removeProperty?.("--mini-title-distance");
    title.style.removeProperty?.("--mini-title-duration");
  }

  function measureTitleOverflow() {
    clearTitleScroll();
    const availableWidth = Number(titleViewport?.clientWidth);
    const titleWidth = Number(title?.scrollWidth);
    if (!Number.isFinite(availableWidth) || !Number.isFinite(titleWidth) || availableWidth <= 0 || titleWidth <= 0) {
      return;
    }
    const distance = Math.max(0, Math.ceil(titleWidth) - Math.floor(availableWidth));
    if (distance <= 0) {
      return;
    }
    title.style.setProperty("--mini-title-distance", `-${distance}px`);
    const duration = Math.min(14, Math.max(5, distance / 18 + 4));
    title.style.setProperty("--mini-title-duration", `${duration}s`);
    void title.offsetWidth;
    title.classList.add("is-scrolling");
    titleViewport.classList.add("has-scrolling-title");
  }

  function updateTitleScroll() {
    clearTitleScroll();
    if (typeof window?.requestAnimationFrame === "function") {
      if (titleScrollFrame != null) {
        window.cancelAnimationFrame?.(titleScrollFrame);
      }
      titleScrollFrame = window.requestAnimationFrame(() => {
        titleScrollFrame = null;
        measureTitleOverflow();
      });
      return;
    }
    measureTitleOverflow();
  }

  function render(state = {}) {
    const noticeText = state.notice || "";
    if (!noticeText && (document.activeElement === noticeMoreButton ||
        document.activeElement === noticeFull)) {
      restoreButton.focus?.();
    }
    if (notice) {
      if (notice.textContent !== noticeText) notice.textContent = noticeText;
      notice.hidden = !noticeText;
    }
    if (noticeMoreButton) {
      noticeMoreButton.hidden = !noticeText;
      if (!noticeText) {
        noticeMoreButton.setAttribute("aria-expanded", "false");
      }
    }
    if (noticeFull) {
      if (!noticeText) {
        noticeFull.hidden = true;
        noticeFull.textContent = "";
      } else if (!noticeFull.hidden && noticeFull.textContent !== noticeText) {
        noticeFull.textContent = noticeText;
      }
    }
    const hasCurrent = Boolean(state.hasCurrent);
    const nextTitle = state.title || "尚未播放";
    if (nextTitle !== lastTitle) {
      lastTitle = nextTitle;
      title.textContent = nextTitle;
      title.setAttribute("title", nextTitle);
      updateTitleScroll();
    }
    if (state.thumbnailUrl) {
      cover.setAttribute("src", state.thumbnailUrl);
      cover.hidden = false;
    } else {
      cover.removeAttribute("src");
      cover.hidden = true;
    }
    previousButton.disabled = !state.canPrevious;
    nextButton.disabled = !state.canNext;
    playPauseButton.disabled = !hasCurrent;
    favoriteButton.disabled = !hasCurrent;
    playPauseButton.dataset.playing = String(Boolean(state.isPlaying));
    playPauseButton.setAttribute("aria-label", state.isPlaying ? "暂停" : "播放");
    updateAudioSampling(state.isPlaying);
    favoriteButton.classList.toggle("is-favorited", Boolean(state.isFavorited));
    favoriteButton.setAttribute("aria-label", state.isFavorited ? "取消收藏" : "收藏");
    root.dataset.theme = state.theme === "light" ? "light" : "dark";
    if (state.accent) {
      root.style.setProperty("--accent-r", String(Number(state.accent.r) || 0));
      root.style.setProperty("--accent-g", String(Number(state.accent.g) || 0));
      root.style.setProperty("--accent-b", String(Number(state.accent.b) || 0));
    }
  }

  function emitCommand(action) {
    Promise.resolve(eventApi.emit("mini-player-command", { action }))
      .catch((error) => warn(`mini player command failed: ${action}`, error));
  }

  function listen(name, handler) {
    return eventApi.listen(name, handler).then((unlisten) => {
      if (disposed) {
        Promise.resolve(unlisten()).catch(() => {});
      } else {
        unlisteners.push(unlisten);
      }
    }).catch((error) => warn(`mini player listener failed for ${name}:`, error));
  }

  function persistPosition(position) {
    const x = Number(position?.x);
    const y = Number(position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    lastPosition = { x: Math.round(x), y: Math.round(y) };
    try {
      storage.setItem(MINI_POSITION_KEY, JSON.stringify(lastPosition));
    } catch (error) {
      warn("mini player position save failed:", error);
    }
    return true;
  }

  async function saveCurrentPosition() {
    try {
      persistPosition(await windowApi.outerPosition());
    } catch (error) {
      warn("mini player position save failed:", error);
    }
  }

  function handleMoved(event) {
    if (persistPosition(event?.payload)) {
      return;
    }
    void saveCurrentPosition();
  }

  async function restorePosition() {
    const saved = readMiniPosition(storage);
    if (!saved) {
      return;
    }
    try {
      const [monitors, windowSize] = await Promise.all([
        availableMonitors(),
        windowApi.outerSize(),
      ]);
      const position = clampMiniPosition(saved, monitors, windowSize);
      lastPosition = position;
      await windowApi.setPosition(new dpi.PhysicalPosition(position.x, position.y));
    } catch (error) {
      warn("mini player position restore failed:", error);
    }
  }

  function bindControls() {
    previousButton.addEventListener("click", () => emitCommand("previous"));
    playPauseButton.addEventListener("click", () => emitCommand("toggle_play"));
    nextButton.addEventListener("click", () => emitCommand("next"));
    favoriteButton.addEventListener("click", () => emitCommand("toggle_favorite"));
    restoreButton.addEventListener("click", () => {
      Promise.resolve(invoke("exit_mini_player")).catch((error) => {
        warn("mini player restore failed:", error);
      });
    });
    noticeMoreButton?.addEventListener("click", () => {
      if (!noticeFull || noticeMoreButton.hidden) {
        return;
      }
      const open = noticeFull.hidden;
      noticeFull.hidden = !open;
      noticeFull.textContent = open ? notice?.textContent || "" : "";
      noticeMoreButton.setAttribute("aria-expanded", String(open));
    });
    noticeFull?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      noticeFull.hidden = true;
      noticeFull.textContent = "";
      noticeMoreButton?.setAttribute("aria-expanded", "false");
      noticeMoreButton?.focus?.();
    });
    dragRegion.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target?.closest?.("button, #mini-notice-full")) {
        return;
      }
      event.preventDefault?.();
      Promise.resolve(windowApi.startDragging()).catch((error) => {
        warn("mini player drag failed:", error);
      });
    });
  }

  async function start() {
    reducedMotion?.addEventListener?.("change", handleMotionPreferenceChange);
    window?.addEventListener?.("beforeunload", () => {
      disposed = true;
      if (titleScrollFrame != null) {
        window.cancelAnimationFrame?.(titleScrollFrame);
      }
      stopAudioSampling();
      reducedMotion?.removeEventListener?.("change", handleMotionPreferenceChange);
      if (lastPosition) {
        persistPosition(lastPosition);
      }
      for (const unlisten of unlisteners.splice(0)) {
        Promise.resolve(unlisten()).catch(() => {});
      }
    }, { once: true });
    await Promise.all([
      listen("mini-player-state", ({ payload }) => render(payload)),
      listen(MINI_AUDIO_FRAME_EVENT, ({ payload }) => applyAudioFrame(payload)),
    ]);
    bindControls();
    await restorePosition();
    try {
      const unlisten = await windowApi.onMoved(handleMoved);
      unlisteners.push(unlisten);
    } catch (error) {
      warn("mini player move listener failed:", error);
    }
    try {
      await eventApi.emit("mini-player-ready");
    } catch (error) {
      warn("mini player ready event failed:", error);
    }
    try {
      await invoke("mini_player_ready");
      updateTitleScroll();
    } catch (error) {
      warn("mini player show failed:", error);
      try {
        await invoke("exit_mini_player");
      } catch (restoreError) {
        warn("mini player recovery failed:", restoreError);
      }
    }
  }

  return { start, render };
}

function startMiniPlayerWindow() {
  const tauri = window.__TAURI__;
  if (!tauri?.event || !tauri?.core?.invoke || !tauri?.window) {
    return;
  }
  const controller = createMiniPlayerController({
    eventApi: tauri.event,
    invoke: tauri.core.invoke,
    windowApi: tauri.window.getCurrentWindow(),
    availableMonitors: tauri.window.availableMonitors,
    dpi: tauri.dpi,
    document,
    storage: window.localStorage,
    window,
    console,
  });
  void controller.start();
}

if (typeof window !== "undefined") {
  startMiniPlayerWindow();
}
