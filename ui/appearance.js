const { invoke: invokeAppearance } = window.__TAURI__.core;

const BACKGROUND_PATH_KEY = "bilibili-music.background-path";
const THEME_KEY = "bilibili-music.theme";
const ACCENT_COLOR_KEY = "bilibili-music.accent-color";
const ACCENT_COLORS = {
  pink: { dark: [251, 114, 153], light: [164, 41, 76] },
  blue: { dark: [122, 166, 231], light: [40, 88, 161] },
  purple: { dark: [189, 145, 236], light: [120, 48, 194] },
  green: { dark: [87, 185, 65], light: [40, 102, 25] },
  orange: { dark: [224, 146, 77], light: [128, 77, 32] },
  cyan: { dark: [73, 178, 191], light: [27, 98, 106] },
};
let currentAccentColor = "pink";
const GLASS_BLUR_KEY = "bilibili-music.glass-blur";
const PANEL_ALPHA_KEY = "bilibili-music.panel-alpha";
const BACKGROUND_DIM_KEY = "bilibili-music.background-dim";
const VOLUME_KEY = "bilibili-music.volume";
// 全局快捷键步长独立于滑块，方便 live 调整每次按键的幅度。
const GLOBAL_SHORTCUT_VOLUME_STEP = 0.05;
const LOUDNESS_NORMALIZATION_KEY = "bilibili-music.loudness-normalization";
let userVolume = 1.0;
let normalizationGain = 1.0;
let loudnessNormalizationEnabled = false;
let normalizationAnimationFrame = null;

const root = document.documentElement;
const navItems = [...document.querySelectorAll(".nav-item[data-view]")];
const homeView = document.querySelector("#view-home");
const searchView = document.querySelector("#view-search");
const favoritesView = document.querySelector("#view-favorites");
const playlistsView = document.querySelector("#view-playlists");
const placeholderView = document.querySelector("#view-placeholder");
const placeholderTitle = document.querySelector("#placeholder-title");
const settingsModal = document.querySelector("#settings-modal");
const openSettingsButton = document.querySelector("#open-settings-button");
const closeSettingsButton = document.querySelector("#close-settings-button");
const themeOptions = [...document.querySelectorAll("[data-theme-option]")];
const accentColorOptions = [...document.querySelectorAll("[data-accent-color]")];
const mascotPicker = document.querySelector("#mascot-picker");
const chooseBackgroundButton = document.querySelector("#choose-background-button");
const resetBackgroundButton = document.querySelector("#reset-background-button");
const backgroundName = document.querySelector("#background-name");
const appearanceStatus = document.querySelector("#appearance-status");
const imageOnlyGroups = [...document.querySelectorAll(".image-only")];
const glassBlurSlider = document.querySelector("#glass-blur-slider");
const glassBlurValue = document.querySelector("#glass-blur-value");
const panelAlphaSlider = document.querySelector("#panel-alpha-slider");
const panelAlphaValue = document.querySelector("#panel-alpha-value");
const backgroundDimSlider = document.querySelector("#background-dim-slider");
const backgroundDimValue = document.querySelector("#background-dim-value");
const streamSourceSelect = document.querySelector("#stream-source-select");
const streamSourceStatus = document.querySelector("#stream-source-status");
const audioCacheEnabled = document.querySelector("#audio-cache-enabled");
const audioCacheCapacity = document.querySelector("#audio-cache-capacity");
const audioCacheUsage = document.querySelector("#audio-cache-usage");
const audioCacheStatus = document.querySelector("#audio-cache-status");
const clearAudioCacheButton = document.querySelector("#clear-audio-cache-button");
let audioCacheSettings = null;
let audioCacheStatusTimer = null;
const clearSearchHistoryButton = document.querySelector("#clear-search-history-button");
const exportDataButton = document.querySelector("#export-data-button");
const importDataButton = document.querySelector("#import-data-button");
const aiBaseUrlInput = document.querySelector("#ai-base-url-input");
const aiModelInput = document.querySelector("#ai-model-input");
const aiApiKeyInput = document.querySelector("#ai-api-key-input");
const saveAiConfigButton = document.querySelector("#save-ai-config-button");
const testAiConnectionButton = document.querySelector("#test-ai-connection-button");
const aiConfigStatus = document.querySelector("#ai-config-status");
const shortcutRecordButtons = [...document.querySelectorAll("[data-shortcut-action]")];
const shortcutClearButtons = [...document.querySelectorAll("[data-shortcut-clear]")];
let shortcutBindings = {
  previous: null,
  playPause: null,
  next: null,
  volumeUp: null,
  volumeDown: null,
};
let recordingShortcutAction = null;

const playerAudio = document.querySelector("#audio");
const playPauseButton = document.querySelector("#play-pause-button");
const progressSlider = document.querySelector("#progress-slider");
const currentTimeLabel = document.querySelector("#current-time");
const durationLabel = document.querySelector("#duration");
const playbackStatus = document.querySelector("#status");
const openImmersiveButton = document.querySelector("#open-immersive-button");
const immersivePlayer = document.querySelector("#immersive-player");
const closeImmersiveButton = document.querySelector("#close-immersive-button");
const immersiveCover = document.querySelector("#immersive-cover");
const immersiveReflection = document.querySelector("#immersive-reflection");
const immersiveTitle = document.querySelector("#immersive-title");
const immersiveUploader = document.querySelector("#immersive-uploader");
const immersivePreviousButton = document.querySelector("#immersive-previous-button");
const immersiveNextButton = document.querySelector("#immersive-next-button");
const immersivePlayPauseButton = document.querySelector("#immersive-play-pause-button");
const immersiveProgressSlider = document.querySelector("#immersive-progress-slider");
const immersiveCurrentTimeLabel = document.querySelector("#immersive-current-time");
const immersiveDurationLabel = document.querySelector("#immersive-duration");
const openBilibiliButton = document.querySelector("#open-bilibili-button");
const openBilibiliBarButton = document.querySelector("#open-bilibili-bar-button");
const addPlaylistCurrentButton = document.querySelector("#add-playlist-current-button");
const previousButtonForImmersive = document.querySelector("#previous-button");
const nextButtonForImmersive = document.querySelector("#next-button");
const volumeSlider = document.querySelector("#volume-slider");
const loudnessNormalizationToggle = document.querySelector("#loudness-normalization-toggle");

