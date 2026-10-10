type ShortcutAction = keyof CommandContract.ShortcutBindings;
type Unlisten = Awaited<ReturnType<TauriEventApi["listen"]>>;

import { createPlaybackCommands } from "./playback-commands.ts";
import { effectivePlaybackVolume } from "./playback-settings-state.ts";
import { createMediaAdapter, createMediaSessionAdapter } from "./media-adapter.ts";
import { normalizeSettingsAccent } from "./settings-state.ts";
import { readSettingsPreference } from "./settings-adapter.ts";
import { readShuffleCollectionPrefs } from "./playback-policy.ts";
import { clearPlaybackNotice } from "./playback-notice.ts";
import { getApplicationStore } from "./home.ts";
import type { SettingsSnapshot } from "./settings-state.ts";

import { choosePlaylistAndAdd } from "./library-ui.ts";
import { advancePageWithinCurrentBv, clearPendingResume, currentPlayableTrack, getQueueSnapshot, getSessionSnapshot, playNext, playPrevious, refreshTrackLoudness, resumePendingPlayback, retreatPageWithinCurrentBv, showLoudnessNormalizationDialog } from "./playback-core.ts";
import { finishSettingsPanelTransition, prepareSettingsPanel, renderSettingsShortcut, renderSettingsSnapshot } from "./settings-view.ts";
import { renderPlaybackSettingsSnapshot } from "./playback-settings-view.ts";
import { renderPlaybackDisplaySnapshot } from "./playback-display-view.ts";

const { invoke: invokeAppearance } = window.__TAURI__.core;

const THEME_KEY = "bilibili-music.theme";
const ACCENT_COLOR_KEY = "bilibili-music.accent-color";
const VOLUME_KEY = "bilibili-music.volume";
// 全局快捷键步长独立于滑块，方便 live 调整每次按键的幅度。
const GLOBAL_SHORTCUT_VOLUME_STEP = 0.05;
const LOUDNESS_NORMALIZATION_KEY = "bilibili-music.loudness-normalization";
const SHUFFLE_COLLECTION_ORDER_KEY = "bilibili-music.shuffle-collection-order";
const SHUFFLE_COLLECTION_LIMIT_KEY = "bilibili-music.shuffle-collection-limit";
let playbackSettingsMounted = false;
let playbackSettingsMedia: ReturnType<typeof createMediaAdapter> | null = null;
let normalizationAnimationFrame: number | null = null;

