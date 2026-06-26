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
    return "当前：强制游客";
  }
  if (source === "yt-dlp") {
    return "当前：强制 yt-dlp";
  }
  return "当前：自动（游客优先 + yt-dlp 兜底）";
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

function openSettings() {
  settingsModal.hidden = false;
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
    const source = await invokeAppearance("get_stream_source");
    streamSourceSelect.value = source;
    streamSourceStatus.textContent = streamSourceLabel(source);
  } catch (error) {
    streamSourceStatus.textContent = `取流方案读取失败：${error}`;
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

streamSourceSelect?.addEventListener("change", async () => {
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
  }
});
playerAudio.addEventListener("durationchange", () => updateProgress());
playerAudio.addEventListener("loadedmetadata", () => updateProgress());
playerAudio.addEventListener("play", updatePlayPauseButton);
playerAudio.addEventListener("pause", updatePlayPauseButton);
playerAudio.addEventListener("ended", updatePlayPauseButton);
playerAudio.addEventListener("emptied", () => {
  isSeeking = false;
  updateProgress(0);
  updatePlayPauseButton();
});

applyTheme(localStorage.getItem(THEME_KEY), false);
setGlassBlur(localStorage.getItem(GLASS_BLUR_KEY), false);
setPanelAlpha(localStorage.getItem(PANEL_ALPHA_KEY), false);
setBackgroundDim(localStorage.getItem(BACKGROUND_DIM_KEY), false);
applyVolume(localStorage.getItem(VOLUME_KEY), false);
updateProgress(0);
updatePlayPauseButton();
syncImmersiveTrack();
restoreBackground();
restoreStreamSource();