let isSeeking = false;
let ytDlpAvailable = false;
let currentTrack = {
  bvid: "",
  title: "尚未播放",
  uploader: "—",
  thumbnailUrl: "",
  durationSeconds: 0,
  hasCurrent: false,
};

const viewLabels = {
  favorites: "我的收藏",
  playlists: "我的歌单",
  local: "本地音乐",
};

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

function isShortcutModifierCode(code) {
  return /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code);
}

function shortcutFromKeyboardEvent(event) {
  const code = event.code || "";
  if (isShortcutModifierCode(code) || code === "Escape") {
    return null;
  }

  const namedKeys = new Set([
    "Backquote", "Backslash", "BracketLeft", "BracketRight", "Pause", "Comma", "Equal",
    "Minus", "Period", "Quote", "Semicolon", "Slash", "Backspace", "CapsLock", "Enter",
    "Space", "Tab", "Delete", "End", "Home", "Insert", "PageDown", "PageUp", "PrintScreen",
    "ScrollLock", "NumLock", "AudioVolumeDown", "AudioVolumeUp", "AudioVolumeMute", "MediaPlay",
    "MediaPause", "MediaPlayPause", "MediaStop", "MediaTrackNext", "MediaTrackPrevious",
  ]);
  let key = null;
  if (/^Key[A-Z]$/.test(code)) {
    key = code.slice(3);
  } else if (/^Digit[0-9]$/.test(code)) {
    key = code.slice(5);
  } else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) {
    key = code;
  } else if (/^Numpad(?:[0-9]|Add|Decimal|Divide|Enter|Equal|Multiply|Subtract)$/.test(code)) {
    key = code;
  } else if (code.startsWith("Arrow")) {
    key = code.slice(5);
  } else if (namedKeys.has(code)) {
    key = code;
  }

  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");
  if (!key || modifiers.length === 0) {
    return null;
  }
  return [...modifiers, key].join("+");
}

function shortcutDisplayLabel(binding) {
  if (!binding) {
    return "未设置";
  }
  if (document.documentElement.dataset.platform !== "macos") {
    return binding;
  }
  return binding
    .split("+")
    .map((token) => {
      const normalized = token.trim().toUpperCase();
      if (
        [
          "SUPER",
          "COMMAND",
          "CMD",
          "COMMANDORCONTROL",
          "COMMANDORCTRL",
          "CMDORCONTROL",
          "CMDORCTRL",
        ].includes(normalized)
      ) {
        return "Command";
      }
      return token;
    })
    .join("+");
}

function shortcutButtonFor(action) {
  return shortcutRecordButtons.find((button) => button.dataset.shortcutAction === action);
}

function renderShortcutButton(action) {
  const button = shortcutButtonFor(action);
  if (button) {
    button.textContent = shortcutDisplayLabel(shortcutBindings[action]);
    button.classList.remove("is-recording");
  }
}

function handleShortcutRecordingPointerDown(event) {
  if (!event.target.closest?.("[data-shortcut-action]")) {
    cancelShortcutRecording();
  }
}

function handleShortcutRecordingKeydown(event) {
  if (!recordingShortcutAction) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.code === "Escape") {
    cancelShortcutRecording();
    return;
  }
  if (isShortcutModifierCode(event.code)) {
    return;
  }
  const shortcut = shortcutFromKeyboardEvent(event);
  if (!shortcut) {
    appearanceStatus.textContent = "请使用组合键";
    return;
  }
  const action = recordingShortcutAction;
  cancelShortcutRecording();
  void saveShortcutBinding(action, shortcut);
}

function cancelShortcutRecording() {
  if (!recordingShortcutAction) return;
  const action = recordingShortcutAction;
  recordingShortcutAction = null;
  renderShortcutButton(action);
  window.removeEventListener("keydown", handleShortcutRecordingKeydown, true);
  window.removeEventListener("pointerdown", handleShortcutRecordingPointerDown, true);
  window.removeEventListener("blur", cancelShortcutRecording);
}

function startShortcutRecording(action) {
  cancelShortcutRecording();
  recordingShortcutAction = action;
  const button = shortcutButtonFor(action);
  button.textContent = "按下组合键…";
  button.classList.add("is-recording");
  appearanceStatus.textContent = "";
  window.addEventListener("keydown", handleShortcutRecordingKeydown, true);
  window.addEventListener("pointerdown", handleShortcutRecordingPointerDown, true);
  window.addEventListener("blur", cancelShortcutRecording);
}

async function saveShortcutBinding(action, value) {
  const nextBindings = { ...shortcutBindings, [action]: value };
  try {
    await invokeAppearance("set_shortcuts", { bindings: nextBindings });
    shortcutBindings = nextBindings;
    renderShortcutButton(action);
    appearanceStatus.textContent = "快捷键已保存。";
  } catch (error) {
    appearanceStatus.textContent = String(error);
  }
}

async function initializeShortcutSettings() {
  try {
    const shortcuts = await invokeAppearance("get_shortcuts");
    shortcutBindings = { ...shortcutBindings, ...shortcuts.bindings };
  } catch (error) {
    console.warn("[shortcut] cannot load settings:", error);
  }
  for (const button of shortcutRecordButtons) {
    renderShortcutButton(button.dataset.shortcutAction);
    button.addEventListener("click", () => startShortcutRecording(button.dataset.shortcutAction));
  }
  for (const button of shortcutClearButtons) {
    button.addEventListener("click", () => {
      cancelShortcutRecording();
      void saveShortcutBinding(button.dataset.shortcutClear, null);
    });
  }
}

function streamSourceLabel(source) {
  if (source === "guest") {
    return "当前：游客直连";
  }
  return "当前：自动（游客优先，yt-dlp 兜底）";
}

function streamSourceDisabledHint() {
  return "自动模式需在程序目录放置 yt-dlp.exe 后启用";
}

function updateStreamSourceAvailability() {
  if (!streamSourceSelect) {
    return;
  }
  const autoOption = streamSourceSelect.querySelector('option[value="auto"]');
  if (autoOption) {
    autoOption.disabled = !ytDlpAvailable;
    autoOption.title = ytDlpAvailable ? "" : streamSourceDisabledHint();
  }
}

