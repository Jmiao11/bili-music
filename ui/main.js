const { invoke } = window.__TAURI__.core;

const LOOP_MODES = [
  { id: "sequence", label: "顺序播放" },
  { id: "list", label: "列表循环" },
  { id: "single", label: "单曲循环" },
];
const MAX_CONSECUTIVE_RESOLVE_FAILURES = 5;
const MAX_AUDIO_RECOVERIES = 2;
const SKIP_NOTICE_DURATION_MS = 3200;
const SEARCH_PAGE_SIZE = 20;
const LOAD_MORE_THRESHOLD_PX = 96;
const DEFAULT_MUSIC_TIDS = 3;
const MUSIC_HOT_KEYWORD = "音乐";
const PLAYBACK_STATE_SAVE_INTERVAL_MS = 15_000;

const playerState = {
  queue: [],
  queueSource: "none",
  queueSearchVersion: null,
  queuePlaylistId: null,
  currentIndex: -1,
  loopMode: "sequence",
  shuffle: false,
  randomRemaining: [],
  history: [],
  requestVersion: 0,
  activeAudioVersion: -1,
  activeAudioUrl: "",
  audioActivatedAt: Number.POSITIVE_INFINITY,
  consecutiveResolveFailures: 0,
  currentPages: [],
  currentPageIndex: 0,
  currentDisplayTrack: null,
};
let randomPageRound = null;
let playRecordedForCurrentTrack = false;
let cacheRequestedForCurrentTrack = false;
let cacheRequestPromise = null;
let pendingResume = null;
let resumeInProgress = false;
let lastPlaybackStateSavedAt = Number.NEGATIVE_INFINITY;
let recoveryPromise = null;
let recoveryVersion = -1;
let recoveryAttempts = 0;
let playingAudioVersion = -1;
let playbackIntended = false;

const searchState = {
  results: [],
  userKeyword: "",
  requestKeyword: "",
  tids: DEFAULT_MUSIC_TIDS,
  order: null,
  rerank: true,
  sortMode: "all",
  page: 0,
  isLoadingMore: false,
  hasMore: false,
  requestVersion: 0,
};

const LAST_SEARCH_KEY = "bilibili-music.last-search";
let pendingSearchRestore = null;

function readLastSearchKeyword() {
  try {
    const value = localStorage.getItem(LAST_SEARCH_KEY);
    return typeof value === "string" ? value.trim().slice(0, 100) : "";
  } catch {
    return "";
  }
}

function saveLastSearchKeyword(keyword) {
  try {
    localStorage.setItem(LAST_SEARCH_KEY, keyword);
  } catch (error) {
    console.warn("last search keyword save failed:", error);
  }
}

const homeState = {
  mode: "recommendation",
  ranking: [],
  recommendations: [],
  loaded: false,
  loading: false,
  error: "",
  recommendationLoaded: false,
  recommendationLoading: false,
  recommendationError: "",
  userHint: "",
  aiHasKey: null,
};

const libraryState = {
  favorites: [],
  favoriteBvids: new Set(),
  playlists: [],
  unavailableBvids: new Map(),
  disabledPages: new Map(),
  disabledPagePending: new Map(),
  selectedPlaylistId: "",
  loadError: "",
};

const favoriteDragState = {
  drag: null,
  saving: false,
  suppressClickUntil: 0,
};

const playlistDragState = {
  drag: null,
  saving: false,
  suppressClickUntil: 0,
};

const playlistListDragState = {
  drag: null,
  saving: false,
  suppressClickUntil: 0,
};

const videoPageCounts = new Map();
const videoPagesByBvid = new Map();
const pageModalOpeners = new WeakMap();
const failedPageCountBvids = new Set();
const queuedPageCountBvids = new Set();
const activePageCountBvids = new Set();
const observedPageCountTargets = new Map();
const visiblePageCountTargets = new Map();
const pageCountLookupQueue = [];
const PAGE_COUNT_LOOKUP_CONCURRENCY = 2;
const PAGE_COUNT_LOOKUP_INTERVAL_MS = 300;
let pageCountObserver;
let activePageCountLookups = 0;
let lastPageCountLookupStartedAt = Number.NEGATIVE_INFINITY;
let pageCountLookupTimer = null;
const pendingPageCacheTargets = new Map();
let pageCacheLookupScheduled = false;
let pagesMetaRequestVersion = 0;
let pagesMetaStatusBeforeLoad = null;
let pagesModalContext = null;
let pagesModalReturnFocus = null;
let pendingPastedBvPages = null;

const searchForm = document.querySelector("#search-form");
const searchKeyword = document.querySelector("#search-keyword");
const searchButton = document.querySelector("#search-button");
const musicTabs = [...document.querySelectorAll(".music-tab[data-tids]")];
const sortModeTabs = [...document.querySelectorAll(".music-tab[data-sort-mode]")];
const searchStatus = document.querySelector("#search-status");
const playbackNotice = document.querySelector("#playback-notice");
const searchResults = document.querySelector("#search-results");
const homePanel = document.querySelector("#view-home");
const homeModeTabs = [...document.querySelectorAll(".home-mode-tab[data-home-mode]")];
const homeSourceLabel = document.querySelector("#home-source-label");
const homeTitle = document.querySelector("#home-title");
const homeSubtitle = homePanel?.querySelector(".home-subtitle");
const homeCacheNote = document.querySelector("#home-cache-note");
const homeListLabel = document.querySelector("#home-list-label");
const homeRankingStatus = document.querySelector("#home-ranking-status");
const homeRankingError = document.querySelector("#home-ranking-error");
const homeRankingList = document.querySelector("#home-ranking-list");
const homeSetupHint = document.querySelector("#home-setup-hint");
const homeSetupTitle = document.querySelector("#home-setup-title");
const homeSetupSub = document.querySelector("#home-setup-sub");
const homeSetupSettings = document.querySelector("#home-setup-settings");
const refreshRankingButton = document.querySelector("#refresh-ranking-button");
const homeHintRow = document.querySelector("#home-hint-row");
const homeHintInput = document.querySelector("#home-hint-input");
const homeHintApply = document.querySelector("#home-hint-apply");
const queueCount = document.querySelector("#queue-count");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const thumbnail = document.querySelector("#thumbnail");
const title = document.querySelector("#title");
const uploader = document.querySelector("#uploader");
const duration = document.querySelector("#duration");
const queuePosition = document.querySelector("#queue-position");
const playerPagesButton = document.querySelector("#player-pages-button");
const playerPagesGroup = document.querySelector(".player-pages-group");
const skipVideoButton = document.querySelector("#skip-video-button");
const previousButton = document.querySelector("#previous-button");
const nextButton = document.querySelector("#next-button");
const loopModeButton = document.querySelector("#loop-mode-button");
const shuffleToggle = document.querySelector("#shuffle-toggle");
const audio = document.querySelector("#audio");
window.__playbackDiagLog = [];
window.recordPlaybackDiag = (category, message) => {
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    message,
    paused: audio.paused,
    currentTime: audio.currentTime,
    readyState: audio.readyState,
    networkState: audio.networkState,
    currentSrcTail: audio.currentSrc.slice(-8),
  };
  window.__playbackDiagLog.push(entry);
  if (window.__playbackDiagLog.length > 300) window.__playbackDiagLog.shift();
  console.info("[playback-diag]", entry);
};
const resumePlayPauseButton = document.querySelector("#play-pause-button");
const resumeProgressSlider = document.querySelector("#progress-slider");
const resumeCurrentTimeLabel = document.querySelector("#current-time");
const immersiveResumeProgressSlider = document.querySelector("#immersive-progress-slider");
const immersiveResumeCurrentTimeLabel = document.querySelector("#immersive-current-time");
const immersiveResumeDurationLabel = document.querySelector("#immersive-duration");
const favoritesStatus = document.querySelector("#favorites-status");
const favoritesCount = document.querySelector("#favorites-count");
const favoritesList = document.querySelector("#favorites-list");
const playlistsStatus = document.querySelector("#playlists-status");
const playlistsList = document.querySelector("#playlists-list");
const playlistTitle = document.querySelector("#playlist-title");
const playlistMeta = document.querySelector("#playlist-meta");
const playlistTracks = document.querySelector("#playlist-tracks");
const playlistActions = document.querySelector("#playlist-actions");
const createPlaylistButton = document.querySelector("#create-playlist-button");
const renamePlaylistButton = document.querySelector("#rename-playlist-button");
const deletePlaylistButton = document.querySelector("#delete-playlist-button");
const favoriteCurrentButton = document.querySelector("#favorite-current-button");
const immersiveFavoriteButton = document.querySelector("#immersive-favorite-button");
const libraryModal = document.querySelector("#library-modal");
const closeLibraryModalButton = document.querySelector("#close-library-modal-button");
const libraryModalTitle = document.querySelector("#library-modal-title");
const libraryModalSubtitle = document.querySelector("#library-modal-subtitle");
const libraryModalBody = document.querySelector("#library-modal-body");
const libraryModalStatus = document.querySelector("#library-modal-status");
const purgeUnavailableTracksButton = document.querySelector("#purge-unavailable-tracks-button");
const purgeAppearanceStatus = document.querySelector("#appearance-status");
const pagesModal = document.querySelector("#pages-modal");
const pagesModalTitle = document.querySelector("#pages-modal-title");
const pagesModalSub = document.querySelector("#pages-modal-sub");
const pagesModalRestoreAll = document.querySelector("#pages-modal-restore-all");
const pagesModalStatus = document.querySelector("#pages-modal-status");
const pagesModalList = document.querySelector("#pages-modal-list");
const pagesModalClose = document.querySelector("#pages-modal-close");
let playbackNoticeTimer = null;