const root = document.documentElement;
const navItems = [...document.querySelectorAll<HTMLButtonElement & { dataset: DOMStringMap & { view: string } }>(".nav-item[data-view]")];
const homeView = document.querySelector<HTMLElement>("#view-home")!;
const searchView = document.querySelector<HTMLElement>("#view-search")!;
const favoritesView = document.querySelector<HTMLElement>("#view-favorites")!;
const playlistsView = document.querySelector<HTMLElement>("#view-playlists")!;
const placeholderView = document.querySelector<HTMLElement>("#view-placeholder")!;
const placeholderTitle = document.querySelector<HTMLHeadingElement>("#placeholder-title")!;
const settingsModal = document.querySelector<HTMLDivElement>("#settings-modal")!;
const openSettingsButton = document.querySelector<HTMLButtonElement>("#open-settings-button")!;
const closeSettingsButton = document.querySelector<HTMLButtonElement>("#close-settings-button")!;
const themeOptions = [...document.querySelectorAll<HTMLButtonElement & { dataset: DOMStringMap & { themeOption: string } }>("[data-theme-option]")];
const accentColorOptions = [...document.querySelectorAll<HTMLInputElement & { nextElementSibling: HTMLElement }>("[data-accent-color]")];
const mascotPicker = document.querySelector<HTMLDivElement>("#mascot-picker")!;
const chooseBackgroundButton = document.querySelector<HTMLButtonElement>("#choose-background-button")!;
const resetBackgroundButton = document.querySelector<HTMLButtonElement>("#reset-background-button")!;
const backgroundName = document.querySelector<HTMLElement>("#background-name")!;
const appearanceStatus = document.querySelector<HTMLParagraphElement>("#appearance-status")!;
const imageOnlyGroups = [...document.querySelectorAll<HTMLElement>(".image-only")];
const glassBlurSlider = document.querySelector<HTMLInputElement>("#glass-blur-slider")!;
const glassBlurValue = document.querySelector<HTMLElement>("#glass-blur-value")!;
const panelAlphaSlider = document.querySelector<HTMLInputElement>("#panel-alpha-slider")!;
const panelAlphaValue = document.querySelector<HTMLElement>("#panel-alpha-value")!;
const backgroundDimSlider = document.querySelector<HTMLInputElement>("#background-dim-slider")!;
const backgroundDimValue = document.querySelector<HTMLElement>("#background-dim-value")!;
const streamSourceSelect = document.querySelector<HTMLSelectElement>("#stream-source-select")!;
const streamSourceStatus = document.querySelector<HTMLElement>("#stream-source-status")!;
const audioCacheEnabled = document.querySelector<HTMLInputElement>("#audio-cache-enabled")!;
const audioCacheCapacity = document.querySelector<HTMLSelectElement>("#audio-cache-capacity")!;
const shuffleCollectionOrder = document.querySelector<HTMLSelectElement>("#shuffle-collection-order")!;
const shuffleCollectionLimit = document.querySelector<HTMLSelectElement>("#shuffle-collection-limit")!;
const audioCacheUsage = document.querySelector<HTMLElement>("#audio-cache-usage")!;
const audioCacheStatus = document.querySelector<HTMLElement>("#audio-cache-status")!;
const clearAudioCacheButton = document.querySelector<HTMLButtonElement>("#clear-audio-cache-button")!;
const clearSearchHistoryButton = document.querySelector<HTMLButtonElement>("#clear-search-history-button")!;
const exportDataButton = document.querySelector<HTMLButtonElement>("#export-data-button")!;
const importDataButton = document.querySelector<HTMLButtonElement>("#import-data-button")!;
const aiApiFormatSelect = document.querySelector<HTMLSelectElement>("#ai-api-format-select")!;
const aiBaseUrlInput = document.querySelector<HTMLInputElement>("#ai-base-url-input")!;
const aiModelInput = document.querySelector<HTMLInputElement>("#ai-model-input")!;
const aiApiKeyInput = document.querySelector<HTMLInputElement>("#ai-api-key-input")!;
const saveAiConfigButton = document.querySelector<HTMLButtonElement>("#save-ai-config-button")!;
const testAiConnectionButton = document.querySelector<HTMLButtonElement>("#test-ai-connection-button")!;
const aiConfigStatus = document.querySelector<HTMLElement>("#ai-config-status")!;
const shortcutRecordButtons = [...document.querySelectorAll<HTMLButtonElement & { dataset: DOMStringMap & { shortcutAction: ShortcutAction } }>("[data-shortcut-action]")];
const shortcutClearButtons = [...document.querySelectorAll<HTMLButtonElement & { dataset: DOMStringMap & { shortcutClear: ShortcutAction } }>("[data-shortcut-clear]")];

const playerAudio = document.querySelector<HTMLAudioElement>("#audio")!;
const playPauseButton = document.querySelector<HTMLButtonElement>("#play-pause-button")!;
const progressSlider = document.querySelector<HTMLInputElement>("#progress-slider")!;
const currentTimeLabel = document.querySelector<HTMLSpanElement>("#current-time")!;
const durationLabel = document.querySelector<HTMLSpanElement>("#duration")!;
const playbackStatus = document.querySelector<HTMLParagraphElement>("#status")!;
const openImmersiveButton = document.querySelector<HTMLButtonElement>("#open-immersive-button")!;
const immersivePlayer = document.querySelector<HTMLElement>("#immersive-player")!;
const closeImmersiveButton = document.querySelector<HTMLButtonElement>("#close-immersive-button")!;
const immersiveCover = document.querySelector<HTMLImageElement>("#immersive-cover")!;
const immersiveReflection = document.querySelector<HTMLImageElement>("#immersive-reflection")!;
const immersiveTitle = document.querySelector<HTMLHeadingElement>("#immersive-title")!;
const immersiveUploader = document.querySelector<HTMLParagraphElement>("#immersive-uploader")!;
const immersivePreviousButton = document.querySelector<HTMLButtonElement>("#immersive-previous-button")!;
const immersiveNextButton = document.querySelector<HTMLButtonElement>("#immersive-next-button")!;
const immersivePlayPauseButton = document.querySelector<HTMLButtonElement>("#immersive-play-pause-button")!;
const immersiveProgressSlider = document.querySelector<HTMLInputElement>("#immersive-progress-slider")!;
const immersiveCurrentTimeLabel = document.querySelector<HTMLSpanElement>("#immersive-current-time")!;
const immersiveDurationLabel = document.querySelector<HTMLSpanElement>("#immersive-duration")!;
const openBilibiliButton = document.querySelector<HTMLButtonElement>("#open-bilibili-button")!;
const openBilibiliBarButton = document.querySelector<HTMLButtonElement>("#open-bilibili-bar-button")!;
const addPlaylistCurrentButton = document.querySelector<HTMLButtonElement>("#add-playlist-current-button")!;
const previousButtonForImmersive = document.querySelector<HTMLButtonElement>("#previous-button")!;
const nextButtonForImmersive = document.querySelector<HTMLButtonElement>("#next-button")!;
const volumeSlider = document.querySelector<HTMLInputElement>("#volume-slider")!;
const loudnessNormalizationToggle = document.querySelector<HTMLInputElement>("#loudness-normalization-toggle")!;