async function refreshYtDlpAvailability() {
  if (!streamSourceSelect) {
    return false;
  }
  try {
    const status = await invokeAppearance("get_yt_dlp_availability");
    ytDlpAvailable = Boolean(status?.available);
  } catch (error) {
    ytDlpAvailable = false;
    console.warn("get_yt_dlp_availability failed:", error);
  }
  updateStreamSourceAvailability();
  return ytDlpAvailable;
}

function formatPlaybackTime(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateRangeProgress(slider, percent) {
  slider.style.setProperty("--progress", percent);
}

function updateProgress(value = playerAudio.currentTime) {
  const mediaDuration = Number.isFinite(playerAudio.duration)
    ? playerAudio.duration
    : 0;
  const safeValue = Math.min(Math.max(Number(value) || 0, 0), mediaDuration || 0);
  const progress = `${mediaDuration > 0 ? (safeValue / mediaDuration) * 100 : 0}%`;
  for (const slider of [progressSlider, immersiveProgressSlider]) {
    slider.max = String(mediaDuration || 0);
    slider.value = String(safeValue);
    updateRangeProgress(slider, progress);
  }
  currentTimeLabel.textContent = formatPlaybackTime(safeValue);
  durationLabel.textContent = formatPlaybackTime(mediaDuration);
  immersiveCurrentTimeLabel.textContent = formatPlaybackTime(safeValue);
  immersiveDurationLabel.textContent = formatPlaybackTime(mediaDuration);
}

function updatePlayPauseButton() {
  const isPlaying = !playerAudio.paused && !playerAudio.ended;
  for (const button of [playPauseButton, immersivePlayPauseButton]) {
    button.dataset.playing = String(isPlaying);
    button.setAttribute("aria-label", isPlaying ? "暂停" : "播放");
  }
}

function withMediaSession(callback) {
  try {
    if (!("mediaSession" in navigator)) {
      return;
    }
    callback(navigator.mediaSession);
  } catch {
    // Media Session is only a probe path; unsupported WebView2 builds must stay silent.
  }
}

function syncMediaSessionTrack(track) {
  withMediaSession((mediaSession) => {
    if (!track?.hasCurrent) {
      mediaSession.metadata = null;
      return;
    }
    mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.uploader,
      artwork: track.thumbnailUrl
        ? [{ src: track.thumbnailUrl, sizes: "512x512", type: "image/jpeg" }]
        : [],
    });
  });
}

function syncMediaSessionPlaybackState(state) {
  withMediaSession((mediaSession) => {
    mediaSession.playbackState = state;
  });
}

function syncMediaSessionPosition() {
  withMediaSession((mediaSession) => {
    if (typeof mediaSession.setPositionState !== "function") {
      return;
    }
    if (!Number.isFinite(playerAudio.duration) || playerAudio.duration <= 0) {
      return;
    }
    const position = Math.min(Math.max(playerAudio.currentTime, 0), playerAudio.duration);
    const playbackRate =
      Number.isFinite(playerAudio.playbackRate) && playerAudio.playbackRate > 0
        ? playerAudio.playbackRate
        : 1;
    mediaSession.setPositionState({
      duration: playerAudio.duration,
      playbackRate,
      position,
    });
  });
}

function shouldForwardMediaSessionAction(action, paused) {
  return action === "play" ? paused : action === "pause" && !paused;
}

function registerMediaSessionActionHandlers() {
  withMediaSession((mediaSession) => {
    mediaSession.setActionHandler("play", () => {
      window.recordPlaybackDiag?.("external-control", "Media Session play");
      if (shouldForwardMediaSessionAction("play", playerAudio.paused)) {
        playPauseButton.click();
      } else {
        window.recordPlaybackDiag?.("external-control", "Media Session play ignored: already playing");
      }
    });
    mediaSession.setActionHandler("pause", () => {
      window.recordPlaybackDiag?.("external-control", "Media Session pause");
      if (shouldForwardMediaSessionAction("pause", playerAudio.paused)) {
        playPauseButton.click();
      } else {
        window.recordPlaybackDiag?.("external-control", "Media Session pause ignored: already paused");
      }
    });
    mediaSession.setActionHandler("previoustrack", () => previousButtonForImmersive.click());
    mediaSession.setActionHandler("nexttrack", () => nextButtonForImmersive.click());
    mediaSession.setActionHandler("seekto", (details) => {
      withMediaSession(() => {
        if (!Number.isFinite(playerAudio.duration) || playerAudio.duration <= 0) {
          return;
        }
        if (details.seekTime != null) {
          playerAudio.currentTime = details.seekTime;
          syncMediaSessionPosition();
        }
      });
    });
    mediaSession.setActionHandler("seekbackward", (details) => {
      withMediaSession(() => {
        if (!Number.isFinite(playerAudio.duration) || playerAudio.duration <= 0) {
          return;
        }
        playerAudio.currentTime = Math.max(
          0,
          playerAudio.currentTime - (details.seekOffset || 10),
        );
        syncMediaSessionPosition();
      });
    });
    mediaSession.setActionHandler("seekforward", (details) => {
      withMediaSession(() => {
        if (!Number.isFinite(playerAudio.duration) || playerAudio.duration <= 0) {
          return;
        }
        playerAudio.currentTime = Math.min(
          playerAudio.duration,
          playerAudio.currentTime + (details.seekOffset || 10),
        );
        syncMediaSessionPosition();
      });
    });
  });
}