function currentTrackSnapshot() {
  if (
    playerState.currentDisplayTrack &&
    playerState.currentPages.length > 1 &&
    playerState.currentIndex >= 0 &&
    playerState.currentIndex < playerState.queue.length
  ) {
    return {
      ...playerState.currentDisplayTrack,
      hasCurrent: true,
    };
  }

  const video = playerState.queue[playerState.currentIndex];
  return {
    bvid: video?.bvid ?? "",
    title: video?.title ?? "尚未播放",
    uploader: video?.uploader ?? "—",
    thumbnailUrl: displayThumbnailUrl(video?.thumbnailUrl ?? ""),
    durationSeconds: Number(video?.durationSeconds) || 0,
    hasCurrent:
      playerState.currentIndex >= 0 &&
      playerState.currentIndex < playerState.queue.length,
  };
}

function currentPlayableTrack() {
  if (
    playerState.currentIndex < 0 ||
    playerState.currentIndex >= playerState.queue.length
  ) {
    return null;
  }
  const track = normalizeTrack(playerState.queue[playerState.currentIndex]);
  return track.bvid ? track : null;
}

function resetCurrentPageState() {
  playerState.currentPages = [];
  playerState.currentPageIndex = 0;
  playerState.currentDisplayTrack = null;
  updatePlayerPagesButton();
}

function hasMultipleCurrentPages() {
  return playerState.currentPages.length > 1;
}

function currentVideoPage() {
  if (!hasMultipleCurrentPages()) {
    return null;
  }
  return playerState.currentPages[playerState.currentPageIndex] ?? null;
}

function currentAudioCacheCid() {
  return currentVideoPage()?.cid ?? playerState.currentPages[0]?.cid ?? null;
}

function updatePlayerPagesButton() {
  const pageCount = playerState.currentPages.length;
  const hasCurrent =
    playerState.currentIndex >= 0 &&
    playerState.currentIndex < playerState.queue.length;
  playerPagesButton.hidden = !hasCurrent || pageCount <= 1;
  if (!playerPagesButton.hidden) {
    const currentPage = Math.min(playerState.currentPageIndex + 1, pageCount);
    playerPagesButton.textContent = `P${currentPage}/${pageCount}`;
    playerPagesButton.title = "查看分P";
    playerPagesButton.setAttribute(
      "aria-label",
      `查看分P，当前第 ${currentPage} 个，共 ${pageCount} 个`,
    );
  }
  playerPagesGroup.hidden = playerPagesButton.hidden;
}

async function loadPagesForCurrentVideo(video, requestVersion) {
  resetCurrentPageState();
  try {
    const pages = await invoke("get_video_pages", { bvId: video.bvid });
    if (requestVersion !== playerState.requestVersion) {
      return false;
    }
    playerState.currentPages = (Array.isArray(pages) ? pages : [])
      .map(normalizeVideoPage)
      .filter((page) => page.cid > 0);
    playerState.currentPageIndex = 0;
    updatePlayerPagesButton();
  } catch (error) {
    if (requestVersion === playerState.requestVersion) {
      console.warn(`get_video_pages failed for ${video.bvid}; treating as single-P:`, error);
      resetCurrentPageState();
      showPlaybackNotice("分P列表获取失败，暂按单个视频播放。");
    }
  }
  return requestVersion === playerState.requestVersion;
}

function emitCurrentTrackChanged() {
  playRecordedForCurrentTrack = false;
  loudnessAnalyzedForCurrentTrack = false;
  cacheRequestedForCurrentTrack = false;
  cacheRequestPromise = null;
  const snapshot = currentTrackSnapshot();
  window.dispatchEvent(
    new CustomEvent("bilibili-music-trackchange", {
      detail: snapshot,
    }),
  );
}

function clearPlaybackNotice() {
  if (playbackNoticeTimer !== null) {
    clearTimeout(playbackNoticeTimer);
    playbackNoticeTimer = null;
  }
  playbackNotice.classList.remove("is-visible");
  playbackNotice.textContent = "";
  window.dispatchEvent(new Event("bilibili-music-notice-change"));
}

function positionPlaybackNotice() {
  const pauseButton = resumePlayPauseButton.getBoundingClientRect();
  playbackNotice.style.setProperty("--playback-notice-x", `${pauseButton.left + pauseButton.width / 2}px`);
}

positionPlaybackNotice();
new ResizeObserver(positionPlaybackNotice).observe(result);