let playbackDisplayMounted = false;



function settingsDom() { return { root, navItems, homeView, searchView, favoritesView, playlistsView, placeholderView, placeholderTitle, settingsModal, openSettingsButton, themeOptions, accentColorOptions, chooseBackgroundButton, backgroundName, appearanceStatus, imageOnlyGroups, glassBlurSlider, glassBlurValue, panelAlphaSlider, panelAlphaValue, backgroundDimSlider, backgroundDimValue, streamSourceSelect, streamSourceStatus, audioCacheEnabled, audioCacheCapacity, shuffleCollectionOrder, shuffleCollectionLimit, audioCacheUsage, audioCacheStatus, clearAudioCacheButton, aiApiFormatSelect, aiBaseUrlInput, aiModelInput, aiApiKeyInput, saveAiConfigButton, testAiConnectionButton, aiConfigStatus, shortcutRecordButtons }; }
type SettingsDom = ReturnType<typeof settingsDom>;
let settingsMounted = false;
function getSettingsSnapshot() { return getApplicationStore().getState().settings; }
function getSettingsActions() {
  const store = getApplicationStore();
  if (!settingsMounted) {
    settingsMounted = true;
    let previous: SettingsSnapshot | null = null;
    const render = () => { const current = store.getState().settings; if (current === previous) return; renderSettingsSnapshot(current, previous, settingsDom()); previous = current; };
    store.subscribe(render);
    render();
  }
  return store.actions.settings;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

function isShortcutModifierCode(code: string) {
  return /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code);
}

function shortcutFromKeyboardEvent(event: KeyboardEvent) {
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



function shortcutButtonFor(action: ShortcutAction) {
  return shortcutRecordButtons.find((button) => button.dataset.shortcutAction === action);
}

function renderShortcutButton(action: ShortcutAction) { renderSettingsShortcut(getSettingsSnapshot(), action, settingsDom()); }

function handleShortcutRecordingPointerDown(event: PointerEvent) {
  if (!(event.target as Element).closest?.("[data-shortcut-action]")) {
    cancelShortcutRecording();
  }
}

function handleShortcutRecordingKeydown(event: KeyboardEvent) {
  const recordingShortcutAction = getSettingsSnapshot().recordingShortcutAction;
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
    getSettingsActions().setNotice("请使用组合键");
    return;
  }
  const action = recordingShortcutAction;
  cancelShortcutRecording();
  void saveShortcutBinding(action, shortcut);
}

function cancelShortcutRecording() {
  if (!getSettingsSnapshot().recordingShortcutAction) return;
  getSettingsActions().cancelRecording();
  window.removeEventListener("keydown", handleShortcutRecordingKeydown, true);
  window.removeEventListener("pointerdown", handleShortcutRecordingPointerDown, true);
  window.removeEventListener("blur", cancelShortcutRecording);
}

function startShortcutRecording(action: ShortcutAction) {
  cancelShortcutRecording();
  getSettingsActions().beginRecording(action);
  const button = shortcutButtonFor(action);
  if (!button) return;
  window.addEventListener("keydown", handleShortcutRecordingKeydown, true);
  window.addEventListener("pointerdown", handleShortcutRecordingPointerDown, true);
  window.addEventListener("blur", cancelShortcutRecording);
}