function initializeTaskbarControls() {
  let disposed = false;
  let unlisten = null;
  let lastReported = null;
  let reports = Promise.resolve();
  const events = ["play", "pause", "ended", "emptied", "error"];

  const reportPlaybackState = () => {
    const isPlaying = Boolean(
      playerAudio.currentSrc && !playerAudio.paused && !playerAudio.ended && !playerAudio.error,
    );
    if (disposed || isPlaying === lastReported) {
      return;
    }
    lastReported = isPlaying;
    // Serialize only this reporting channel; never await it in playback handlers.
    reports = reports.then(() => {
      if (!disposed) {
        return invokeAppearance("set_taskbar_playback_state", { isPlaying });
      }
    }).catch((error) => {
      console.warn("[taskbar] playback state report failed:", error);
    });
  };

  const stopListening = (stop) => {
    Promise.resolve(stop()).catch((error) => {
      console.warn("[taskbar] event cleanup failed:", error);
    });
  };
  window.__TAURI__.event.listen("taskbar-media-control", ({ payload }) => {
    if (disposed) {
      return;
    }
    if (payload === "play_pause") {
      window.recordPlaybackDiag?.("external-control", "taskbar play_pause");
      playPauseButton.click();
    } else if (payload === "previous") {
      previousButtonForImmersive.click();
    } else if (payload === "next") {
      nextButtonForImmersive.click();
    }
  }).then((stop) => {
    if (disposed) {
      stopListening(stop);
    } else {
      unlisten = stop;
    }
  }).catch((error) => {
    console.warn("[taskbar] media control listener failed:", error);
  });

  for (const event of events) {
    playerAudio.addEventListener(event, reportPlaybackState);
  }
  reportPlaybackState();
  window.addEventListener("beforeunload", () => {
    disposed = true;
    for (const event of events) {
      playerAudio.removeEventListener(event, reportPlaybackState);
    }
    if (unlisten) {
      stopListening(unlisten);
    }
  }, { once: true });
}

function initializeGlobalShortcutControls() {
  let disposed = false;
  let unlisten = null;

  const stopListening = (stop) => {
    Promise.resolve(stop()).catch((error) => {
      console.warn("[shortcut] event cleanup failed:", error);
    });
  };

  window.__TAURI__.event.listen("global-shortcut", ({ payload }) => {
    if (disposed) return;
    if (payload === "previous") {
      previousButtonForImmersive.click();
    } else if (payload === "play_pause") {
      window.recordPlaybackDiag?.("external-control", "global shortcut play_pause");
      playPauseButton.click();
    } else if (payload === "next") {
      nextButtonForImmersive.click();
    } else if (payload === "volume_up") {
      adjustVolumeByStep(1);
    } else if (payload === "volume_down") {
      adjustVolumeByStep(-1);
    }
  }).then((stop) => {
    if (disposed) stopListening(stop);
    else unlisten = stop;
  }).catch((error) => {
    console.warn("[shortcut] event listener failed:", error);
  });

  window.addEventListener("beforeunload", () => {
    disposed = true;
    if (unlisten) stopListening(unlisten);
  }, { once: true });
}

function syncImmersiveTrack(track = currentTrack) {
  currentTrack = {
    ...currentTrack,
    ...track,
  };
  immersiveTitle.textContent = currentTrack.title || "尚未播放";
  immersiveUploader.textContent = currentTrack.uploader || "—";
  openBilibiliButton.disabled = !currentTrack.bvid;
  openBilibiliBarButton.disabled = !currentTrack.bvid;
  addPlaylistCurrentButton.disabled = !currentPlayableTrack();
  if (currentTrack.thumbnailUrl) {
    immersiveCover.src = currentTrack.thumbnailUrl;
    immersiveReflection.src = currentTrack.thumbnailUrl;
  } else {
    immersiveCover.removeAttribute("src");
    immersiveReflection.removeAttribute("src");
  }
  updateProgress();
}

function openImmersive() {
  if (!currentTrack.hasCurrent && !playerAudio.currentSrc) {
    playbackStatus.textContent = "请先从队列中选择一首歌曲。";
    return;
  }
  syncImmersiveTrack();
  immersivePlayer.hidden = false;
  requestAnimationFrame(() => {
    immersivePlayer.classList.add("is-open");
    immersivePlayer.setAttribute("aria-hidden", "false");
  });
}

function closeImmersive() {
  if (immersivePlayer.contains(document.activeElement)) {
    openImmersiveButton.focus({ preventScroll: true });
  }
  immersivePlayer.classList.remove("is-open");
  immersivePlayer.setAttribute("aria-hidden", "true");
}

function syncMascotPickerSelection() {
  const activeId = window.BiliMascot?.getActive?.();
  for (const tile of mascotPicker?.querySelectorAll(".mascot-tile") ?? []) {
    const selected = tile.dataset.mascotId === activeId;
    tile.classList.toggle("is-selected", selected);
    tile.setAttribute("aria-pressed", String(selected));
  }
}

function renderMascotPicker() {
  if (!mascotPicker || !window.BiliMascot) {
    return;
  }
  mascotPicker.textContent = "";
  for (const mascot of window.BiliMascot.list()) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "mascot-tile";
    tile.dataset.mascotId = mascot.id;
    tile.setAttribute("aria-label", mascot.name);

    const preview = document.createElement("span");
    preview.className = "mascot-tile-preview";
    preview.innerHTML = mascot.svg.replace(/\s+id="[^"]*"/g, "");

    const label = document.createElement("span");
    label.className = "mascot-tile-name";
    label.textContent = mascot.name;

    tile.append(preview, label);
    tile.addEventListener("click", () => {
      window.BiliMascot.setActive(mascot.id);
      syncMascotPickerSelection();
    });
    mascotPicker.append(tile);
  }

  const noneTile = document.createElement("button");
  noneTile.type = "button";
  noneTile.className = "mascot-tile mascot-tile-none";
  noneTile.dataset.mascotId = "none";
  noneTile.setAttribute("aria-label", "不显示桌宠");

  const nonePreview = document.createElement("span");
  nonePreview.className = "mascot-tile-preview";
  nonePreview.textContent = "—";

  const noneLabel = document.createElement("span");
  noneLabel.className = "mascot-tile-name";
  noneLabel.textContent = "不显示";

  noneTile.append(nonePreview, noneLabel);
  noneTile.addEventListener("click", () => {
    window.BiliMascot.setActive("none");
    syncMascotPickerSelection();
  });
  mascotPicker.append(noneTile);

  syncMascotPickerSelection();
}

function openSettings() {
  settingsModal.hidden = false;
  restoreStreamSource();
  restoreAudioCacheSettings();
  refreshAudioCacheUsage();
  restoreAiConfig();
  renderMascotPicker();
  requestAnimationFrame(() => {
    settingsModal.classList.add("is-open");
    settingsModal.setAttribute("aria-hidden", "false");
  });
}