function showPlaybackNotice(message, { persistent = false, kind = "error" } = {}) {
  positionPlaybackNotice();
  if (kind === "info" && playbackNotice.classList.contains("is-visible") &&
      playbackNotice.dataset.kind === "error") return;
  if (playbackNoticeTimer !== null) {
    clearTimeout(playbackNoticeTimer);
    playbackNoticeTimer = null;
  }
  playbackNotice.dataset.kind = kind;
  playbackNotice.textContent = message;
  playbackNotice.classList.add("is-visible");
  window.dispatchEvent(new Event("bilibili-music-notice-change"));
  if (!persistent) {
    playbackNoticeTimer = window.setTimeout(clearPlaybackNotice,
      kind === "info" ? 2000 : SKIP_NOTICE_DURATION_MS);
  }
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function resetRandomRemaining() {
  playerState.randomRemaining = shuffled(
    playerState.queue
      .map((_, index) => index)
      .filter((index) => index !== playerState.currentIndex),
  );
}

function addNewIndexesToRandomRemaining(startIndex, count) {
  if (!playerState.shuffle || count <= 0) {
    return;
  }
  const newIndexes = Array.from({ length: count }, (_, offset) => startIndex + offset)
    .filter((index) => index !== playerState.currentIndex);
  playerState.randomRemaining.push(...shuffled(newIndexes));
}

function markRandomIndexPlayed(index) {
  playerState.randomRemaining = playerState.randomRemaining.filter(
    (candidate) => candidate !== index,
  );
}

function stopAudioElement() {
  window.recordPlaybackDiag("stopAudioElement", String(new Error().stack ?? "").split("\n").slice(1, 5).join(" | "));
  playerState.activeAudioVersion = -1;
  playerState.activeAudioUrl = "";
  playerState.audioActivatedAt = Number.POSITIVE_INFINITY;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

async function cancelCurrentPlayback() {
  playerState.requestVersion += 1;
  stopAudioElement();
  searchButton.disabled = false;
  try {
    await invoke("cancel_prepare_audio");
  } catch {
    // There may be no active resolver to cancel.
  }
}

function clearPendingResume() {
  pendingResume = null;
  resumeInProgress = false;
}

function savePlaybackState() {
  lastPlaybackStateSavedAt = Date.now();
  if (playerState.queue.length === 0) {
    invoke("clear_playback_state").catch((error) => {
      console.warn("clear playback state failed:", error);
    });
    return;
  }

  const page = currentVideoPage();
  const resume = pendingResume;
  const currentTime = Number(audio.currentTime);
  invoke("save_playback_state", {
    state: {
      version: 1,
      queue: playerState.queue.map(playbackTrackSnapshot),
      currentIndex: Math.max(
        0,
        Math.min(playerState.currentIndex, playerState.queue.length - 1),
      ),
      positionSeconds: resume?.positionSeconds ??
        (Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0),
      page: resume?.page ?? page?.page ?? null,
      cid: resume?.cid ?? page?.cid ?? null,
      savedAt: Math.floor(Date.now() / 1000),
    },
  }).catch((error) => {
    console.warn("save playback state failed:", error);
  });
}

function renderRestoredPlaybackUi(track, positionSeconds) {
  const totalSeconds = Math.max(0, Number(track.durationSeconds) || 0);
  const safePosition = Math.max(
    0,
    Math.min(Number(positionSeconds) || 0, totalSeconds || Number(positionSeconds) || 0),
  );
  const sliderMax = Math.max(totalSeconds, safePosition);
  const progress = `${sliderMax > 0 ? (safePosition / sliderMax) * 100 : 0}%`;

  thumbnail.src = displayThumbnailUrl(track.thumbnailUrl);
  title.textContent = track.title;
  uploader.textContent = track.uploader;
  duration.textContent = formatDuration(totalSeconds);
  for (const slider of [resumeProgressSlider, immersiveResumeProgressSlider]) {
    if (!slider) continue;
    slider.max = String(sliderMax);
    slider.value = String(safePosition);
    slider.style.setProperty("--progress", progress);
  }
  if (resumeCurrentTimeLabel) resumeCurrentTimeLabel.textContent = formatDuration(safePosition);
  if (immersiveResumeCurrentTimeLabel) {
    immersiveResumeCurrentTimeLabel.textContent = formatDuration(safePosition);
  }
  if (immersiveResumeDurationLabel) {
    immersiveResumeDurationLabel.textContent = formatDuration(totalSeconds);
  }
  status.textContent = "已恢复上次播放，点击播放继续。";
}

async function restorePlaybackState() {
  try {
    const state = await invoke("get_playback_state");
    if (
      !state ||
      !Array.isArray(state.queue) ||
      state.queue.length === 0 ||
      playerState.queue.length > 0 ||
      playerState.currentIndex >= 0 ||
      audio.currentSrc
    ) {
      return;
    }

    setQueue(state.queue, { save: false });
    playerState.queueSource = "restored";
    playerState.currentIndex = Math.max(
      0,
      Math.min(Math.round(Number(state.currentIndex) || 0), playerState.queue.length - 1),
    );
    resetRandomRemaining();
    updateQueueUi();
    renderLibraryViews();
    const track = currentPlayableTrack();
    if (!track) {
      return;
    }
    pendingResume = {
      positionSeconds: Math.max(0, Number(state.positionSeconds) || 0),
      page: state.page == null ? null : Math.max(1, Math.round(Number(state.page) || 1)),
      cid: state.cid == null ? null : Math.max(0, Math.round(Number(state.cid) || 0)),
    };
    renderRestoredPlaybackUi(track, pendingResume.positionSeconds);
    emitCurrentTrackChanged();
  } catch (error) {
    console.warn("restore playback state failed:", error);
  }
}

function setQueue(videos, { save = true } = {}) {
  clearPendingResume();
  playerState.queue = videos.map(normalizeTrack);
  playerState.queueSource = "direct";
  playerState.queueSearchVersion = null;
  playerState.queuePlaylistId = null;
  playerState.currentIndex = -1;
  playerState.history = [];
  playerState.consecutiveResolveFailures = 0;
  resetCurrentPageState();
  clearPlaybackNotice();
  resetRandomRemaining();
  updateQueueUi();
  renderLibraryViews();
  emitCurrentTrackChanged();
  if (save) {
    savePlaybackState();
  }
}

function setSearchResults(videos) {
  searchState.results = videos.map(normalizeTrack);
  renderSearchResults();
  updateQueueUi();
}

function appendSearchResults(videos) {
  const knownBvids = new Set(searchState.results.map((video) => video.bvid));
  const uniqueVideos = videos
    .filter((video) => {
      if (!video?.bvid || knownBvids.has(video.bvid)) {
        return false;
      }
      knownBvids.add(video.bvid);
      return true;
    })
    .map(normalizeTrack);

  if (uniqueVideos.length === 0) {
    updateQueueUi();
    return 0;
  }

  searchState.results.push(...uniqueVideos);
  if (playerState.queueSearchVersion === searchState.requestVersion) {
    const startIndex = playerState.queue.length;
    playerState.queue.push(...uniqueVideos.map(normalizeTrack));
    addNewIndexesToRandomRemaining(startIndex, uniqueVideos.length);
    savePlaybackState();
  }
  renderSearchResults();
  updateQueueUi();
  emitCurrentTrackChanged();
  return uniqueVideos.length;
}

function updateQueueUi() {
  const hasCurrent =
    playerState.currentIndex >= 0 &&
    playerState.currentIndex < playerState.queue.length;
  queueCount.textContent = `${searchState.results.length} 首`;
  queuePosition.textContent = hasCurrent
    ? `♪${playerState.currentIndex + 1}/${playerState.queue.length}`
    : `♪0/${playerState.queue.length}`;
  previousButton.disabled = false;
  nextButton.disabled = false;

  const loopMode = LOOP_MODES.find(
    (candidate) => candidate.id === playerState.loopMode,
  );
  loopModeButton.dataset.loopMode = playerState.loopMode;
  loopModeButton.title = playerState.loopMode === "sequence" ? "关闭循环" : loopMode.label;
  loopModeButton.setAttribute("aria-label", loopModeButton.title);
  loopModeButton.classList.toggle("is-active", playerState.loopMode !== "sequence");
  shuffleToggle.checked = playerState.shuffle;

  for (const queueButton of [
    ...searchResults.querySelectorAll("button[data-result-index]"),
  ]) {
    const index = Number(queueButton.dataset.resultIndex);
    if (
      playerState.queueSearchVersion === searchState.requestVersion &&
      index === playerState.currentIndex
    ) {
      queueButton.setAttribute("aria-current", "true");
    } else {
      queueButton.removeAttribute("aria-current");
    }
  }
  if (homeRankingList) {
    for (const rankingButton of homeRankingList.querySelectorAll("button.track")) {
      const index = Number(rankingButton.dataset.libraryIndex);
      const activeHomeSource =
        homeState.mode === "recommendation" ? "recommendation" : "ranking";
      if (playerState.queueSource === activeHomeSource && index === playerState.currentIndex) {
        rankingButton.setAttribute("aria-current", "true");
      } else {
        rankingButton.removeAttribute("aria-current");
      }
    }
  }
  updateFavoriteButtons();
  updateLibraryHighlights();
}

function isFavorited(bvid) {
  return libraryState.favoriteBvids.has(String(bvid ?? "").toLowerCase());
}

function readShuffleCollectionPrefs() {
  try {
    return normalizeShuffleCollectionPrefs(
      localStorage.getItem("bilibili-music.shuffle-collection-order"),
      localStorage.getItem("bilibili-music.shuffle-collection-limit"),
    );
  } catch {
    return normalizeShuffleCollectionPrefs(null, null);
  }
}

function setFavoriteButtonState(button, bvid) {
  const favorited = isFavorited(bvid);
  button.classList.toggle("is-favorited", favorited);
  button.textContent = favorited ? "♥" : "♡";
  button.title = favorited ? "取消收藏" : "收藏";
  button.setAttribute("aria-label", favorited ? "取消收藏" : "收藏");
}

function updateFavoriteButtons() {
  for (const button of document.querySelectorAll("[data-favorite-bvid]")) {
    setFavoriteButtonState(button, button.dataset.favoriteBvid);
  }
  const current = currentPlayableTrack();
  for (const button of [favoriteCurrentButton, immersiveFavoriteButton]) {
    if (!button) {
      continue;
    }
    button.disabled = !current;
    button.dataset.favoriteBvid = current?.bvid ?? "";
    const favorited = current ? isFavorited(current.bvid) : false;
    button.classList.toggle("is-favorited", favorited);
    button.textContent = button === immersiveFavoriteButton
      ? `${favorited ? "♥" : "♡"} ${favorited ? "已收藏" : "收藏"}`
      : favorited ? "♥" : "♡";
    button.title = favorited ? "取消收藏当前歌曲" : "收藏当前歌曲";
  }
}

function createTrackActions(video, { playlistId = "" } = {}) {
  const actions = document.createElement("span");
  actions.className = "track-actions";

  const favoriteButton = document.createElement("button");
  favoriteButton.type = "button";
  favoriteButton.className = "track-action favorite-button";
  favoriteButton.dataset.favoriteBvid = video.bvid;
  setFavoriteButtonState(favoriteButton, video.bvid);
  favoriteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(video);
  });
  actions.append(favoriteButton);

  if (playlistId) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "track-action";
    removeButton.textContent = "−";
    removeButton.title = "从歌单移除";
    removeButton.setAttribute("aria-label", "从歌单移除");
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeTrackFromPlaylist(playlistId, video.bvid);
    });
    actions.append(removeButton);
  } else {
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "track-action";
    addButton.textContent = "+";
    addButton.title = "加入歌单";
    addButton.setAttribute("aria-label", "加入歌单");
    addButton.addEventListener("click", (event) => {
      event.stopPropagation();
      choosePlaylistAndAdd(video);
    });
    actions.append(addButton);
  }

  return actions;
}

function createTrackRow(video, index, onPlay, options = {}) {
  const item = document.createElement("li");
  item.className = "track-row";
  const playButton = document.createElement("button");
  const eq = document.createElement("span");
  const coverWrap = document.createElement("span");
  const meta = document.createElement("span");
  const trackTitle = document.createElement("span");
  const trackUp = document.createElement("span");
  const trackPlay = document.createElement("span");
  const trackDuration = document.createElement("span");

  playButton.type = "button";
  playButton.className = "track";
  playButton.dataset.libraryIndex = String(index);

  eq.className = "eq";
  eq.setAttribute("aria-hidden", "true");
  eq.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  playButton.append(eq);

  coverWrap.className = "track-cover";
  if (video.thumbnailUrl) {
    const cover = document.createElement("img");
    cover.src = displayThumbnailUrl(video.thumbnailUrl);
    cover.alt = "";
    cover.loading = "lazy";
    cover.referrerPolicy = "no-referrer";
    coverWrap.append(cover);
  } else {
    const coverPlaceholder = document.createElement("span");
    coverPlaceholder.className = "cover-placeholder";
    coverWrap.append(coverPlaceholder);
  }
  playButton.append(coverWrap);

  meta.className = "track-meta";
  trackTitle.className = "track-title";
  trackTitle.textContent = video.title || video.bvid;
  trackUp.className = "track-up";
  trackUp.textContent = video.uploader || video.bvid;
  meta.append(trackTitle, trackUp);
  playButton.append(meta);

  if (options.showPlayCount) {
    trackPlay.className = "track-play";
    trackPlay.textContent = formatPlayCount(video.playCount);
    playButton.append(trackPlay);
  }

  trackDuration.className = "track-duration";
  trackDuration.textContent = video.durationSeconds
    ? formatDuration(video.durationSeconds)
    : "0:00";
  playButton.append(trackDuration);
  const actions = createTrackActions(video, options);
  const unavailableReason = libraryState.unavailableBvids.get(video.bvid.toLowerCase());
  if (unavailableReason) {
    item.classList.add("is-unavailable");
    const unavailable = document.createElement("span");
    unavailable.className = "track-unavailable";
    unavailable.textContent = "!";
    unavailable.title = unavailableReason;
    unavailable.setAttribute("aria-label", unavailableReason);
    actions.prepend(unavailable);
  }
  item.append(playButton, actions);
  bindTrackActivation(item, playButton, video, (pageSelection) =>
    onPlay(index, pageSelection));

  return item;
}