async function saveShortcutBinding(action: ShortcutAction, value: string | null) { await getSettingsActions().saveShortcut(action, value); }

async function initializeShortcutSettings() {
  await getSettingsActions().loadShortcuts();
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









function formatPlaybackTime(value: number) {
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

function updateRangeProgress(slider: HTMLInputElement, percent: string) {
  slider.style.setProperty("--progress", percent);
}

function getPlaybackDisplayActions() {
  const store = getApplicationStore();
  if (!playbackDisplayMounted) {
    playbackDisplayMounted = true;
    let previous: ReturnType<typeof store.getState>["playbackDisplay"] | null = null;
    const render = () => {
      const state = store.getState().playbackDisplay;
      if (state === previous) return;
      renderPlaybackDisplaySnapshot(state, previous, { progressSlider, immersiveProgressSlider, currentTimeLabel, durationLabel, immersiveCurrentTimeLabel, immersiveDurationLabel, playPauseButton, immersivePlayPauseButton }, {
        formatTime: formatPlaybackTime,
        setTrack: track => withMediaSession(session => createMediaSessionAdapter(session, init => new MediaMetadata(init)).setTrack(track)),
        setPlaybackState: state => withMediaSession(session => createMediaSessionAdapter(session, init => new MediaMetadata(init)).setPlaybackState(state)),
        setPosition: position => withMediaSession(session => createMediaSessionAdapter(session, init => new MediaMetadata(init)).setPosition(position)),
      });
      previous = state;
    };
    store.subscribe(render); render();
  }
  return store.actions.playbackDisplay;
}

function getPlaybackDisplaySnapshot() {
  getPlaybackDisplayActions();
  return getApplicationStore().getState().playbackDisplay;
}

function readPlaybackMediaSnapshot() {
  getPlaybackDisplayActions().observeMedia(getPlaybackMedia().getObservation());
  return getPlaybackDisplaySnapshot();
}

function updateProgress(value: number | string = getPlaybackMedia().getCurrentTime()) {
  getPlaybackDisplayActions().observeProgress(getPlaybackMedia().getObservation(), value);
}

function updatePlayPauseButton() {
  getPlaybackDisplayActions().observePlaying(getPlaybackMedia().getObservation());
}

function withMediaSession(callback: (mediaSession: MediaSession) => void) {
  try {
    if (!("mediaSession" in navigator)) {
      return;
    }
    callback(navigator.mediaSession);
  } catch {
    // Media Session is only a probe path; unsupported WebView2 builds must stay silent.
  }
}

function syncMediaSessionTrack(track: CurrentTrackDetail) {
  getPlaybackDisplayActions().setTrack(track);
}

function syncMediaSessionPlaybackState(state: MediaSessionPlaybackState) {
  getPlaybackDisplayActions().setSessionState(state);
}

function syncMediaSessionPosition() {
  getPlaybackDisplayActions().observePosition(getPlaybackMedia().getObservation());
}

function getPlaybackCommands() {
  return createPlaybackCommands({
    session: () => getSessionSnapshot(), resume: () => resumePendingPlayback(),
    shuffle: () => getQueueSnapshot().shuffle,
    retreat: () => retreatPageWithinCurrentBv(), advance: () => advancePageWithinCurrentBv(),
    previous: () => playPrevious(), next: () => playNext(), clearResume: () => clearPendingResume(), clearNotice: () => clearPlaybackNotice(),
    media: getPlaybackMedia, observe: readPlaybackMediaSnapshot,
    setSeeking: value => getPlaybackDisplayActions().setSeeking(value), syncPosition: syncMediaSessionPosition,
    diagnostic: (kind, message) => window.recordPlaybackDiag?.(kind, message),
    status: message => { playbackStatus.textContent = message; },
  });
}

function shouldForwardMediaSessionAction(action: string, paused: boolean) {
  return action === "play" ? paused : action === "pause" && !paused;
}

function registerMediaSessionActionHandlers() {
  withMediaSession((mediaSession) => {
    const controls = createMediaSessionAdapter(mediaSession, init => new MediaMetadata(init));
    controls.setActionHandler("play", () => {
      window.recordPlaybackDiag?.("external-control", "Media Session play");
      if (shouldForwardMediaSessionAction("play", readPlaybackMediaSnapshot().paused)) {
        void getPlaybackCommands().togglePlayPause();
      } else {
        window.recordPlaybackDiag?.("external-control", "Media Session play ignored: already playing");
      }
    });
    controls.setActionHandler("pause", () => {
      window.recordPlaybackDiag?.("external-control", "Media Session pause");
      if (shouldForwardMediaSessionAction("pause", readPlaybackMediaSnapshot().paused)) {
        void getPlaybackCommands().togglePlayPause();
      } else {
        window.recordPlaybackDiag?.("external-control", "Media Session pause ignored: already paused");
      }
    });
    controls.setActionHandler("previoustrack", () => getPlaybackCommands().previous());
    controls.setActionHandler("nexttrack", () => getPlaybackCommands().next());
    controls.setActionHandler("seekto", details => { withMediaSession(() => getPlaybackCommands().seekTo(details.seekTime)); });
    controls.setActionHandler("seekbackward", details => { withMediaSession(() => getPlaybackCommands().seekBy(-1, details.seekOffset)); });
    controls.setActionHandler("seekforward", details => { withMediaSession(() => getPlaybackCommands().seekBy(1, details.seekOffset)); });
  });
}

function initializeTaskbarControls() {
  let disposed = false;
  let unlisten: Unlisten | null = null;
  let lastReported: boolean | null = null;
  let reports: Promise<void | null | undefined> = Promise.resolve();
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

  const stopListening = (stop: Unlisten) => {
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
      void getPlaybackCommands().togglePlayPause();
    } else if (payload === "previous") {
      getPlaybackCommands().previous();
    } else if (payload === "next") {
      getPlaybackCommands().next();
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
  let unlisten: Unlisten | null = null;

  const stopListening = (stop: Unlisten) => {
    Promise.resolve(stop()).catch((error) => {
      console.warn("[shortcut] event cleanup failed:", error);
    });
  };

  window.__TAURI__.event.listen("global-shortcut", ({ payload }) => {
    if (disposed) return;
    if (payload === "previous") {
      getPlaybackCommands().previous();
    } else if (payload === "play_pause") {
      window.recordPlaybackDiag?.("external-control", "global shortcut play_pause");
      void getPlaybackCommands().togglePlayPause();
    } else if (payload === "next") {
      getPlaybackCommands().next();
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

function syncImmersiveTrack() {
  const currentTrack = getApplicationStore().getState().playbackDisplay.currentTrack;
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
  const currentTrack = getApplicationStore().getState().playbackDisplay.currentTrack;
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
  for (const tile of mascotPicker?.querySelectorAll<HTMLButtonElement>(".mascot-tile") ?? []) {
    const selected = tile.dataset.mascotId === activeId;
    tile.classList.toggle("is-selected", selected);
    tile.setAttribute("aria-pressed", String(selected));
  }
}

function renderMascotPicker() {
  const mascotApi = window.BiliMascot;
  if (!mascotPicker || !mascotApi) {
    return;
  }
  mascotPicker.textContent = "";
  for (const mascot of mascotApi.list()) {
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
      mascotApi.setActive(mascot.id);
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
    mascotApi.setActive("none");
    syncMascotPickerSelection();
  });
  mascotPicker.append(noneTile);

  syncMascotPickerSelection();
}

function openSettings() {
  prepareSettingsPanel(settingsDom());
  restoreStreamSource();
  restoreAudioCacheSettings();
  refreshAudioCacheUsage();
  const { order, limit } = readShuffleCollectionPrefs();
  getSettingsActions().restoreCollection(order, limit === 0 ? "all" : String(limit));
  restoreAiConfig();
  renderMascotPicker();
  getSettingsActions().panel(true);
}

async function restoreAudioCacheSettings() { await getSettingsActions().restoreCache(); }

async function refreshAudioCacheUsage() { await getSettingsActions().refreshCacheUsage(); }

async function saveAudioCacheSettings() { await getSettingsActions().saveCache(audioCacheEnabled.checked, Number(audioCacheCapacity.value)); }

function closeSettings() { getSettingsActions().panel(false); }

function setActiveView(view: string) {
  getSettingsActions().navigate(view);
  window.dispatchEvent(new CustomEvent("bilibili-music-viewchange", { detail: { view } }));
}

function readAccentColor() {
  try {
    return normalizeSettingsAccent(readSettingsPreference(ACCENT_COLOR_KEY));
  } catch {
    return "pink";
  }
}

function applyAccentColor(value: unknown, persist = true) { getSettingsActions().setAccent(value, root.dataset.theme, persist); }

function initializeAccentColor() {
  for (const option of accentColorOptions) {
    option.addEventListener("change", () => applyAccentColor(option.value));
  }
  applyAccentColor(readAccentColor(), false);
  // data-theme 的变更在下一次绘制前同步变体，不改主题切换与动态背景逻辑。
  new MutationObserver(() => applyAccentColor(getSettingsSnapshot().accentColor, false))
    .observe(root, { attributes: true, attributeFilter: ["data-theme"] });
}

function applyTheme(theme: string | null, persist = true) { getSettingsActions().setTheme(theme, persist); }

function setGlassBlur(value: unknown, persist = true) { getSettingsActions().setSlider("blur", value, persist); }

function setPanelAlpha(value: unknown, persist = true) { getSettingsActions().setSlider("alpha", value, persist); }

function setBackgroundDim(value: unknown, persist = true) { getSettingsActions().setSlider("dim", value, persist); }

function resetBackground({ clearStorage = true } = {}) { getSettingsActions().resetBackground({ clearStorage }); }

async function restoreBackground() { await getSettingsActions().restoreBackground(); }

async function restoreStreamSource() { if (streamSourceSelect) await getSettingsActions().restoreSource(); }




function updateAiBaseUrlPlaceholder() { if (aiBaseUrlInput && aiApiFormatSelect) getSettingsActions().setAiFormat(aiApiFormatSelect.value); }

function selectedAiApiFormat() {
  return aiApiFormatSelect?.value ?? "openai-chat-completions";
}

async function restoreAiConfig() {
  if (!aiApiFormatSelect || !aiBaseUrlInput || !aiModelInput || !aiApiKeyInput || !aiConfigStatus) return;
  await getSettingsActions().restoreAi();
}

async function saveAiConfig() {
  if (!aiApiFormatSelect || !aiBaseUrlInput || !aiModelInput || !aiApiKeyInput || !saveAiConfigButton || !aiConfigStatus) return;
  const input = () => ({ apiFormat: selectedAiApiFormat(), baseUrl: aiBaseUrlInput.value, model: aiModelInput.value, apiKey: aiApiKeyInput.value });
  await getSettingsActions().saveAi(input(), input, () => window.dispatchEvent(new Event("ai-config-updated")));
}

async function testAiConnection() {
  if (!testAiConnectionButton || !aiConfigStatus || !aiApiFormatSelect || !aiBaseUrlInput || !aiModelInput || !aiApiKeyInput) return;
  await getSettingsActions().testAi({ apiFormat: selectedAiApiFormat(), baseUrl: aiBaseUrlInput.value, model: aiModelInput.value, apiKey: aiApiKeyInput.value });
}

async function openCurrentBilibiliVideo() {
  const currentTrack = getApplicationStore().getState().playbackDisplay.currentTrack;
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

function applyVolume(value: unknown, persist = true) {
  const safeValue = clampNumber(value, 0, 1, 1);
  if (normalizationAnimationFrame !== null) {
    cancelAnimationFrame(normalizationAnimationFrame);
    normalizationAnimationFrame = null;
  }
  getPlaybackSettingsActions().setUserVolume(safeValue);
  if (persist) {
    localStorage.setItem(VOLUME_KEY, String(safeValue));
  }
}

function adjustVolumeByStep(direction: number) {
  const nextVolume = Math.min(
    1,
    Math.max(0, getPlaybackSettingsSnapshot().userVolume + direction * GLOBAL_SHORTCUT_VOLUME_STEP),
  );
  applyVolume(nextVolume);
}

function updateEffectiveVolume(volume: number) {
  getPlaybackMedia().setVolume(volume);
}

function setNormalizationGain(gain: unknown) {
  if (normalizationAnimationFrame !== null) {
    cancelAnimationFrame(normalizationAnimationFrame);
    normalizationAnimationFrame = null;
  }
  const startVolume = getPlaybackMedia().getVolume();
  getPlaybackSettingsActions().setGain(gain);
  const targetVolume = effectivePlaybackVolume(getPlaybackSettingsSnapshot());
  if (startVolume === targetVolume) return;

  let startedAt: number | null = null;
  const step = (now: number) => {
    startedAt ??= now;
    const progress = Math.min(1, (now - startedAt) / 250);
    getPlaybackSettingsActions().applyEffectiveVolume(startVolume + (targetVolume - startVolume) * progress);
    if (progress < 1) {
      normalizationAnimationFrame = requestAnimationFrame(step);
    } else {
      normalizationAnimationFrame = null;
    }
  };
  normalizationAnimationFrame = requestAnimationFrame(step);
}

function isLoudnessNormalizationEnabled() {
  return getPlaybackSettingsSnapshot().normalizationEnabled;
}

function applyLoudnessNormalization(enabled: unknown, persist = true) {
  getPlaybackSettingsActions().setNormalizationEnabled(enabled);
  setNormalizationGain(1);
  if (persist) {
    try {
      localStorage.setItem(LOUDNESS_NORMALIZATION_KEY, String(isLoudnessNormalizationEnabled()));
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

function getPlaybackSettingsActions() {
  const store = getApplicationStore();
  if (!playbackSettingsMounted) {
    playbackSettingsMounted = true;
    let previous: ReturnType<typeof store.getState>["playbackSettings"] | null = null;
    const render = () => {
      const state = store.getState().playbackSettings;
      renderPlaybackSettingsSnapshot(state, previous, {
        setMediaVolume: volume => updateEffectiveVolume(volume),
        setVolumeControl: volume => {
          volumeSlider.value = String(volume);
          updateRangeProgress(volumeSlider, `${volume * 100}%`);
        },
        setNormalizationControl: enabled => { loudnessNormalizationToggle.checked = enabled; },
      });
      previous = state;
    };
    store.subscribe(render);
    render();
  }
  return store.actions.playbackSettings;
}

function getPlaybackSettingsSnapshot() {
  getPlaybackSettingsActions();
  return getApplicationStore().getState().playbackSettings;
}

function getPlaybackMedia() {
  return playbackSettingsMedia ??= createMediaAdapter(playerAudio);
}

function startAppearance() {
for (const item of navItems) {
  item.addEventListener("click", () => setActiveView(item.dataset.view));
}

openSettingsButton.addEventListener("click", openSettings);
closeSettingsButton.addEventListener("click", closeSettings);
settingsModal.addEventListener("transitionend", (event) => finishSettingsPanelTransition(event, settingsDom()));
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

chooseBackgroundButton.addEventListener("click", async () => { await getSettingsActions().chooseBackground(); });

resetBackgroundButton.addEventListener("click", () => resetBackground());
saveAiConfigButton?.addEventListener("click", saveAiConfig);
testAiConnectionButton?.addEventListener("click", testAiConnection);
aiApiFormatSelect?.addEventListener("change", updateAiBaseUrlPlaceholder);

streamSourceSelect?.addEventListener("change", async () => { await getSettingsActions().changeSource(streamSourceSelect.value); });

audioCacheEnabled?.addEventListener("change", saveAudioCacheSettings);
audioCacheCapacity?.addEventListener("change", saveAudioCacheSettings);
for (const [select, key] of [
  [shuffleCollectionOrder, SHUFFLE_COLLECTION_ORDER_KEY],
  [shuffleCollectionLimit, SHUFFLE_COLLECTION_LIMIT_KEY],
] as [HTMLSelectElement, string][]) {
  select.addEventListener("change", () => {
    getSettingsActions().saveCollection(key === SHUFFLE_COLLECTION_ORDER_KEY ? "order" : "limit", select.value);
  });
}
clearAudioCacheButton?.addEventListener("click", async () => { await getSettingsActions().clearCache(); });
window.addEventListener("bilibili-music-audio-cache-updated", () => {
  if (settingsModal.classList.contains("is-open")) refreshAudioCacheUsage();
});

clearSearchHistoryButton?.addEventListener("click", async () => {
  clearSearchHistoryButton.disabled = true;
  getSettingsActions().setNotice("正在清空搜索历史…");
  try {
    await invokeAppearance("clear_search_history");
    getSettingsActions().setNotice("搜索历史已清空。");
  } catch (error) {
    getSettingsActions().setNotice(`清空搜索历史失败：${error}`);
  } finally {
    clearSearchHistoryButton.disabled = false;
  }
});

exportDataButton.addEventListener("click", async () => {
  exportDataButton.disabled = true;
  try {
    const saved = await invokeAppearance("export_data");
    getSettingsActions().setNotice(saved ? `已导出到：${saved}` : "");
  } catch (error) {
    getSettingsActions().setNotice(`导出失败：${error}`);
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
      try { sessionStorage.setItem("bili-music-import-result", result); } catch {}
      getSettingsActions().setNotice(`${result} 正在刷新…`);
      window.location.reload();
      return;
    }
    getSettingsActions().setNotice("");
  } catch (error) {
    getSettingsActions().setNotice(String(error));
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
immersivePlayer.addEventListener("click", (event: MouseEvent) => {
  if ((event.target as HTMLElement).dataset.closeImmersive === "true") {
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
  getApplicationStore().actions.playbackDisplay.setCurrentTrack(event.detail);
  syncImmersiveTrack();
  syncMediaSessionTrack(event.detail);
});

playPauseButton.addEventListener("click", () => { void getPlaybackCommands().togglePlayPause(); });

immersivePlayPauseButton.addEventListener("click", () => {
  window.recordPlaybackDiag?.("external-control", "immersive button");
  void getPlaybackCommands().togglePlayPause();
});
immersivePreviousButton.addEventListener("click", () => getPlaybackCommands().previous());
immersiveNextButton.addEventListener("click", () => getPlaybackCommands().next());
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
  getPlaybackDisplayActions().setSeeking(true);
});
immersiveProgressSlider.addEventListener("pointerdown", () => {
  getPlaybackDisplayActions().setSeeking(true);
});

progressSlider.addEventListener("input", () => {
  getPlaybackDisplayActions().setSeeking(true);
  updateProgress(Number(progressSlider.value));
});
immersiveProgressSlider.addEventListener("input", () => {
  getPlaybackDisplayActions().setSeeking(true);
  updateProgress(Number(immersiveProgressSlider.value));
});

progressSlider.addEventListener("change", () => { getPlaybackCommands().seekSlider(Number(progressSlider.value)); });
immersiveProgressSlider.addEventListener("change", () => { getPlaybackCommands().seekSlider(Number(immersiveProgressSlider.value)); });

getPlaybackMedia().subscribe("timeupdate", () => {
  if (!getPlaybackDisplaySnapshot().isSeeking) {
    updateProgress();
    syncMediaSessionPosition();
  } else {
    getPlaybackDisplayActions().observeMedia(getPlaybackMedia().getObservation());
  }
});
getPlaybackMedia().subscribe("durationchange", () => {
  updateProgress();
  syncMediaSessionPosition();
});
getPlaybackMedia().subscribe("loadedmetadata", () => {
  updateProgress();
  syncMediaSessionPosition();
});
getPlaybackMedia().subscribe("play", () => {
  updatePlayPauseButton();
  syncMediaSessionPlaybackState("playing");
});
getPlaybackMedia().subscribe("pause", () => {
  updatePlayPauseButton();
  syncMediaSessionPlaybackState("paused");
});
getPlaybackMedia().subscribe("ended", () => {
  updatePlayPauseButton();
  syncMediaSessionPlaybackState("none");
});
getPlaybackMedia().subscribe("emptied", () => {
  getPlaybackDisplayActions().setSeeking(false);
  updateProgress(0);
  updatePlayPauseButton();
  syncMediaSessionPlaybackState("none");
});

initializeAccentColor();
initializeShortcutSettings();
applyTheme(readSettingsPreference(THEME_KEY), false);
applyVolume(localStorage.getItem(VOLUME_KEY), false);
initializeLoudnessNormalization();
updateProgress(0);
updatePlayPauseButton();
syncImmersiveTrack();
registerMediaSessionActionHandlers();
initializeTaskbarControls();
initializeGlobalShortcutControls();
void restoreBackground().finally(() => {
  try {
    const importResult = sessionStorage.getItem("bili-music-import-result");
    if (importResult) {
      sessionStorage.removeItem("bili-music-import-result");
      getSettingsActions().setNotice(importResult);
    }
  } catch {}
});
restoreStreamSource();
}

export { getPlaybackCommands, isLoudnessNormalizationEnabled, setNormalizationGain, startAppearance };

export type { SettingsDom };