async function restoreAudioCacheSettings() {
  clearTimeout(audioCacheStatusTimer);
  audioCacheStatusTimer = null;
  audioCacheEnabled.disabled = true;
  audioCacheCapacity.disabled = true;
  audioCacheSettings = null;
  try {
    audioCacheSettings = await invokeAppearance("get_audio_cache_settings");
    audioCacheEnabled.checked = audioCacheSettings.enabled;
    audioCacheCapacity.value = String(audioCacheSettings.maxBytes);
    audioCacheStatus.textContent = "";
  } catch (error) {
    audioCacheStatus.textContent = `缓存设置读取失败：${error}`;
  } finally {
    audioCacheEnabled.disabled = !audioCacheSettings;
    audioCacheCapacity.disabled = !audioCacheSettings;
  }
}

async function refreshAudioCacheUsage() {
  audioCacheUsage.textContent = "读取中…";
  try {
    const { bytes, items } = await invokeAppearance("get_audio_cache_usage");
    const size = bytes === 0 ? "0 MB" : bytes < 1048576
      ? "不足 1 MB" : `${(bytes / 1048576).toFixed(1)} MB`;
    audioCacheUsage.textContent = `${size} · ${items} 首`;
  } catch (error) {
    audioCacheUsage.textContent = `读取失败：${error}`;
  }
}

async function saveAudioCacheSettings() {
  if (!audioCacheSettings) return;
  clearTimeout(audioCacheStatusTimer);
  audioCacheStatusTimer = null;
  audioCacheEnabled.disabled = true;
  audioCacheCapacity.disabled = true;
  try {
    audioCacheSettings = await invokeAppearance("set_audio_cache_settings", {
      enabled: audioCacheEnabled.checked,
      maxBytes: Number(audioCacheCapacity.value),
    });
    audioCacheEnabled.checked = audioCacheSettings.enabled;
    audioCacheCapacity.value = String(audioCacheSettings.maxBytes);
    audioCacheStatus.textContent = "";
    await refreshAudioCacheUsage();
  } catch (error) {
    audioCacheEnabled.checked = audioCacheSettings.enabled;
    audioCacheCapacity.value = String(audioCacheSettings.maxBytes);
    audioCacheStatus.textContent = `缓存设置保存失败：${error}`;
  } finally {
    audioCacheEnabled.disabled = false;
    audioCacheCapacity.disabled = false;
  }
}

function closeSettings() {
  if (settingsModal.contains(document.activeElement)) {
    openSettingsButton.focus({ preventScroll: true });
  }
  settingsModal.classList.remove("is-open");
  settingsModal.setAttribute("aria-hidden", "true");
}

function setActiveView(view) {
  for (const item of navItems) {
    item.classList.toggle("active", item.dataset.view === view);
  }
  const realViews = {
    home: homeView,
    search: searchView,
    favorites: favoritesView,
    playlists: playlistsView,
  };
  for (const [name, element] of Object.entries(realViews)) {
    if (!element) {
      continue;
    }
    element.hidden = name !== view;
    element.classList.toggle("is-active", name === view);
  }
  placeholderView.hidden = Boolean(realViews[view]);
  if (!realViews[view]) {
    placeholderTitle.textContent = `${viewLabels[view] ?? "功能"}开发中`;
  }
  window.dispatchEvent(
    new CustomEvent("bilibili-music-viewchange", { detail: { view } }),
  );
}

function normalizeAccentColor(value) {
  return typeof value === "string" && Object.hasOwn(ACCENT_COLORS, value) ? value : "pink";
}

function readAccentColor() {
  try {
    return normalizeAccentColor(localStorage.getItem(ACCENT_COLOR_KEY));
  } catch {
    return "pink";
  }
}

function accentChannels(color, theme) {
  return ACCENT_COLORS[normalizeAccentColor(color)][theme === "light" ? "light" : "dark"];
}

function applyAccentColor(value, persist = true) {
  const color = normalizeAccentColor(value);
  currentAccentColor = color;
  accentChannels(color, root.dataset.theme).forEach((channel, index) => {
    root.style.setProperty(`--accent-${["r", "g", "b"][index]}`, String(channel));
  });
  for (const option of accentColorOptions) {
    option.checked = option.value === color;
    option.nextElementSibling.style.backgroundColor = `rgb(${accentChannels(option.value, root.dataset.theme).join(", ")})`;
  }
  if (persist) {
    try {
      localStorage.setItem(ACCENT_COLOR_KEY, color);
    } catch {
      // 存储不可用时仍保留本次运行的选择。
    }
  }
}

function initializeAccentColor() {
  for (const option of accentColorOptions) {
    option.addEventListener("change", () => applyAccentColor(option.value));
  }
  applyAccentColor(readAccentColor(), false);
  // data-theme 的变更在下一次绘制前同步变体，不改主题切换与动态背景逻辑。
  new MutationObserver(() => applyAccentColor(currentAccentColor, false))
    .observe(root, { attributes: true, attributeFilter: ["data-theme"] });
}

function applyTheme(theme, persist = true) {
  const safeTheme = ["dark", "light", "image", "dynamic"].includes(theme) ? theme : "dark";
  root.dataset.theme = safeTheme;
  for (const option of themeOptions) {
    const selected = option.dataset.themeOption === safeTheme;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-checked", String(selected));
  }
  for (const group of imageOnlyGroups) {
    const visible = safeTheme === "image";
    group.classList.toggle("is-disabled", !visible);
  }
  if (safeTheme === "dynamic") {
    // 清除其它主题的内联值，让动态主题完全使用 CSS 固定参数。
    for (const property of ["--glass-blur", "--panel-alpha", "--background-dim"]) {
      root.style.removeProperty(property);
    }
  } else {
    setGlassBlur(localStorage.getItem(GLASS_BLUR_KEY), false);
    setPanelAlpha(localStorage.getItem(PANEL_ALPHA_KEY), false);
    setBackgroundDim(localStorage.getItem(BACKGROUND_DIM_KEY), false);
  }
  if (persist) {
    localStorage.setItem(THEME_KEY, safeTheme);
  }
}

function setGlassBlur(value, persist = true) {
  const safeValue = clampNumber(value, 0, 80, 40);
  root.style.setProperty("--glass-blur", `${safeValue}px`);
  glassBlurSlider.value = String(safeValue);
  glassBlurValue.textContent = `${safeValue}px`;
  if (persist) {
    localStorage.setItem(GLASS_BLUR_KEY, String(safeValue));
  }
}