function renderSearchResults() {
  searchResults.replaceChildren();

  searchState.results.forEach((video, index) => {
    const item = document.createElement("li");
    item.className = "track-row";
    const playButton = document.createElement("button");
    const eq = document.createElement("span");
    const coverWrap = document.createElement("span");
    const meta = document.createElement("span");
    const trackTitle = document.createElement("span");
    const trackUp = document.createElement("span");
    const trackPlay = document.createElement("span");
    const trackPubdate = document.createElement("span");
    const trackDuration = document.createElement("span");

    playButton.type = "button";
    playButton.className = "track";
    playButton.dataset.resultIndex = String(index);

    eq.className = "eq";
    eq.setAttribute("aria-hidden", "true");
    eq.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    playButton.append(eq);

    coverWrap.className = "track-cover";
    if (video.thumbnailUrl) {
      const cover = document.createElement("img");
      cover.src = displayThumbnailUrl(video.thumbnailUrl);
      cover.alt = "";
      cover.loading = "lazy";
      cover.referrerPolicy = "no-referrer";
      coverWrap.append(cover);
    } else {
      const coverPlaceholder = document.createElement("span");
      coverPlaceholder.className = "cover-placeholder";
      coverWrap.append(coverPlaceholder);
    }
    playButton.append(coverWrap);

    meta.className = "track-meta";
    trackTitle.className = "track-title";
    trackTitle.textContent = video.title || video.bvid;
    trackUp.className = "track-up";
    trackUp.textContent = video.uploader || video.bvid;
    meta.append(trackTitle, trackUp);
    playButton.append(meta);

    trackPlay.className = "track-play";
    trackPlay.textContent = formatPlayCount(video.playCount);
    playButton.append(trackPlay);

    trackPubdate.className = "track-pubdate";
    trackPubdate.textContent = formatPubdate(video.pubdate);
    playButton.append(trackPubdate);

    trackDuration.className = "track-duration";
    trackDuration.textContent = video.durationSeconds
      ? formatDuration(video.durationSeconds)
      : "0:00";
    playButton.append(trackDuration);

    item.append(playButton, createTrackActions(video));
    bindTrackActivation(item, playButton, video, (pageSelection) =>
      playSearchResult(index, pageSelection));
    searchResults.append(item);
  });
  updateQueueUi();
}

function playCurrentVideoPage(page) {
  clearPendingResume();
  const pageIndex = playerState.currentPages.findIndex(
    (candidate) => candidate.cid === page.cid || candidate.page === page.page,
  );
  if (pageIndex < 0 || pageIndex === playerState.currentPageIndex) {
    return;
  }
  playerState.currentPageIndex = pageIndex;
  playerState.currentDisplayTrack = null;
  updatePlayerPagesButton();
  loadCurrentTrack({ keepPage: true });
}

let favoriteImportVersion = 0;

function showLoudnessNormalizationDialog() {
  openLibraryModal("响度归一化", "");

  const intro = document.createElement("p");
  intro.className = "library-confirm-copy";
  intro.textContent =
    "不同 UP 主上传的音源响度差别很大，切歌时忽大忽小。开启后，播放器会把音量补偿到接近的水平。";

  const measurement = document.createElement("p");
  measurement.className = "library-confirm-copy";
  const measurementLead = document.createElement("strong");
  measurementLead.textContent = "需要先测量。";
  measurement.append(
    measurementLead,
    "每首歌播放约 30 秒后会自动在后台测量一次，测完才会生效，下次再听就是直接生效的。所以刚开启时你会觉得没什么变化，听一段时间后效果才明显。",
  );

  const attenuation = document.createElement("p");
  attenuation.className = "library-confirm-copy";
  const attenuationLead = document.createElement("strong");
  attenuationLead.textContent = "只会调小，不会调大。";
  attenuation.append(
    attenuationLead,
    "受浏览器限制只能衰减，整体音量会略低于原先，把系统音量推高一档即可。",
  );

  const traffic = document.createElement("p");
  traffic.className = "library-confirm-copy";
  traffic.textContent = "测量需要重新下载一遍音频，会消耗一些流量。";

  const actions = document.createElement("div");
  actions.className = "library-modal-actions";
  const acknowledgeButton = document.createElement("button");
  acknowledgeButton.type = "button";
  acknowledgeButton.className = "secondary-button";
  acknowledgeButton.textContent = "知道了";
  acknowledgeButton.addEventListener("click", closeLibraryModal);
  actions.append(acknowledgeButton);

  libraryModalBody.append(intro, measurement, attenuation, traffic, actions);
  acknowledgeButton.focus();
}

function waitForAudioMetadata() {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.removeEventListener("error", handleError);
    };
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(audio.error ?? new Error("audio metadata load failed"));
    };
    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.addEventListener("error", handleError);
  });
}

function shouldRecoverAudio(errorCode, isCurrent, hasPlayed, attempts) {
  return errorCode === 2 && isCurrent && hasPlayed && attempts < MAX_AUDIO_RECOVERIES;
}

function recoveryAttemptsFor(version) {
  if (recoveryVersion !== version) {
    recoveryVersion = version;
    recoveryAttempts = 0;
  }
  return recoveryAttempts;
}

function refundRecoveryAttempt(version) {
  if (recoveryVersion === version) recoveryAttempts -= 1;
}

function waitForRecoveryMetadata(version) {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", loaded);
      audio.removeEventListener("error", failed);
      audio.removeEventListener("emptied", emptied);
    };
    const loaded = () => { cleanup(); resolve(true); };
    const failed = () => { cleanup(); reject(audio.error ?? new Error("audio metadata load failed")); };
    const emptied = () => {
      if (version !== playerState.requestVersion) { cleanup(); resolve(false); }
    };
    audio.addEventListener("loadedmetadata", loaded);
    audio.addEventListener("error", failed);
    audio.addEventListener("emptied", emptied);
  });
}

async function recoverCurrentAudio(version, sourceUrl, position, wasPlaying) {
  if (version !== playerState.requestVersion || sourceUrl !== playerState.activeAudioUrl) {
    window.recordPlaybackDiag("audio-recovery", "abandoned before prepare_audio");
    return;
  }
  const video = playerState.queue[playerState.currentIndex];
  const page = currentVideoPage();
  recoveryAttempts += 1;
  window.recordPlaybackDiag("audio-recovery", `start attempt=${recoveryAttempts} position=${position}`);
  try {
    const info = await invoke("prepare_audio", {
      bvId: video.bvid,
      cid: page?.cid ?? null,
      cacheCid: currentAudioCacheCid(),
      page: page?.page ?? null,
      part: page?.part ?? null,
      durationSeconds: page?.durationSeconds ?? null,
    });
    if (version !== playerState.requestVersion || sourceUrl !== playerState.activeAudioUrl) {
      refundRecoveryAttempt(version);
      window.recordPlaybackDiag("audio-recovery", "abandoned after prepare_audio");
      return;
    }
    playerState.activeAudioUrl = info.audioUrl;
    playerState.audioActivatedAt = performance.now();
    audio.src = info.audioUrl;
    audio.load();
    const loaded = await waitForRecoveryMetadata(version);
    if (!loaded || version !== playerState.requestVersion) {
      refundRecoveryAttempt(version);
      window.recordPlaybackDiag("audio-recovery", "abandoned while loading metadata");
      return;
    }
    const maxPosition = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 1) : position;
    audio.currentTime = Math.min(Math.max(0, position), maxPosition);
    if (wasPlaying) await audio.play();
    if (version !== playerState.requestVersion) {
      refundRecoveryAttempt(version);
      window.recordPlaybackDiag("audio-recovery", "abandoned after play");
      return;
    }
    window.recordPlaybackDiag("audio-recovery", `success attempt=${recoveryAttempts}`);
  } catch (error) {
    if (version !== playerState.requestVersion || String(error).includes("audio resolution was cancelled")) {
      refundRecoveryAttempt(version);
      window.recordPlaybackDiag("audio-recovery", `abandoned: ${error}`);
      return;
    }
    window.recordPlaybackDiag("audio-recovery", `failed: ${error}`);
    showPlaybackNotice(`${playbackFailureMessage(error)}，播放已中断。`, { persistent: true });
  }
}

function handleAudioRecoveryError(event) {
  const version = playerState.requestVersion;
  const isCurrent = playerState.activeAudioVersion === version &&
    playerState.activeAudioUrl === audio.currentSrc &&
    event.timeStamp >= playerState.audioActivatedAt;
  const attempts = recoveryAttemptsFor(version);
  if (recoveryPromise) {
    if (audio.error?.code === 2 && isCurrent) {
      window.recordPlaybackDiag("audio-recovery", "abandoned: recovery already running");
    }
    return;
  }
  if (!shouldRecoverAudio(audio.error?.code, isCurrent, playingAudioVersion === version, attempts)) {
    if (audio.error?.code === 2 && isCurrent && playingAudioVersion === version && attempts >= MAX_AUDIO_RECOVERIES) {
      window.recordPlaybackDiag("audio-recovery", "limit reached");
      showPlaybackNotice(`${playbackFailureMessage("request failed")}，播放已中断。`, { persistent: true });
    }
    return;
  }
  const sourceUrl = audio.currentSrc;
  const position = audio.currentTime;
  const wasPlaying = playbackIntended;
  const recovery = Promise.resolve().then(() => recoverCurrentAudio(version, sourceUrl, position, wasPlaying));
  recoveryPromise = recovery;
  const clear = () => { if (recoveryPromise === recovery) recoveryPromise = null; };
  void recovery.then(clear, clear);
}

let loudnessQueryVersion = 0;
let loudnessAnalyzedForCurrentTrack = false;

