const { invoke: invokeAppearance } = window.__TAURI__.core;

const BACKGROUND_PATH_KEY = "bilibili-music.background-path";
const THEME_KEY = "bilibili-music.theme";
const GLASS_BLUR_KEY = "bilibili-music.glass-blur";
const PANEL_ALPHA_KEY = "bilibili-music.panel-alpha";
const BACKGROUND_DIM_KEY = "bilibili-music.background-dim";
const VOLUME_KEY = "bilibili-music.volume";

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
const clearSearchHistoryButton = document.querySelector("#clear-search-history-button");
const exportDataButton = document.querySelector("#export-data-button");
const importDataButton = document.querySelector("#import-data-button");
const aiBaseUrlInput = document.querySelector("#ai-base-url-input");
const aiModelInput = document.querySelector("#ai-model-input");
const aiApiKeyInput = document.querySelector("#ai-api-key-input");
const saveAiConfigButton = document.querySelector("#save-ai-config-button");
const testAiConnectionButton = document.querySelector("#test-ai-connection-button");
const aiConfigStatus = document.querySelector("#ai-config-status");

const playerAudio = document.querySelector("#audio");
const playPauseButton = document.querySelector("#play-pause-button");
const progressSlider = document.querySelector("#progress-slider");
const currentTimeLabel = document.querySelector("#current-time");
const durationLabel = document.querySelector("#duration");
const playbackStatus = document.querySelector("#status");
const openImmersiveButton = document.querySelector("#open-immersive-button");
const openImmersiveIconButton = document.querySelector("#open-immersive-icon-button");
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
const previousButtonForImmersive = document.querySelector("#previous-button");
const nextButtonForImmersive = document.querySelector("#next-button");
const volumeSlider = document.querySelector("#volume-slider");

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

function registerMediaSessionActionHandlers() {
  withMediaSession((mediaSession) => {
    mediaSession.setActionHandler("play", () => playPauseButton.click());
    mediaSession.setActionHandler("pause", () => playPauseButton.click());
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

function syncImmersiveTrack(track = currentTrack) {
  currentTrack = {
    ...currentTrack,
    ...track,
  };
  immersiveTitle.textContent = currentTrack.title || "尚未播放";
  immersiveUploader.textContent = currentTrack.uploader || "—";
  openBilibiliButton.disabled = !currentTrack.bvid;
  openBilibiliBarButton.disabled = !currentTrack.bvid;
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
  restoreAiConfig();
  renderMascotPicker();
  requestAnimationFrame(() => {
    settingsModal.classList.add("is-open");
    settingsModal.setAttribute("aria-hidden", "false");
  });
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

function applyTheme(theme, persist = true) {
  const safeTheme = ["dark", "light", "image"].includes(theme) ? theme : "dark";
  root.dataset.theme = safeTheme;
  for (const option of themeOptions) {
    const selected = option.dataset.themeOption === safeTheme;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-checked", String(selected));
  }
  for (const group of imageOnlyGroups) {
    group.classList.toggle("is-disabled", safeTheme !== "image");
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
  const safeValue = clampNumber(value, 20, 100, 72);
  root.style.setProperty("--panel-alpha", String(safeValue / 100));
  panelAlphaSlider.value = String(safeValue);
  panelAlphaValue.textContent = `${safeValue}%`;
  if (persist) {
    localStorage.setItem(PANEL_ALPHA_KEY, String(safeValue));
  }
}

function setBackgroundDim(value, persist = true) {
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
  aiConfigStatus.textContent = "正在保存 AI 配置…";
  try {
    const config = await invokeAppearance("set_ai_config", {
      baseUrl: aiBaseUrlInput.value,
      model: aiModelInput.value,
      apiKey: aiApiKeyInput.value,
    });
    aiApiKeyInput.value = "";
    updateAiConfigStatus(config);
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
  playerAudio.volume = safeValue;
  volumeSlider.value = String(safeValue);
  updateRangeProgress(volumeSlider, `${safeValue * 100}%`);
  if (persist) {
    localStorage.setItem(VOLUME_KEY, String(safeValue));
  }
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
openImmersiveIconButton.addEventListener("click", openImmersive);
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
    playbackStatus.textContent = "请先从队列中选择一首歌曲。";
    return;
  }
  if (playerAudio.paused) {
    try {
      await playerAudio.play();
    } catch {
      playbackStatus.textContent = "音频暂时无法播放，请稍后重试。";
    }
  } else {
    playerAudio.pause();
  }
});
immersivePlayPauseButton.addEventListener("click", () => playPauseButton.click());
immersivePreviousButton.addEventListener("click", () => previousButtonForImmersive.click());
immersiveNextButton.addEventListener("click", () => nextButtonForImmersive.click());
openBilibiliButton.addEventListener("click", openCurrentBilibiliVideo);
openBilibiliBarButton.addEventListener("click", openCurrentBilibiliVideo);
volumeSlider.addEventListener("input", () => applyVolume(volumeSlider.value));

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

applyTheme(localStorage.getItem(THEME_KEY), false);
setGlassBlur(localStorage.getItem(GLASS_BLUR_KEY), false);
setPanelAlpha(localStorage.getItem(PANEL_ALPHA_KEY), false);
setBackgroundDim(localStorage.getItem(BACKGROUND_DIM_KEY), false);
applyVolume(localStorage.getItem(VOLUME_KEY), false);
updateProgress(0);
updatePlayPauseButton();
syncImmersiveTrack();
registerMediaSessionActionHandlers();
restoreBackground();
restoreStreamSource();