function setPanelAlpha(value, persist = true) {
  panelAlphaSlider.min = "20";
  const safeValue = clampNumber(value, 20, 100, 72);
  root.style.setProperty("--panel-alpha", String(safeValue / 100));
  panelAlphaSlider.value = String(safeValue);
  panelAlphaValue.textContent = `${safeValue}%`;
  if (persist) {
    localStorage.setItem(PANEL_ALPHA_KEY, String(safeValue));
  }
}

function setBackgroundDim(value, persist = true) {
  backgroundDimSlider.min = "40";
  const safeValue = clampNumber(value, 40, 95, 90);
  root.style.setProperty("--background-dim", String(safeValue / 100));
  backgroundDimSlider.value = String(safeValue);
  backgroundDimValue.textContent = `${safeValue}%`;
  if (persist) {
    localStorage.setItem(BACKGROUND_DIM_KEY, String(safeValue));
  }
}

function applyBackground(image) {
  root.style.setProperty("--app-background", `url("${image.dataUrl}")`);
  backgroundName.textContent = `${image.displayName} · ${image.width}×${image.height}`;
  backgroundName.title = image.path;
}

function resetBackground({ clearStorage = true } = {}) {
  root.style.removeProperty("--app-background");
  backgroundName.textContent = "使用默认背景";
  backgroundName.removeAttribute("title");
  appearanceStatus.textContent = "";
  if (clearStorage) {
    localStorage.removeItem(BACKGROUND_PATH_KEY);
  }
}

async function restoreBackground() {
  const path = localStorage.getItem(BACKGROUND_PATH_KEY);
  if (!path) {
    return;
  }

  appearanceStatus.textContent = "正在恢复背景…";
  try {
    const image = await invokeAppearance("load_background_image", { path });
    applyBackground(image);
    appearanceStatus.textContent = "";
  } catch (error) {
    resetBackground();
    appearanceStatus.textContent = `背景已回退为默认：${error}`;
  }
}

async function restoreStreamSource() {
  if (!streamSourceSelect) {
    return;
  }

  try {
    await refreshYtDlpAvailability();
    let source = await invokeAppearance("get_stream_source");
    if (source === "yt-dlp" || (source === "auto" && !ytDlpAvailable)) {
      source = await invokeAppearance("set_stream_source", { source: "guest" });
    }
    streamSourceSelect.value = source === "auto" && ytDlpAvailable ? "auto" : "guest";
    streamSourceStatus.textContent =
      source === "auto" && ytDlpAvailable
        ? streamSourceLabel("auto")
        : ytDlpAvailable
          ? streamSourceLabel("guest")
          : `${streamSourceLabel("guest")}；${streamSourceDisabledHint()}`;
  } catch (error) {
    streamSourceStatus.textContent = `取流方案读取失败：${error}`;
  }
}

function updateAiConfigStatus(config) {
  if (!aiConfigStatus) {
    return;
  }
  const keyText = config?.hasKey
    ? `API Key 已配置${config.keyHint ? `（${config.keyHint}）` : ""}`
    : "API Key 未配置";
  aiConfigStatus.textContent = keyText;
}

async function restoreAiConfig() {
  if (!aiBaseUrlInput || !aiModelInput || !aiApiKeyInput || !aiConfigStatus) {
    return;
  }

  aiConfigStatus.textContent = "正在读取 AI 配置…";
  try {
    const config = await invokeAppearance("get_ai_config");
    aiBaseUrlInput.value = config.baseUrl ?? "";
    aiModelInput.value = config.model ?? "";
    aiApiKeyInput.value = "";
    updateAiConfigStatus(config);
  } catch (error) {
    aiConfigStatus.textContent = `AI 配置读取失败：${error}`;
  }
}

async function saveAiConfig() {
  if (!aiBaseUrlInput || !aiModelInput || !aiApiKeyInput || !saveAiConfigButton || !aiConfigStatus) {
    return;
  }

  saveAiConfigButton.disabled = true;
  aiConfigStatus.textContent = "正在验证并保存 AI 配置…";
  try {
    const test = await invokeAppearance("test_ai_connection", {
      baseUrl: aiBaseUrlInput.value,
      model: aiModelInput.value,
      apiKey: aiApiKeyInput.value,
    });
    if (!test.ok) {
      aiConfigStatus.textContent = `连接测试未通过，未保存：${test.message}`;
      return;
    }
    const config = await invokeAppearance("set_ai_config", {
      baseUrl: aiBaseUrlInput.value,
      model: aiModelInput.value,
      apiKey: aiApiKeyInput.value,
    });
    aiApiKeyInput.value = "";
    updateAiConfigStatus(config);
    aiConfigStatus.textContent = "连接正常，配置已保存。";
    window.dispatchEvent(new Event("ai-config-updated"));
  } catch (error) {
    aiConfigStatus.textContent = `AI 配置保存失败：${error}`;
  } finally {
    saveAiConfigButton.disabled = false;
  }
}

async function testAiConnection() {
  if (!testAiConnectionButton || !aiConfigStatus || !aiBaseUrlInput || !aiModelInput || !aiApiKeyInput) {
    return;
  }

  testAiConnectionButton.disabled = true;
  aiConfigStatus.textContent = "正在测试 AI 连接…";
  try {
    const result = await invokeAppearance("test_ai_connection", {
      baseUrl: aiBaseUrlInput.value,
      model: aiModelInput.value,
      apiKey: aiApiKeyInput.value,
    });
    aiConfigStatus.textContent = result.ok ? "AI 连接正常。" : `AI 连接失败：${result.message}`;
  } catch (error) {
    aiConfigStatus.textContent = `AI 连接测试失败：${error}`;
  } finally {
    testAiConnectionButton.disabled = false;
  }
}

async function openCurrentBilibiliVideo() {
  if (!currentTrack.bvid) {
    playbackStatus.textContent = "当前没有可打开的 B 站视频。";
    return;
  }
  try {
    await invokeAppearance("open_bilibili_video", { bvId: currentTrack.bvid });
  } catch (error) {
    playbackStatus.textContent = `打开 B站失败：${error}`;
  }
}