// 与 src-tauri/src/loudness.rs::lufs_to_gain 有两份公式实现，改一处必须同步。
function lufsToGain(lufs) {
  if (lufs === null || lufs === undefined || !Number.isFinite(lufs)) {
    return 1.0;
  }
  const gainDb = Math.min(0, Math.max(-12, -14 - lufs));
  return 10 ** (gainDb / 20);
}

function refreshTrackLoudness() {
  const queryVersion = ++loudnessQueryVersion;
  const requestVersion = playerState.requestVersion;
  setNormalizationGain(1);
  if (!isLoudnessNormalizationEnabled()) return;
  const bvid = playerState.queue[playerState.currentIndex]?.bvid;
  const cid = currentVideoPage()?.cid ?? playerState.currentPages[0]?.cid;
  if (!bvid || !cid) {
    console.warn("track loudness unavailable: missing bvid/cid");
    return;
  }
  invoke("get_track_loudness", { key: `${bvid}:${cid}` }).then((lufs) => {
    if (queryVersion !== loudnessQueryVersion || requestVersion !== playerState.requestVersion) return;
    if (lufs === null || !Number.isFinite(lufs)) {
      console.warn("track loudness unavailable:", `${bvid}:${cid}`);
    }
    setNormalizationGain(lufsToGain(lufs));
  }).catch((error) => {
    if (queryVersion !== loudnessQueryVersion || requestVersion !== playerState.requestVersion) return;
    setNormalizationGain(1);
    console.warn("get_track_loudness failed:", error);
  });
}

function analyzeCurrentTrackAtThreshold() {
  if (loudnessAnalyzedForCurrentTrack || !isLoudnessNormalizationEnabled()) return;
  const dur = Number(audio.duration);
  const threshold = dur > 0 ? Math.min(30, dur * 0.9) : 30;
  if (audio.currentTime < threshold) return;
  const bvid = playerState.queue[playerState.currentIndex]?.bvid;
  const cid = currentVideoPage()?.cid ?? playerState.currentPages[0]?.cid;
  const audioUrl = playerState.activeAudioUrl;
  if (!bvid || !cid || !audioUrl) return;

  loudnessAnalyzedForCurrentTrack = true;
  const requestVersion = playerState.requestVersion;
  const startAnalysis = () => {
    if (requestVersion !== playerState.requestVersion || !isLoudnessNormalizationEnabled()) return;
    invoke("analyze_track_loudness", { audioUrl, key: `${bvid}:${cid}` }).then((lufs) => {
      if (requestVersion !== playerState.requestVersion) return;
      if (lufs === null || !Number.isFinite(lufs)) {
        console.warn("track loudness analysis unavailable:", `${bvid}:${cid}`);
        return;
      }
      setNormalizationGain(lufsToGain(lufs));
    }).catch((error) => {
      console.warn("analyze_track_loudness failed:", error);
    });
  };
  if (cacheRequestPromise) {
    void cacheRequestPromise.then(startAnalysis);
  } else {
    startAnalysis();
  }
}

async function loadCurrentTrack({
  keepPage = false,
  startPage = null,
  resumePosition = null,
  randomStartPage = false,
} = {}) {
  const index = playerState.currentIndex;
  const video = playerState.queue[index];
  if (!video) {
    return;
  }

  const requestVersion = ++playerState.requestVersion;
  stopAudioElement();
  searchButton.disabled = true;
  result.hidden = false;
  status.textContent = "正在解析音频…";

  try {
    if (!keepPage) {
      const stillCurrent = await loadPagesForCurrentVideo(video, requestVersion);
      if (!stillCurrent) {
        return;
      }
    }

    const selectDefaultPage = (random = false) => {
      const isDisabled = (page) => isPageDisabled(libraryState.disabledPages, video.bvid, page.cid);
      const pageIndex = random
        ? pickRandomEnabledPageIndex(playerState.currentPages, isDisabled, Math.random)
        : findEnabledPageIndex(playerState.currentPages, 0, 1, isDisabled);
      if (pageIndex < 0) throw new Error("all pages disabled by user");
      playerState.currentPageIndex = pageIndex;
      updatePlayerPagesButton();
    };

    if (!startPage && !keepPage && resumePosition === null && hasMultipleCurrentPages()) {
      selectDefaultPage(randomStartPage);
    }

    if (startPage) {
      const startPageIndex = playerState.currentPages.findIndex(
        (page) => page.cid === startPage.cid || page.page === startPage.page,
      );
      if (startPageIndex >= 0) {
        playerState.currentPageIndex = startPageIndex;
        updatePlayerPagesButton();
      } else if (hasMultipleCurrentPages()) {
        selectDefaultPage();
      }
    }

    const page = currentVideoPage();
    if (recoveryPromise) {
      const recovery = recoveryPromise;
      void invoke("cancel_prepare_audio").catch(() => {});
      await recovery.catch(() => {});
      if (requestVersion !== playerState.requestVersion) return;
    }
    const info = await invoke("prepare_audio", {
      bvId: video.bvid,
      cid: page?.cid ?? null,
      cacheCid: currentAudioCacheCid(),
      page: page?.page ?? null,
      part: page?.part ?? null,
      durationSeconds: page?.durationSeconds ?? null,
    });
    if (requestVersion !== playerState.requestVersion) {
      return;
    }
    playerState.consecutiveResolveFailures = 0;
    const unavailableKey = video.bvid.toLowerCase();
    if (libraryState.unavailableBvids.delete(unavailableKey)) {
      invoke("clear_track_unavailable", { bvid: video.bvid })
        .catch((error) => console.warn("unavailable track clear failed:", error));
      renderLibraryViews();
    }

    const displayTrack = buildDisplayTrack(video, info, page);
    playerState.currentDisplayTrack = displayTrack;
    if (!displayTrack) {
      Object.assign(video, {
        title: info.title,
        uploader: info.uploader,
        thumbnailUrl: displayThumbnailUrl(info.thumbnailUrl),
        durationSeconds: info.durationSeconds,
      });
      if (
        playerState.queueSearchVersion === searchState.requestVersion &&
        searchState.results[index]
      ) {
        Object.assign(searchState.results[index], {
          title: info.title,
          uploader: info.uploader,
          thumbnailUrl: displayThumbnailUrl(info.thumbnailUrl),
          durationSeconds: info.durationSeconds,
        });
      }
    }
    const visibleTrack = displayTrack ?? {
      title: info.title,
      uploader: info.uploader,
      thumbnailUrl: displayThumbnailUrl(info.thumbnailUrl),
      durationSeconds: info.durationSeconds,
    };
    thumbnail.src = displayThumbnailUrl(visibleTrack.thumbnailUrl);
    title.textContent = visibleTrack.title;
    uploader.textContent = visibleTrack.uploader;
    duration.textContent = formatDuration(visibleTrack.durationSeconds);
    emitCurrentTrackChanged();
    (page?.cid ?? playerState.currentPages[0]?.cid) && window.dispatchEvent(new CustomEvent("bili-track-changed", { detail: { bvid: video.bvid, cid: page?.cid ?? playerState.currentPages[0].cid } }));
    refreshTrackLoudness();
    playerState.activeAudioVersion = requestVersion;
    playerState.activeAudioUrl = info.audioUrl;
    playerState.audioActivatedAt = performance.now();
    audio.src = info.audioUrl;
    audio.load();
    if (resumePosition !== null) {
      await waitForAudioMetadata();
      if (requestVersion !== playerState.requestVersion) {
        return;
      }
      try {
        const maxPosition = Math.max(0, Number(audio.duration) - 1);
        audio.currentTime = Math.min(
          Math.max(0, Number(resumePosition) || 0),
          Number.isFinite(maxPosition) ? maxPosition : 0,
        );
      } catch (error) {
        console.warn("restore playback seek failed:", error);
      }
      clearPendingResume();
    }
    if (!displayTrack) {
      renderSearchResults();
      renderLibraryViews();
    }
    savePlaybackState();

    try {
      await audio.play();
      if (requestVersion === playerState.requestVersion) {
        status.textContent = "在线播放中。";
      }
    } catch (error) {
      if (requestVersion === playerState.requestVersion) {
        status.textContent = "音频已就绪，点击播放。";
      }
      if (resumePosition !== null) {
        console.warn("restored audio could not start playing:", error);
      }
    }
  } catch (error) {
    if (requestVersion !== playerState.requestVersion) {
      return;
    }

    if (resumePosition !== null) {
      clearPendingResume();
      console.warn(`restore playback failed for ${video.bvid}:`, error);
      void loadCurrentTrack({ keepPage: currentVideoPage() !== null });
      return;
    }

    console.error(`prepare_audio failed for ${video.bvid}:`, error);

    const unavailableReason = unavailableTrackReason(error);
    if (unavailableReason) {
      libraryState.unavailableBvids.set(video.bvid.toLowerCase(), unavailableReason);
      invoke("mark_track_unavailable", { bvid: video.bvid, reason: unavailableReason })
        .catch((markError) => console.warn("unavailable track mark failed:", markError));
      renderLibraryViews();
    }

    playerState.consecutiveResolveFailures += 1;
    if (
      playerState.consecutiveResolveFailures >=
      MAX_CONSECUTIVE_RESOLVE_FAILURES
    ) {
      const message = "队列中多首无法播放，已停止。";
      status.textContent = message;
      showPlaybackNotice(message, { persistent: true });
      return;
    }

    if (advancePageWithinCurrentBv({ automatic: true, skipFailed: true })) {
      showPlaybackNotice(`${playbackFailureMessage(error, true)}，已自动跳过。`);
      return;
    }

    const advanced = playNext({ automatic: true, skipFailed: true });
    if (advanced) {
      showPlaybackNotice(`${playbackFailureMessage(error)}，已自动跳过。`);
    } else {
      const message = `${playbackFailureMessage(error)}，队列中没有可继续播放的内容。`;
      status.textContent = message;
      showPlaybackNotice(message, { persistent: true });
    }
  } finally {
    if (requestVersion === playerState.requestVersion) {
      searchButton.disabled = false;
    }
  }
}

async function resumePendingPlayback() {
  if (!pendingResume || resumeInProgress || audio.currentSrc) {
    return;
  }
  const resume = { ...pendingResume };
  resumeInProgress = true;
  try {
    await loadCurrentTrack({
      startPage: resume,
      resumePosition: resume.positionSeconds,
    });
  } catch (error) {
    clearPendingResume();
    console.warn("resume playback failed:", error);
  } finally {
    resumeInProgress = false;
  }
}

function playBvId(bvId) {
  const queueIndex = playerState.queue.findIndex(
    (video) => video.bvid.toLowerCase() === bvId.toLowerCase(),
  );
  if (queueIndex >= 0) {
    playQueueIndex(queueIndex);
    return;
  }

  setQueue([
    {
      bvid: bvId,
      title: bvId,
      uploader: "",
      thumbnailUrl: "",
      durationSeconds: 0,
    },
  ]);
  playQueueIndex(0);
}

function playSearchResult(index, pageSelection = null) {
  if (index < 0 || index >= searchState.results.length) {
    return;
  }

  playListItem("search", searchState.results, index, {
    searchVersion: searchState.requestVersion,
    ...(pageSelection ?? {}),
  });
}

function playListItem(
  source,
  videos,
  index,
  { searchVersion = null, playlistId = null, startPage = null, pages = [] } = {},
) {
  if (index < 0 || index >= videos.length) {
    return;
  }

  const currentVideo = playerState.queue[playerState.currentIndex];
  const targetBvid = String(videos[index]?.bvid ?? "").toLowerCase();
  const isCurrentQueueItem =
    !startPage &&
    targetBvid &&
    playerState.queueSource === source &&
    playerState.currentIndex === index &&
    String(currentVideo?.bvid ?? "").toLowerCase() === targetBvid &&
    (source !== "search" || playerState.queueSearchVersion === searchVersion) &&
    (source !== "playlist" || playerState.queuePlaylistId === playlistId);
  if (isCurrentQueueItem) {
    if (audio.paused) {
      void audio.play().catch(() => {});
    }
    return;
  }

  playerState.queue = videos.map(normalizeTrack);
  playerState.queueSource = source;
  playerState.queueSearchVersion = source === "search" ? searchVersion : null;
  playerState.queuePlaylistId = source === "playlist" ? playlistId : null;
  playerState.currentIndex = -1;
  playerState.history = [];
  playerState.consecutiveResolveFailures = 0;
  resetCurrentPageState();
  clearPlaybackNotice();
  resetRandomRemaining();
  playQueueIndex(index, { recordCurrent: false, startPage, pages });
}

function playQueueIndex(
  index,
  {
    recordCurrent = true,
    preserveFailureStreak = false,
    startPage = null,
    pages = [],
    randomStartPage = false,
    historyCid = null,
  } = {},
) {
  if (index < 0 || index >= playerState.queue.length) {
    return;
  }
  randomPageRound = null;
  clearPendingResume();

  if (!preserveFailureStreak) {
    playerState.consecutiveResolveFailures = 0;
    clearPlaybackNotice();
  }

  const previousIndex = playerState.currentIndex;
  if (
    recordCurrent &&
    previousIndex >= 0 &&
    previousIndex !== index
  ) {
    playerState.history.push({ index: previousIndex, cid: currentVideoPage()?.cid ?? null });
  }
  playerState.currentIndex = index;
  resetCurrentPageState();
  if (startPage) {
    const normalizedPages = pages.map(normalizeVideoPage).filter((page) => page.cid > 0);
    const startPageIndex = normalizedPages.findIndex(
      (page) => page.cid === startPage.cid || page.page === startPage.page,
    );
    if (normalizedPages.length > 1 && startPageIndex >= 0) {
      playerState.currentPages = normalizedPages;
      playerState.currentPageIndex = startPageIndex;
    }
  }
  updatePlayerPagesButton();
  markRandomIndexPlayed(index);
  updateQueueUi();
  emitCurrentTrackChanged();
  if (currentVideoPage()) {
    loadCurrentTrack({ keepPage: true });
  } else {
    loadCurrentTrack({ randomStartPage, ...(historyCid != null ? { startPage: { cid: historyCid } } : {}) });
  }
}

function takeRandomNext() {
  if (playerState.randomRemaining.length === 0) {
    if (playerState.loopMode !== "list") {
      return null;
    }
    resetRandomRemaining();
    if (
      playerState.randomRemaining.length === 0 &&
      playerState.queue.length === 1
    ) {
      return playerState.currentIndex;
    }
  }
  return playerState.randomRemaining.pop() ?? null;
}

function takeSequentialNext() {
  const nextIndex = playerState.currentIndex + 1;
  if (nextIndex < playerState.queue.length) {
    return nextIndex;
  }
  return playerState.loopMode === "list" && playerState.queue.length > 0
    ? 0
    : null;
}

function advancePageWithinCurrentBv({ automatic = false, skipFailed = false } = {}) {
  if (!hasMultipleCurrentPages()) {
    return false;
  }

  if (automatic && playerState.loopMode === "single" && !skipFailed) {
    loadCurrentTrack({ keepPage: true });
    return true;
  }
  const bvid = playerState.queue[playerState.currentIndex]?.bvid;

  let nextPageIndex;
  if (playerState.shuffle) {
    if (randomPageRound?.bvid !== bvid) randomPageRound = null;
    if (!randomPageRound) {
      randomPageRound = {
        bvid,
        playedCount: 1,
        remaining: buildRandomPageRound(
          playerState.currentPages,
          playerState.currentPageIndex,
          (page) => isPageDisabled(libraryState.disabledPages, bvid, page.cid),
        ),
      };
    }
    const { order, limit } = readShuffleCollectionPrefs();
    if (limit > 0 && randomPageRound.playedCount >= limit) return false;
    if (order === "random") {
      const picked = takeRandomPageFromRound(
        randomPageRound.remaining,
        (index) => index === playerState.currentPageIndex ||
          isPageDisabled(libraryState.disabledPages, bvid, playerState.currentPages[index].cid),
        Math.random,
      );
      randomPageRound.remaining = picked.remaining;
      nextPageIndex = picked.index;
    } else {
      nextPageIndex = findEnabledPageIndex(
        playerState.currentPages,
        playerState.currentPageIndex + 1,
        1,
        (page) => isPageDisabled(libraryState.disabledPages, bvid, page.cid),
      );
      randomPageRound.remaining = randomPageRound.remaining.filter((index) => index !== nextPageIndex);
    }
  } else {
    nextPageIndex = findEnabledPageIndex(
      playerState.currentPages,
      playerState.currentPageIndex + 1,
      1,
      (page) => isPageDisabled(libraryState.disabledPages, bvid, page.cid),
    );
  }
  if (nextPageIndex < 0) {
    return false;
  }

  if (playerState.shuffle) {
    playerState.history.push({ index: playerState.currentIndex, cid: currentVideoPage()?.cid ?? null, pageLevel: true });
    randomPageRound.playedCount += 1;
  }
  playerState.currentPageIndex = nextPageIndex;
  playerState.currentDisplayTrack = null;
  updatePlayerPagesButton();
  loadCurrentTrack({ keepPage: true });
  return true;
}

function retreatPageWithinCurrentBv() {
  if (!hasMultipleCurrentPages() || playerState.currentPageIndex <= 0) {
    return false;
  }

  const bvid = playerState.queue[playerState.currentIndex]?.bvid;
  const previousPageIndex = findEnabledPageIndex(
    playerState.currentPages,
    playerState.currentPageIndex - 1,
    -1,
    (page) => isPageDisabled(libraryState.disabledPages, bvid, page.cid),
  );
  if (previousPageIndex < 0) return false;

  playerState.currentPageIndex = previousPageIndex;
  playerState.currentDisplayTrack = null;
  updatePlayerPagesButton();
  loadCurrentTrack({ keepPage: true });
  return true;
}

function playNext({ automatic = false, skipFailed = false } = {}) {
  if (playerState.currentIndex < 0) {
    if (!automatic) showPlaybackNotice("暂无可播放的歌曲", { kind: "info" });
    return false;
  }
  if (automatic && playerState.loopMode === "single" && !skipFailed) {
    playQueueIndex(playerState.currentIndex, { recordCurrent: false });
    return true;
  }

  const nextIndex = playerState.shuffle
    ? takeRandomNext()
    : takeSequentialNext();
  if (
    nextIndex === null ||
    (skipFailed && nextIndex === playerState.currentIndex)
  ) {
    if (automatic) status.textContent = "队列播放完毕。";
    else showPlaybackNotice(playerState.shuffle ? "本轮随机播放已结束" : "已经是最后一首了", { kind: "info" });
    return false;
  }
  playQueueIndex(nextIndex, {
    preserveFailureStreak: skipFailed,
    ...(playerState.shuffle && readShuffleCollectionPrefs().order === "random" ? { randomStartPage: true } : {}),
  });
  return true;
}