function applyVolume(value, persist = true) {
  const safeValue = clampNumber(value, 0, 1, 1);
  if (normalizationAnimationFrame !== null) {
    cancelAnimationFrame(normalizationAnimationFrame);
    normalizationAnimationFrame = null;
  }
  userVolume = safeValue;
  updateEffectiveVolume();
  volumeSlider.value = String(safeValue);
  updateRangeProgress(volumeSlider, `${safeValue * 100}%`);
  if (persist) {
    localStorage.setItem(VOLUME_KEY, String(safeValue));
  }
}

function adjustVolumeByStep(direction) {
  const nextVolume = Math.min(
    1,
    Math.max(0, userVolume + direction * GLOBAL_SHORTCUT_VOLUME_STEP),
  );
  applyVolume(nextVolume);
}

function updateEffectiveVolume() {
  playerAudio.volume = clampNumber(userVolume * (loudnessNormalizationEnabled ? normalizationGain : 1), 0, 1, 1);
}

function setNormalizationGain(gain) {
  if (normalizationAnimationFrame !== null) {
    cancelAnimationFrame(normalizationAnimationFrame);
    normalizationAnimationFrame = null;
  }
  const startVolume = playerAudio.volume;
  normalizationGain = clampNumber(gain, 0, 1, 1);
  const targetVolume = clampNumber(
    userVolume * (loudnessNormalizationEnabled ? normalizationGain : 1),
    0,
    1,
    1,
  );
  if (startVolume === targetVolume) return;

  let startedAt = null;
  const step = (now) => {
    startedAt ??= now;
    const progress = Math.min(1, (now - startedAt) / 250);
    playerAudio.volume = startVolume + (targetVolume - startVolume) * progress;
    if (progress < 1) {
      normalizationAnimationFrame = requestAnimationFrame(step);
    } else {
      normalizationAnimationFrame = null;
    }
  };
  normalizationAnimationFrame = requestAnimationFrame(step);
}

function isLoudnessNormalizationEnabled() {
  return loudnessNormalizationEnabled;
}

function applyLoudnessNormalization(enabled, persist = true) {
  loudnessNormalizationEnabled = enabled === true;
  loudnessNormalizationToggle.checked = loudnessNormalizationEnabled;
  setNormalizationGain(1);
  if (persist) {
    try {
      localStorage.setItem(LOUDNESS_NORMALIZATION_KEY, String(loudnessNormalizationEnabled));
    } catch (error) {
      console.warn("loudness normalization setting save failed:", error);
    }
  }
  refreshTrackLoudness();
}

function initializeLoudnessNormalization() {
  let enabled = false;
  try {
    enabled = localStorage.getItem(LOUDNESS_NORMALIZATION_KEY) === "true";
  } catch (error) {
    console.warn("loudness normalization setting read failed:", error);
  }
  applyLoudnessNormalization(enabled, false);
}

for (const item of navItems) {
  item.addEventListener("click", () => setActiveView(item.dataset.view));
}

openSettingsButton.addEventListener("click", openSettings);
closeSettingsButton.addEventListener("click", closeSettings);
settingsModal.addEventListener("transitionend", (event) => {
  if (event.target === settingsModal && !settingsModal.classList.contains("is-open")) {
    settingsModal.hidden = true;
  }
});
settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) {
    closeSettings();
  }
});

for (const option of themeOptions) {
  option.addEventListener("click", () => applyTheme(option.dataset.themeOption));
}

glassBlurSlider.addEventListener("input", () => setGlassBlur(glassBlurSlider.value));
panelAlphaSlider.addEventListener("input", () => setPanelAlpha(panelAlphaSlider.value));
backgroundDimSlider.addEventListener("input", () => setBackgroundDim(backgroundDimSlider.value));

chooseBackgroundButton.addEventListener("click", async () => {
  chooseBackgroundButton.disabled = true;
  appearanceStatus.textContent = "正在处理图片…";
  try {
    const image = await invokeAppearance("choose_background_image");
    if (!image) {
      appearanceStatus.textContent = "";
      return;
    }
    applyBackground(image);
    localStorage.setItem(BACKGROUND_PATH_KEY, image.path);
    applyTheme("image");
    appearanceStatus.textContent = "背景已保存。";
  } catch (error) {
    appearanceStatus.textContent = `背景设置失败：${error}`;
  } finally {
    chooseBackgroundButton.disabled = false;
  }
});

resetBackgroundButton.addEventListener("click", () => resetBackground());
saveAiConfigButton?.addEventListener("click", saveAiConfig);
testAiConnectionButton?.addEventListener("click", testAiConnection);

streamSourceSelect?.addEventListener("change", async () => {
  if (streamSourceSelect.value === "auto" && !ytDlpAvailable) {
    streamSourceSelect.value = "guest";
    streamSourceStatus.textContent = `${streamSourceLabel("guest")}；${streamSourceDisabledHint()}`;
    return;
  }

  streamSourceSelect.disabled = true;
  streamSourceStatus.textContent = "正在切换取流方案…";
  try {
    const source = await invokeAppearance("set_stream_source", {
      source: streamSourceSelect.value,
    });
    streamSourceSelect.value = source;
    streamSourceStatus.textContent = streamSourceLabel(source);
  } catch (error) {
    streamSourceStatus.textContent = `取流方案切换失败：${error}`;
    await restoreStreamSource();
  } finally {
    streamSourceSelect.disabled = false;
  }
});

audioCacheEnabled?.addEventListener("change", saveAudioCacheSettings);
audioCacheCapacity?.addEventListener("change", saveAudioCacheSettings);
clearAudioCacheButton?.addEventListener("click", async () => {
  clearTimeout(audioCacheStatusTimer);
  audioCacheStatusTimer = null;
  clearAudioCacheButton.disabled = true;
  audioCacheStatus.textContent = "正在清空缓存…";
  try {
    await invokeAppearance("clear_audio_cache");
    await refreshAudioCacheUsage();
    audioCacheStatus.textContent = "缓存已清空";
    audioCacheStatusTimer = setTimeout(() => {
      audioCacheStatus.textContent = "";
      audioCacheStatusTimer = null;
    }, 3000);
  } catch (error) {
    audioCacheStatus.textContent = `清空缓存失败：${error}`;
  } finally {
    clearAudioCacheButton.disabled = false;
  }
});
window.addEventListener("bilibili-music-audio-cache-updated", () => {
  if (settingsModal.classList.contains("is-open")) refreshAudioCacheUsage();
});