function playPrevious() {
  if (playerState.currentIndex < 0) {
    showPlaybackNotice("暂无可播放的歌曲", { kind: "info" });
    return;
  }

  const historicalEntry = playerState.history.pop();
  if (historicalEntry !== undefined) {
    const { index, cid } = typeof historicalEntry === "number"
      ? { index: historicalEntry, cid: null }
      : historicalEntry;
    if (index === playerState.currentIndex && cid != null) {
      const pageIndex = playerState.currentPages.findIndex((page) => page.cid === cid);
      if (pageIndex >= 0) {
        playerState.currentPageIndex = pageIndex;
        playerState.currentDisplayTrack = null;
        updatePlayerPagesButton();
        loadCurrentTrack({ keepPage: true });
        return;
      }
    }
    playQueueIndex(index, { recordCurrent: false, historyCid: cid });
    return;
  }

  if (!playerState.shuffle && playerState.currentIndex > 0) {
    playQueueIndex(playerState.currentIndex - 1, { recordCurrent: false });
  } else if (
    !playerState.shuffle &&
    playerState.loopMode === "list" &&
    playerState.queue.length > 0
  ) {
    playQueueIndex(playerState.queue.length - 1, { recordCurrent: false });
  } else {
    showPlaybackNotice(playerState.shuffle ? "暂无上一首播放记录" : "已经是第一首了", { kind: "info" });
  }
}

function recordSearchHistoryFireAndForget(keyword) {
  invoke("record_search_history", { keyword }).catch((error) => {
    console.warn("record_search_history failed:", error);
  });
}

function updateMusicTabs() {
  for (const tab of musicTabs) {
    const selected = Number(tab.dataset.tids) === searchState.tids;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
}

function updateSortModeTabs() {
  for (const tab of sortModeTabs) {
    const selected = tab.dataset.sortMode === searchState.sortMode;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
}

function currentSearchRequest(userKeyword) {
  const trimmed = userKeyword.trim();
  if (trimmed) {
    return {
      userKeyword: trimmed,
      requestKeyword: trimmed,
      order: null,
      rerank: true,
    };
  }
  return {
    userKeyword: "",
    requestKeyword: MUSIC_HOT_KEYWORD,
    order: "click",
    rerank: false,
  };
}

async function runSearch({
  userKeyword = searchKeyword.value.trim(),
  recordHistory = false,
  restored = false,
} = {}) {
  const query = currentSearchRequest(userKeyword);
  searchButton.disabled = true;
  if (query.userKeyword) {
    searchStatus.textContent = restored
      ? `已复用上次搜索关键词「${query.userKeyword}」，正在搜索…`
      : "正在搜索…";
  } else {
    searchStatus.textContent = "正在加载该分区热门…";
  }
  const requestVersion = ++searchState.requestVersion;
  searchState.userKeyword = query.userKeyword;
  searchState.requestKeyword = query.requestKeyword;
  searchState.order = query.order;
  searchState.rerank = query.rerank;
  searchState.page = 1;
  searchState.hasMore = false;
  searchState.isLoadingMore = false;

  try {
    const payload = {
      keyword: searchState.requestKeyword,
      page: 1,
      tids: searchState.tids,
      rerank: searchState.rerank,
    };
    if (searchState.order) {
      payload.order = searchState.order;
    }
    if (searchState.rerank) {
      payload.sortMode = searchState.sortMode;
    }
    const searchRequest = invoke("search_videos", payload);
    if (recordHistory && searchState.userKeyword) {
      recordSearchHistoryFireAndForget(searchState.userKeyword);
    }
    const videos = await searchRequest;
    if (requestVersion !== searchState.requestVersion) {
      return;
    }
    setSearchResults(videos);
    result.hidden = false;
    searchState.hasMore = videos.length >= SEARCH_PAGE_SIZE;
    if (searchState.userKeyword) {
      // 仅在真实成功后记录，失败的搜索不沉淀为“上次搜索”。
      saveLastSearchKeyword(searchState.userKeyword);
    }
    const modeLabel = searchState.userKeyword ? "" : "（分区热门）";
    const foundLabel = videos.length
      ? searchState.hasMore
        ? `找到 ${videos.length} 个普通视频${modeLabel}。`
        : `找到 ${videos.length} 个普通视频${modeLabel}。没有更多了`
      : "没有找到普通视频。";
    searchStatus.textContent = restored
      ? `已复用上次搜索关键词「${searchState.userKeyword}」刷新完成，${foundLabel}`
      : foundLabel;
  } catch (error) {
    if (requestVersion !== searchState.requestVersion) {
      return;
    }
    searchStatus.textContent = restored
      ? `复用上次搜索关键词「${searchState.userKeyword}」搜索失败：${error}`
      : `搜索失败：${error}`;
  } finally {
    if (requestVersion === searchState.requestVersion) {
      searchButton.disabled = false;
    }
  }
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = searchKeyword.value.trim();
  if (!query) {
    return;
  }

  if (isBvId(query)) {
    pendingPastedBvPages = null;
    searchState.userKeyword = "";
    searchState.requestKeyword = "";
    searchState.order = null;
    searchState.rerank = true;
    searchState.page = 0;
    searchState.hasMore = false;
    searchState.isLoadingMore = false;
    searchState.requestVersion += 1;
    const pasteVersion = searchState.requestVersion;
    setSearchResults([]);
    await cancelCurrentPlayback();
    if (pasteVersion === searchState.requestVersion) {
      pendingPastedBvPages = { bvid: query, requestVersion: playerState.requestVersion + 1 };
    }
    playBvId(query);
    searchStatus.textContent = `已识别 BV 号：${query}`;
    return;
  }

  await runSearch({ userKeyword: query, recordHistory: true });
  return;
});

async function loadMoreSearchResults() {
  if (
    !searchState.requestKeyword ||
    !searchState.hasMore ||
    searchState.isLoadingMore
  ) {
    return;
  }

  const nextPage = searchState.page + 1;
  const requestVersion = searchState.requestVersion;
  searchState.isLoadingMore = true;
  searchStatus.textContent = `正在加载第 ${nextPage} 页…`;

  try {
    const payload = {
      keyword: searchState.requestKeyword,
      page: nextPage,
      tids: searchState.tids,
      order: searchState.order,
      rerank: searchState.rerank,
    };
    if (searchState.rerank) {
      payload.sortMode = searchState.sortMode;
    }
    const videos = await invoke("search_videos", payload);
    if (
      requestVersion !== searchState.requestVersion ||
      searchKeyword.value.trim() !== searchState.userKeyword
    ) {
      return;
    }

    searchState.page = nextPage;
    const appendedCount = appendSearchResults(videos);
    searchState.hasMore = videos.length >= SEARCH_PAGE_SIZE && appendedCount > 0;
    if (appendedCount > 0) {
      searchStatus.textContent = `已加载第 ${nextPage} 页，追加 ${appendedCount} 个普通视频。`;
    } else {
      searchState.hasMore = false;
      searchStatus.textContent = "没有更多了";
    }
  } catch (error) {
    if (requestVersion === searchState.requestVersion) {
      searchStatus.textContent = `加载更多失败：${error}`;
    }
  } finally {
    if (requestVersion === searchState.requestVersion) {
      searchState.isLoadingMore = false;
      if (!searchState.hasMore && searchState.results.length > 0) {
        searchStatus.textContent = "没有更多了";
      }
    }
  }
}

searchResults.addEventListener("scroll", () => {
  const distanceToBottom =
    searchResults.scrollHeight - searchResults.scrollTop - searchResults.clientHeight;
  if (distanceToBottom <= LOAD_MORE_THRESHOLD_PX) {
    loadMoreSearchResults();
  }
});

window.addEventListener("bili-track-changed", (event) => {
  if (!pendingPastedBvPages) return;
  const shouldOpen = shouldOpenPastedBvPages(
    pendingPastedBvPages,
    event.detail?.bvid,
    currentPlayableTrack()?.bvid,
    playerState.requestVersion,
    playerState.currentPages.length,
  );
  pendingPastedBvPages = null;
  if (shouldOpen) openCurrentPagesModal();
});

window.addEventListener("bilibili-music-trackchange", () => {
  if (!pendingPastedBvPages) return;
  const current = currentPlayableTrack();
  if (current && (
    current.bvid.toLowerCase() !== pendingPastedBvPages.bvid.toLowerCase() ||
    playerState.requestVersion > pendingPastedBvPages.requestVersion ||
    (playerState.requestVersion === pendingPastedBvPages.requestVersion && playerState.currentPages.length <= 1)
  )) pendingPastedBvPages = null;
});

window.addEventListener("bilibili-music-notice-change", () => {
  if (pendingPastedBvPages && playerState.consecutiveResolveFailures > 0) pendingPastedBvPages = null;
});

playerPagesButton?.addEventListener("click", openCurrentPagesModal);
skipVideoButton.addEventListener("click", () => {
  if (playNext()) {
    clearPendingResume();
    clearPlaybackNotice();
  }
});
previousButton.addEventListener("click", () => {
  if (!playerState.shuffle && retreatPageWithinCurrentBv()) {
    clearPendingResume();
    clearPlaybackNotice();
  } else {
    playPrevious();
  }
});
nextButton.addEventListener("click", () => {
  if (advancePageWithinCurrentBv()) {
    clearPendingResume();
    clearPlaybackNotice();
  } else {
    playNext();
  }
});
resumePlayPauseButton?.addEventListener("click", (event) => {
  if (!pendingResume && !resumeInProgress) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  void resumePendingPlayback();
}, true);
audio.addEventListener("ended", (event) => {
  const belongsToCurrentAudio =
    playerState.activeAudioVersion === playerState.requestVersion &&
    playerState.activeAudioUrl === audio.currentSrc &&
    event.timeStamp >= playerState.audioActivatedAt;
  if (belongsToCurrentAudio && audio.ended) {
    const bvid = playerState.queue[playerState.currentIndex]?.bvid;
    const cid = currentVideoPage()?.cid ?? playerState.currentPages[0]?.cid;
    const audioUrl = playerState.activeAudioUrl;
    if (!advancePageWithinCurrentBv({ automatic: true })) {
      playNext({ automatic: true });
    }
    if (bvid && cid && isLoudnessNormalizationEnabled()) {
      invoke("analyze_track_loudness", { audioUrl, key: `${bvid}:${cid}` }).catch((error) => {
        console.warn("analyze_track_loudness failed:", error);
      });
    }
  }
});

audio.addEventListener("timeupdate", () => {
  const now = Date.now();
  if (now - lastPlaybackStateSavedAt >= PLAYBACK_STATE_SAVE_INTERVAL_MS) {
    savePlaybackState();
  }
});

audio.addEventListener("timeupdate", () => {
  if (cacheRequestedForCurrentTrack) return;
  const dur = Number(audio.duration);
  const threshold = dur > 0 ? Math.min(30, dur * 0.9) : 30;
  if (audio.currentTime < threshold) return;
  const snapshot = currentTrackSnapshot();
  const bvid = snapshot.bvid;
  const cid = currentAudioCacheCid();
  const audioUrl = playerState.activeAudioUrl;
  if (
    !bvid || !cid || !audioUrl || !snapshot.title || !snapshot.uploader ||
    !snapshot.thumbnailUrl || !snapshot.durationSeconds ||
    playerState.activeAudioVersion !== playerState.requestVersion ||
    audioUrl !== audio.currentSrc
  ) return;
  cacheRequestedForCurrentTrack = true;
  const request = invoke("cache_track_audio", {
    audioUrl, bvid, cid,
    title: snapshot.title,
    uploader: snapshot.uploader,
    thumbnailUrl: snapshot.thumbnailUrl,
    durationSeconds: Math.round(Number(snapshot.durationSeconds)),
  }).then((result) => {
    console.debug("cache_track_audio:", result);
    if (result === "cached") window.dispatchEvent(new Event("bilibili-music-audio-cache-updated"));
  }).catch((error) => console.warn("cache_track_audio failed:", error));
  cacheRequestPromise = request;
  void request.then(() => {
    if (cacheRequestPromise === request) cacheRequestPromise = null;
  });
});

audio.addEventListener("timeupdate", analyzeCurrentTrackAtThreshold);

audio.addEventListener("timeupdate", () => {
  if (playRecordedForCurrentTrack) return;
  const dur = Number(audio.duration);
  const threshold = dur > 0 ? Math.min(30, dur * 0.9) : 30;
  if (audio.currentTime < threshold) return;
  const snapshot = currentTrackSnapshot();
  if (!snapshot.bvid) return;
  playRecordedForCurrentTrack = true;
  invoke("record_play", { track: snapshot }).catch(() => {});
});

audio.addEventListener("pause", savePlaybackState);
audio.addEventListener("play", () => { playbackIntended = true; });
audio.addEventListener("pause", () => { playbackIntended = false; });
audio.addEventListener("playing", () => {
  if (playerState.activeAudioVersion === playerState.requestVersion &&
      playerState.activeAudioUrl === audio.currentSrc) {
    playingAudioVersion = playerState.activeAudioVersion;
  }
});
audio.addEventListener("error", handleAudioRecoveryError);
for (const eventName of ["play", "pause", "ended", "error", "stalled", "waiting"]) {
  audio.addEventListener(eventName, () => {
    const error = eventName === "error"
      ? ` code=${audio.error?.code ?? "none"} message=${audio.error?.message ?? ""}`
      : "";
    window.recordPlaybackDiag("audio-event", `${eventName}${error}`);
  });
}
document.addEventListener("visibilitychange", () => {
  window.recordPlaybackDiag("visibilitychange", `hidden=${document.hidden}`);
});
window.addEventListener("beforeunload", savePlaybackState);

loopModeButton.addEventListener("click", () => {
  const currentModeIndex = LOOP_MODES.findIndex(
    (candidate) => candidate.id === playerState.loopMode,
  );
  playerState.loopMode =
    LOOP_MODES[(currentModeIndex + 1) % LOOP_MODES.length].id;
  updateQueueUi();
});

shuffleToggle.addEventListener("change", () => {
  playerState.shuffle = shuffleToggle.checked;
  randomPageRound = null;
  if (playerState.shuffle) {
    resetRandomRemaining();
  } else {
    playerState.randomRemaining = [];
    playerState.history = playerState.history.filter((entry) => !entry?.pageLevel);
  }
  updateQueueUi();
});

favoriteCurrentButton?.addEventListener("click", () => toggleFavorite());
immersiveFavoriteButton?.addEventListener("click", () => toggleFavorite());
document.querySelector("#immersive-add-playlist-button")?.addEventListener("click", () => choosePlaylistAndAdd());
createPlaylistButton?.addEventListener("click", createPlaylist);
document.querySelector("#import-playlist-button")?.addEventListener("click", importFavoritePlaylist);
renamePlaylistButton?.addEventListener("click", renameSelectedPlaylist);
deletePlaylistButton?.addEventListener("click", deleteSelectedPlaylist);
refreshRankingButton?.addEventListener("click", () => {
  if (homeState.mode === "recommendation") {
    if (homeState.aiHasKey === false) {
      loadHomeRanking({ forceRefresh: true });
    } else {
      loadRecommendations({ forceRefresh: true });
    }
  } else {
    loadHomeRanking({ forceRefresh: true });
  }
});
homeHintApply?.addEventListener("click", () => {
  homeState.userHint = homeHintInput.value;
  loadRecommendations({ forceRefresh: true });
});
homeHintInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  homeHintApply?.click();
});
homeSetupSettings?.addEventListener("click", () => {
  document.querySelector("#open-settings-button")?.click();
  const ai = document.querySelector(".ai-settings");
  if (ai) {
    ai.setAttribute("open", "");
    ai.scrollIntoView({ block: "center" });
  }
});
for (const tab of homeModeTabs) {
  tab.addEventListener("click", () => setHomeMode(tab.dataset.homeMode));
}
for (const tab of musicTabs) {
  tab.addEventListener("click", () => {
    const tids = Number(tab.dataset.tids) || DEFAULT_MUSIC_TIDS;
    if (searchState.tids === tids && searchState.results.length > 0) {
      return;
    }
    searchState.tids = tids;
    updateMusicTabs();
    runSearch({ userKeyword: searchKeyword.value.trim(), recordHistory: false });
  });
}
for (const tab of sortModeTabs) {
  tab.addEventListener("click", () => {
    const sortMode = tab.dataset.sortMode;
    searchState.sortMode = searchState.sortMode === sortMode ? "all" : sortMode;
    updateSortModeTabs();
    runSearch({ userKeyword: searchKeyword.value.trim(), recordHistory: false });
  });
}
homeRankingError?.addEventListener("click", () => {
  if (homeState.error) {
    loadHomeRanking({ forceRefresh: true });
  }
});
closeLibraryModalButton?.addEventListener("click", closeLibraryModal);
purgeUnavailableTracksButton?.addEventListener("click", openPurgeUnavailableTracksModal);
libraryModal?.addEventListener("click", (event) => {
  if (event.target === libraryModal) {
    closeLibraryModal();
  }
});
libraryModal?.addEventListener("transitionend", (event) => {
  if (event.target === libraryModal && !libraryModal.classList.contains("is-open")) {
    libraryModal.hidden = true;
  }
});
pagesModalClose?.addEventListener("click", closePagesModal);
pagesModalRestoreAll?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (pagesModalContext) void changeDisabledPages(pagesModalContext.video.bvid, null);
});
pagesModal?.addEventListener("click", (event) => {
  if (event.target === pagesModal) {
    closePagesModal();
  }
});
pagesModal?.addEventListener("keydown", keepFocusInPagesModal);
pagesModal?.addEventListener("transitionend", (event) => {
  if (event.target === pagesModal && !pagesModal.classList.contains("is-open")) {
    pagesModal.hidden = true;
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (pagesModal?.classList.contains("is-open")) {
      closePagesModal();
    } else if (libraryModal?.classList.contains("is-open")) {
      closeLibraryModal();
    }
  }
});

window.addEventListener("bilibili-music-viewchange", (event) => {
  if (event.detail?.view === "home") {
    if (homeState.mode === "recommendation") {
      loadRecommendationHome();
    } else {
      loadHomeRanking();
    }
  }
  if (["favorites", "playlists"].includes(event.detail?.view)) {
    loadLibrary();
  }
  if (event.detail?.view === "search" && pendingSearchRestore) {
    const keyword = pendingSearchRestore;
    pendingSearchRestore = null;
    if (!searchState.results.length && searchKeyword.value.trim() === keyword) {
      // 自动恢复不算用户搜索，不计入搜索历史。
      runSearch({ userKeyword: keyword, recordHistory: false, restored: true });
    }
  }
});
window.addEventListener("ai-config-updated", refreshAiKeyState);

updateHomeModeUi();
refreshAiKeyState();
window.addEventListener("DOMContentLoaded", restorePlaybackState, { once: true });
const restoreKeyword = readLastSearchKeyword();
if (restoreKeyword && !searchKeyword.value.trim()) {
  searchKeyword.value = restoreKeyword;
  pendingSearchRestore = restoreKeyword;
}
loadLibrary();
updateMusicTabs();
updateQueueUi();
emitCurrentTrackChanged();