clearSearchHistoryButton?.addEventListener("click", async () => {
  clearSearchHistoryButton.disabled = true;
  appearanceStatus.textContent = "正在清空搜索历史…";
  try {
    await invokeAppearance("clear_search_history");
    appearanceStatus.textContent = "搜索历史已清空。";
  } catch (error) {
    appearanceStatus.textContent = `清空搜索历史失败：${error}`;
  } finally {
    clearSearchHistoryButton.disabled = false;
  }
});

exportDataButton.addEventListener("click", async () => {
  exportDataButton.disabled = true;
  try {
    const saved = await invokeAppearance("export_data");
    appearanceStatus.textContent = saved ? `已导出到：${saved}` : "";
  } catch (error) {
    appearanceStatus.textContent = `导出失败：${error}`;
  } finally {
    exportDataButton.disabled = false;
  }
});

importDataButton.addEventListener("click", async () => {
  const ok = window.confirm("导入会用所选备份覆盖当前的收藏、歌单、听歌记录、AI 配置与背景，且不可撤销。确定继续？");
  if (!ok) return;
  importDataButton.disabled = true;
  try {
    const result = await invokeAppearance("import_data");
    if (result) {
      appearanceStatus.textContent = "导入完成，正在刷新…";
      window.location.reload();
      return;
    }
    appearanceStatus.textContent = "";
  } catch (error) {
    appearanceStatus.textContent = `导入失败：${error}`;
  }
  importDataButton.disabled = false;
});

openImmersiveButton.addEventListener("click", openImmersive);
closeImmersiveButton.addEventListener("click", closeImmersive);
immersivePlayer.addEventListener("transitionend", (event) => {
  if (event.target === immersivePlayer && !immersivePlayer.classList.contains("is-open")) {
    immersivePlayer.hidden = true;
  }
});
immersivePlayer.addEventListener("click", (event) => {
  if (event.target.dataset.closeImmersive === "true") {
    closeImmersive();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (immersivePlayer.classList.contains("is-open")) {
      closeImmersive();
    }
    if (settingsModal.classList.contains("is-open")) {
      closeSettings();
    }
  }
});
window.addEventListener("bilibili-music-trackchange", (event) => {
  syncImmersiveTrack(event.detail);
  syncMediaSessionTrack(event.detail);
});

playPauseButton.addEventListener("click", async () => {
  if (!playerAudio.currentSrc) {
    window.recordPlaybackDiag?.("play-pause-button", "no source");
    playbackStatus.textContent = "请先从队列中选择一首歌曲。";
    return;
  }
  if (playerAudio.paused) {
    window.recordPlaybackDiag?.("play-pause-button", "play");
    try {
      await playerAudio.play();
    } catch {
      playbackStatus.textContent = "音频暂时无法播放，请稍后重试。";
    }
  } else {
    window.recordPlaybackDiag?.("play-pause-button", "pause");
    playerAudio.pause();
  }
});
immersivePlayPauseButton.addEventListener("click", () => {
  window.recordPlaybackDiag?.("external-control", "immersive button");
  playPauseButton.click();
});
immersivePreviousButton.addEventListener("click", () => previousButtonForImmersive.click());
immersiveNextButton.addEventListener("click", () => nextButtonForImmersive.click());
openBilibiliButton.addEventListener("click", openCurrentBilibiliVideo);
openBilibiliBarButton.addEventListener("click", openCurrentBilibiliVideo);
addPlaylistCurrentButton.addEventListener("click", () => choosePlaylistAndAdd());
volumeSlider.addEventListener("input", () => applyVolume(volumeSlider.value));
loudnessNormalizationToggle.addEventListener("change", () => applyLoudnessNormalization(loudnessNormalizationToggle.checked));
loudnessNormalizationToggle.addEventListener("change", () => {
  if (loudnessNormalizationToggle.checked) {
    showLoudnessNormalizationDialog();
  }
});

progressSlider.addEventListener("pointerdown", () => {
  isSeeking = true;
});
immersiveProgressSlider.addEventListener("pointerdown", () => {
  isSeeking = true;
});

progressSlider.addEventListener("input", () => {
  isSeeking = true;
  updateProgress(Number(progressSlider.value));
});
immersiveProgressSlider.addEventListener("input", () => {
  isSeeking = true;
  updateProgress(Number(immersiveProgressSlider.value));
});

progressSlider.addEventListener("change", () => {
  if (Number.isFinite(playerAudio.duration)) {
    playerAudio.currentTime = Number(progressSlider.value);
  }
  isSeeking = false;
});
immersiveProgressSlider.addEventListener("change", () => {
  if (Number.isFinite(playerAudio.duration)) {
    playerAudio.currentTime = Number(immersiveProgressSlider.value);
  }
  isSeeking = false;
});

playerAudio.addEventListener("timeupdate", () => {
  if (!isSeeking) {
    updateProgress();
    syncMediaSessionPosition();
  }
});
playerAudio.addEventListener("durationchange", () => {
  updateProgress();
  syncMediaSessionPosition();
});
playerAudio.addEventListener("loadedmetadata", () => {
  updateProgress();
  syncMediaSessionPosition();
});
playerAudio.addEventListener("play", () => {
  updatePlayPauseButton();
  syncMediaSessionPlaybackState("playing");
});
playerAudio.addEventListener("pause", () => {
  updatePlayPauseButton();
  syncMediaSessionPlaybackState("paused");
});
playerAudio.addEventListener("ended", () => {
  updatePlayPauseButton();
  syncMediaSessionPlaybackState("none");
});
playerAudio.addEventListener("emptied", () => {
  isSeeking = false;
  updateProgress(0);
  updatePlayPauseButton();
  syncMediaSessionPlaybackState("none");
});

initializeAccentColor();
initializeShortcutSettings();
applyTheme(localStorage.getItem(THEME_KEY), false);
applyVolume(localStorage.getItem(VOLUME_KEY), false);
initializeLoudnessNormalization();
updateProgress(0);
updatePlayPauseButton();
syncImmersiveTrack();
registerMediaSessionActionHandlers();
initializeTaskbarControls();
initializeGlobalShortcutControls();
restoreBackground();
restoreStreamSource();
