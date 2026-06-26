const { invoke } = window.__TAURI__.core;

const LOOP_MODES = [
  { id: "sequence", label: "顺序播放" },
  { id: "list", label: "列表循环" },
  { id: "single", label: "单曲循环" },
];
const MAX_CONSECUTIVE_RESOLVE_FAILURES = 5;
const SKIP_NOTICE_DURATION_MS = 3200;
const SEARCH_PAGE_SIZE = 20;
const LOAD_MORE_THRESHOLD_PX = 96;
const DEFAULT_MUSIC_TIDS = 3;
const MUSIC_HOT_KEYWORD = "音乐";

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
};

const searchState = {
  results: [],
  userKeyword: "",
  requestKeyword: "",
  tids: DEFAULT_MUSIC_TIDS,
  order: null,
  page: 0,
  isLoadingMore: false,
  hasMore: false,
  requestVersion: 0,
};

const homeState = {
  ranking: [],
  loaded: false,
  loading: false,
  error: "",
};

const libraryState = {
  favorites: [],
  favoriteBvids: new Set(),
  playlists: [],
  selectedPlaylistId: "",
  loadError: "",
};

const searchForm = document.querySelector("#search-form");
const searchKeyword = document.querySelector("#search-keyword");
const searchButton = document.querySelector("#search-button");
const musicTabs = [...document.querySelectorAll(".music-tab[data-tids]")];
const searchStatus = document.querySelector("#search-status");
const playbackNotice = document.querySelector("#playback-notice");
const searchResults = document.querySelector("#search-results");
const homeRankingStatus = document.querySelector("#home-ranking-status");
const homeRankingError = document.querySelector("#home-ranking-error");
const homeRankingList = document.querySelector("#home-ranking-list");
const refreshRankingButton = document.querySelector("#refresh-ranking-button");
const queueCount = document.querySelector("#queue-count");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const thumbnail = document.querySelector("#thumbnail");
const title = document.querySelector("#title");
const uploader = document.querySelector("#uploader");
const duration = document.querySelector("#duration");
const queuePosition = document.querySelector("#queue-position");
const previousButton = document.querySelector("#previous-button");
const nextButton = document.querySelector("#next-button");
const loopModeButton = document.querySelector("#loop-mode-button");
const shuffleToggle = document.querySelector("#shuffle-toggle");
const audio = document.querySelector("#audio");
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
let playbackNoticeTimer = null;

function isBvId(value) {
  return /^BV[0-9A-Za-z]{10}$/i.test(value.trim());
}

function displayThumbnailUrl(url) {
  if (!url) {
    return "";
  }
  return url
    .replace(/^\/\//, "https://")
    .replace(/@[^/?#]*(?=([?#]|$))/, "");
}

function normalizeTrack(video) {
  return {
    bvid: String(video?.bvid ?? "").trim(),
    title: String(video?.title ?? video?.bvid ?? "未命名视频"),
    uploader: String(video?.uploader ?? "未知 UP 主"),
    thumbnailUrl: displayThumbnailUrl(video?.thumbnailUrl ?? ""),
    durationSeconds: Math.max(0, Math.round(Number(video?.durationSeconds) || 0)),
    addedAt: video?.addedAt ?? "",
  };
}

function snapshotForLibrary(video) {
  const track = normalizeTrack(video);
  return {
    bvid: track.bvid,
    title: track.title,
    uploader: track.uploader,
    thumbnailUrl: track.thumbnailUrl,
    durationSeconds: track.durationSeconds,
  };
}

function currentTrackSnapshot() {
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

function emitCurrentTrackChanged() {
  window.dispatchEvent(
    new CustomEvent("bilibili-music-trackchange", {
      detail: currentTrackSnapshot(),
    }),
  );
}

function clearPlaybackNotice() {
  if (playbackNoticeTimer !== null) {
    clearTimeout(playbackNoticeTimer);
    playbackNoticeTimer = null;
  }
  playbackNotice.classList.remove("is-visible");
}

function showPlaybackNotice(message, { persistent = false } = {}) {
  clearPlaybackNotice();
  playbackNotice.textContent = message;
  playbackNotice.classList.add("is-visible");
  if (!persistent) {
    playbackNoticeTimer = window.setTimeout(() => {
      playbackNotice.classList.remove("is-visible");
      playbackNoticeTimer = null;
    }, SKIP_NOTICE_DURATION_MS);
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

function setQueue(videos) {
  playerState.queue = videos.map(normalizeTrack);
  playerState.queueSource = "direct";
  playerState.queueSearchVersion = null;
  playerState.queuePlaylistId = null;
  playerState.currentIndex = -1;
  playerState.history = [];
  playerState.consecutiveResolveFailures = 0;
  clearPlaybackNotice();
  resetRandomRemaining();
  updateQueueUi();
  renderLibraryViews();
  emitCurrentTrackChanged();
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
  }
  renderSearchResults();
  updateQueueUi();
  emitCurrentTrackChanged();
  return uniqueVideos.length;
}

function appendQueue(videos) {
  const knownBvids = new Set(playerState.queue.map((video) => video.bvid));
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

  const startIndex = playerState.queue.length;
  playerState.queue.push(...uniqueVideos);
  addNewIndexesToRandomRemaining(startIndex, uniqueVideos.length);
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
    ? `${playerState.currentIndex + 1} / ${playerState.queue.length}`
    : `0 / ${playerState.queue.length}`;
  previousButton.disabled = !hasCurrent;
  nextButton.disabled = !hasCurrent;

  const loopMode = LOOP_MODES.find(
    (candidate) => candidate.id === playerState.loopMode,
  );
  loopModeButton.dataset.loopMode = playerState.loopMode;
  loopModeButton.title = `循环模式：${loopMode.label}`;
  loopModeButton.setAttribute("aria-label", `循环模式：${loopMode.label}`);
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
      if (playerState.queueSource === "ranking" && index === playerState.currentIndex) {
        rankingButton.setAttribute("aria-current", "true");
      } else {
        rankingButton.removeAttribute("aria-current");
      }
    }
  }
  updateFavoriteButtons();
  updateLibraryHighlights();
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function isFavorited(bvid) {
  return libraryState.favoriteBvids.has(String(bvid ?? "").toLowerCase());
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

  trackDuration.className = "track-duration";
  trackDuration.textContent = video.durationSeconds
    ? formatDuration(video.durationSeconds)
    : "0:00";
  playButton.append(trackDuration);
  playButton.addEventListener("click", () => onPlay(index));

  item.append(playButton, createTrackActions(video, options));
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

    trackDuration.className = "track-duration";
    trackDuration.textContent = video.durationSeconds
      ? formatDuration(video.durationSeconds)
      : "0:00";
    playButton.append(trackDuration);

    playButton.addEventListener("click", () => playSearchResult(index));
    item.append(playButton, createTrackActions(video));
    searchResults.append(item);
  });
  updateQueueUi();
}

function renderRankingSkeleton() {
  if (!homeRankingList) {
    return;
  }
  homeRankingList.replaceChildren();
  for (let index = 0; index < 8; index += 1) {
    const item = document.createElement("li");
    item.className = "track-row skeleton-row";
    item.innerHTML = `
      <span class="track skeleton-track">
        <span class="skeleton-cover"></span>
        <span class="skeleton-meta">
          <span></span>
          <small></small>
        </span>
      </span>
    `;
    homeRankingList.append(item);
  }
}

function renderHomeRanking() {
  if (!homeRankingList) {
    return;
  }
  homeRankingList.replaceChildren();
  if (homeState.loading) {
    renderRankingSkeleton();
    return;
  }
  if (homeState.error) {
    homeRankingError.textContent = "拉取失败，点击重试";
    return;
  }
  homeRankingError.textContent = "";
  for (const [index, video] of homeState.ranking.entries()) {
    homeRankingList.append(
      createTrackRow(
        video,
        index,
        (targetIndex) => playListItem("ranking", homeState.ranking, targetIndex),
      ),
    );
  }
  updateQueueUi();
}

async function loadHomeRanking({ forceRefresh = false } = {}) {
  if (!forceRefresh && homeState.loaded && homeState.ranking.length > 0) {
    renderHomeRanking();
    return;
  }
  homeState.loading = true;
  homeState.error = "";
  homeRankingStatus.textContent = forceRefresh
    ? "正在刷新音乐飙升榜…"
    : "正在拉取 B站音乐区热门内容…";
  refreshRankingButton.disabled = true;
  renderHomeRanking();
  try {
    const tracks = await invoke("get_music_ranking", { forceRefresh });
    homeState.ranking = tracks.map(normalizeTrack);
    homeState.loaded = true;
    homeState.error = "";
    homeRankingStatus.textContent = `已加载 ${homeState.ranking.length} 首音乐区热门视频。`;
  } catch (error) {
    homeState.error = String(error);
    homeRankingStatus.textContent = "音乐飙升榜拉取失败。";
    homeRankingError.textContent = "拉取失败，点击重试";
    console.error("music ranking load failed:", error);
  } finally {
    homeState.loading = false;
    refreshRankingButton.disabled = false;
    renderHomeRanking();
  }
}

function renderLibraryViews() {
  renderFavorites();
  renderPlaylists();
  updateFavoriteButtons();
  updateLibraryHighlights();
}

function renderFavorites() {
  if (!favoritesList) {
    return;
  }
  favoritesList.replaceChildren();
  favoritesCount.textContent = `${libraryState.favorites.length} 首`;
  if (libraryState.loadError) {
    favoritesStatus.textContent = libraryState.loadError;
    return;
  }
  favoritesStatus.textContent = libraryState.favorites.length
    ? "点击歌曲即可从收藏开始播放。"
    : "收藏的歌曲会显示在这里。";
  for (const [index, video] of libraryState.favorites.entries()) {
    favoritesList.append(
      createTrackRow(
        video,
        index,
        (targetIndex) => playListItem("favorites", libraryState.favorites, targetIndex),
      ),
    );
  }
}

function renderPlaylists() {
  if (!playlistsList) {
    return;
  }
  playlistsList.replaceChildren();
  const selectedPlaylist =
    libraryState.playlists.find((playlist) => playlist.id === libraryState.selectedPlaylistId) ??
    libraryState.playlists[0] ??
    null;
  libraryState.selectedPlaylistId = selectedPlaylist?.id ?? "";

  playlistsStatus.textContent = libraryState.playlists.length
    ? `${libraryState.playlists.length} 个歌单`
    : "还没有歌单。";

  for (const playlist of libraryState.playlists) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "playlist-card";
    button.classList.toggle("is-selected", playlist.id === libraryState.selectedPlaylistId);
    button.dataset.playlistId = playlist.id;
    button.innerHTML = `<span>${escapeText(playlist.name)}</span><small>${playlist.items.length} 首</small>`;
    button.addEventListener("click", () => {
      libraryState.selectedPlaylistId = playlist.id;
      renderPlaylists();
    });
    item.append(button);
    playlistsList.append(item);
  }

  playlistTracks.replaceChildren();
  playlistActions.hidden = !selectedPlaylist;
  if (!selectedPlaylist) {
    playlistTitle.textContent = "选择一个歌单";
    playlistMeta.textContent = "歌单里的歌曲会显示在这里。";
    return;
  }

  playlistTitle.textContent = selectedPlaylist.name;
  playlistMeta.textContent = `${selectedPlaylist.items.length} 首歌曲`;
  for (const [index, video] of selectedPlaylist.items.entries()) {
    playlistTracks.append(
      createTrackRow(
        video,
        index,
        (targetIndex) =>
          playListItem("playlist", selectedPlaylist.items, targetIndex, {
            playlistId: selectedPlaylist.id,
          }),
        { playlistId: selectedPlaylist.id },
      ),
    );
  }
}

function updateLibraryHighlights() {
  if (favoritesList) {
    for (const button of favoritesList.querySelectorAll("button.track")) {
      const index = Number(button.dataset.libraryIndex);
      if (playerState.queueSource === "favorites" && index === playerState.currentIndex) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  }
  if (playlistTracks) {
    for (const button of playlistTracks.querySelectorAll("button.track")) {
      const index = Number(button.dataset.libraryIndex);
      if (
        playerState.queueSource === "playlist" &&
        playerState.queuePlaylistId === libraryState.selectedPlaylistId &&
        index === playerState.currentIndex
      ) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  }
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadLibrary() {
  try {
    const [favorites, playlists] = await Promise.all([
      invoke("list_favorites"),
      invoke("list_playlists"),
    ]);
    libraryState.favorites = favorites.map(normalizeTrack);
    libraryState.favoriteBvids = new Set(
      libraryState.favorites.map((track) => track.bvid.toLowerCase()),
    );
    libraryState.playlists = playlists.map((playlist) => ({
      ...playlist,
      items: (playlist.items ?? []).map(normalizeTrack),
    }));
    libraryState.loadError = "";
  } catch (error) {
    libraryState.favorites = [];
    libraryState.favoriteBvids = new Set();
    libraryState.playlists = [];
    libraryState.loadError = `本地资料库读取失败：${error}`;
    console.error("library load failed:", error);
  }
  renderLibraryViews();
}

async function toggleFavorite(video = currentPlayableTrack()) {
  const track = video ? snapshotForLibrary(video) : null;
  if (!track?.bvid) {
    status.textContent = "请先选择一首歌曲。";
    return;
  }
  try {
    const result = await invoke("toggle_favorite", { track });
    libraryState.favorites = result.items.map(normalizeTrack);
    libraryState.favoriteBvids = new Set(
      libraryState.favorites.map((item) => item.bvid.toLowerCase()),
    );
    renderLibraryViews();
    status.textContent = result.favorited ? "已加入收藏。" : "已取消收藏。";
  } catch (error) {
    status.textContent = `收藏操作失败：${error}`;
  }
}

function openLibraryModal(title, subtitle) {
  libraryModalTitle.textContent = title;
  libraryModalSubtitle.textContent = subtitle;
  libraryModalBody.replaceChildren();
  libraryModalStatus.textContent = "";
  libraryModal.hidden = false;
  requestAnimationFrame(() => {
    libraryModal.classList.add("is-open");
    libraryModal.setAttribute("aria-hidden", "false");
  });
}

function closeLibraryModal() {
  libraryModal.classList.remove("is-open");
  libraryModal.setAttribute("aria-hidden", "true");
}

function validatePlaylistName(name, { excludeId = "" } = {}) {
  const normalized = name.trim();
  if (!normalized) {
    return { ok: false, message: "歌单名不能为空。" };
  }
  const duplicated = libraryState.playlists.some(
    (playlist) =>
      playlist.id !== excludeId &&
      playlist.name.trim().toLocaleLowerCase() === normalized.toLocaleLowerCase(),
  );
  if (duplicated) {
    return { ok: false, message: "已存在同名歌单，请换个名字。" };
  }
  return { ok: true, name: normalized };
}

function createNameField(initialValue = "") {
  const field = document.createElement("label");
  const label = document.createElement("span");
  const input = document.createElement("input");
  field.className = "library-name-field";
  label.textContent = "歌单名称";
  input.type = "text";
  input.maxLength = 40;
  input.value = initialValue;
  input.placeholder = "输入歌单名称";
  field.append(label, input);
  return { field, input };
}

function createLibraryActions(primaryLabel, onPrimary, secondaryLabel = "取消") {
  const actions = document.createElement("div");
  const cancelButton = document.createElement("button");
  const primaryButton = document.createElement("button");
  actions.className = "library-modal-actions";
  cancelButton.type = "button";
  cancelButton.className = "small-button quiet";
  cancelButton.textContent = secondaryLabel;
  cancelButton.addEventListener("click", closeLibraryModal);
  primaryButton.type = "button";
  primaryButton.className = "secondary-button";
  primaryButton.textContent = primaryLabel;
  primaryButton.addEventListener("click", onPrimary);
  actions.append(cancelButton, primaryButton);
  return { actions, primaryButton };
}

function showPlaylistNameDialog({ mode, playlist = null, track = null } = {}) {
  const isRename = mode === "rename";
  openLibraryModal(
    isRename ? "重命名歌单" : "新建歌单",
    isRename ? "换一个清晰的名字，方便之后找到。" : "创建后可以继续加入当前歌曲。",
  );

  const { field, input } = createNameField(isRename ? playlist?.name ?? "" : "");
  const { actions, primaryButton } = createLibraryActions(
    isRename ? "保存" : track ? "新建并加入" : "创建",
    async () => {
      const validation = validatePlaylistName(input.value, {
        excludeId: playlist?.id ?? "",
      });
      if (!validation.ok) {
        libraryModalStatus.textContent = validation.message;
        input.focus();
        return;
      }
      primaryButton.disabled = true;
      libraryModalStatus.textContent = isRename ? "正在保存…" : "正在创建…";
      try {
        if (isRename) {
          libraryState.playlists = await invoke("rename_playlist", {
            id: playlist.id,
            name: validation.name,
          });
        } else {
          const knownIds = new Set(libraryState.playlists.map((item) => item.id));
          libraryState.playlists = await invoke("create_playlist", {
            name: validation.name,
          });
          const created =
            libraryState.playlists.find((item) => !knownIds.has(item.id)) ??
            libraryState.playlists.at(-1);
          if (created) {
            libraryState.selectedPlaylistId = created.id;
            if (track) {
              libraryState.playlists = await invoke("add_to_playlist", {
                id: created.id,
                track,
              });
              status.textContent = `已加入歌单“${created.name}”。`;
            }
          }
        }
        renderLibraryViews();
        closeLibraryModal();
      } catch (error) {
        libraryModalStatus.textContent = `${isRename ? "改名" : "新建"}失败：${error}`;
      } finally {
        primaryButton.disabled = false;
      }
    },
  );
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      primaryButton.click();
    }
  });
  libraryModalBody.append(field, actions);
  input.focus();
  input.select();
}

function createPlaylist() {
  showPlaylistNameDialog({ mode: "create" });
}

function renameSelectedPlaylist() {
  const playlist = selectedPlaylist();
  if (!playlist) {
    return;
  }
  showPlaylistNameDialog({ mode: "rename", playlist });
}

function deleteSelectedPlaylist() {
  const playlist = selectedPlaylist();
  if (!playlist) {
    return;
  }
  openLibraryModal("删除歌单", `确认删除“${playlist.name}”？歌曲本身不会被删除。`);
  const message = document.createElement("p");
  message.className = "library-confirm-copy";
  message.textContent = "这个操作会移除歌单和其中的条目，之后需要重新创建。";
  const { actions, primaryButton } = createLibraryActions("删除", async () => {
    primaryButton.disabled = true;
    libraryModalStatus.textContent = "正在删除…";
    try {
      libraryState.playlists = await invoke("delete_playlist", { id: playlist.id });
      libraryState.selectedPlaylistId = libraryState.playlists[0]?.id ?? "";
      renderLibraryViews();
      closeLibraryModal();
    } catch (error) {
      libraryModalStatus.textContent = `删除失败：${error}`;
    } finally {
      primaryButton.disabled = false;
    }
  });
  primaryButton.classList.add("danger-action");
  libraryModalBody.append(message, actions);
}

function choosePlaylistAndAdd(video = currentPlayableTrack()) {
  const track = video ? snapshotForLibrary(video) : null;
  if (!track?.bvid) {
    status.textContent = "请先选择一首歌曲。";
    return;
  }
  openLibraryModal("加入歌单", "选择一个歌单，或新建后加入。");
  const list = document.createElement("div");
  list.className = "playlist-picker";

  if (libraryState.playlists.length === 0) {
    const empty = document.createElement("p");
    empty.className = "library-empty-copy";
    empty.textContent = "还没有歌单。先在下方新建一个，再把这首歌放进去。";
    list.append(empty);
  } else {
    for (const playlist of libraryState.playlists) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "playlist-choice";
      button.innerHTML = `<span>${escapeText(playlist.name)}</span><small>${playlist.items.length} 首</small>`;
      button.addEventListener("click", () => addTrackToPlaylist(playlist, track));
      list.append(button);
    }
  }

  const divider = document.createElement("div");
  divider.className = "library-divider";
  divider.textContent = "新建歌单";
  const { field, input } = createNameField("");
  const { actions, primaryButton } = createLibraryActions("新建并加入", async () => {
    const validation = validatePlaylistName(input.value);
    if (!validation.ok) {
      libraryModalStatus.textContent = validation.message;
      input.focus();
      return;
    }
    primaryButton.disabled = true;
    libraryModalStatus.textContent = "正在创建…";
    try {
      const knownIds = new Set(libraryState.playlists.map((item) => item.id));
      libraryState.playlists = await invoke("create_playlist", { name: validation.name });
      const created =
        libraryState.playlists.find((item) => !knownIds.has(item.id)) ??
        libraryState.playlists.at(-1);
      if (created) {
        await addTrackToPlaylist(created, track);
      }
    } catch (error) {
      libraryModalStatus.textContent = `新建歌单失败：${error}`;
    } finally {
      primaryButton.disabled = false;
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      primaryButton.click();
    }
  });
  libraryModalBody.append(list, divider, field, actions);
}

async function addTrackToPlaylist(playlist, track) {
  libraryModalStatus.textContent = `正在加入“${playlist.name}”…`;
  try {
    libraryState.playlists = await invoke("add_to_playlist", {
      id: playlist.id,
      track,
    });
    libraryState.selectedPlaylistId = playlist.id;
    renderLibraryViews();
    status.textContent = `已加入歌单“${playlist.name}”。`;
    closeLibraryModal();
  } catch (error) {
    libraryModalStatus.textContent = `加入歌单失败：${error}`;
  }
}

async function removeTrackFromPlaylist(id, bvid) {
  try {
    libraryState.playlists = await invoke("remove_from_playlist", { id, bvid });
    renderLibraryViews();
  } catch (error) {
    playlistsStatus.textContent = `移除失败：${error}`;
  }
}

function selectedPlaylist() {
  return libraryState.playlists.find(
    (playlist) => playlist.id === libraryState.selectedPlaylistId,
  );
}

async function loadCurrentTrack() {
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
    const info = await invoke("prepare_audio", { bvId: video.bvid });
    if (requestVersion !== playerState.requestVersion) {
      return;
    }
    playerState.consecutiveResolveFailures = 0;

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
    thumbnail.src = displayThumbnailUrl(info.thumbnailUrl);
    title.textContent = info.title;
    uploader.textContent = info.uploader;
    duration.textContent = formatDuration(info.durationSeconds);
    emitCurrentTrackChanged();
    playerState.activeAudioVersion = requestVersion;
    playerState.activeAudioUrl = info.audioUrl;
    playerState.audioActivatedAt = performance.now();
    audio.src = info.audioUrl;
    audio.load();
    renderSearchResults();

    try {
      await audio.play();
      if (requestVersion === playerState.requestVersion) {
        status.textContent = "在线播放中。";
      }
    } catch {
      if (requestVersion === playerState.requestVersion) {
        status.textContent = "音频已就绪，点击播放。";
      }
    }
  } catch (error) {
    if (requestVersion !== playerState.requestVersion) {
      return;
    }

    console.error(`prepare_audio failed for ${video.bvid}:`, error);

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

    const advanced = playNext({ automatic: true, skipFailed: true });
    if (advanced) {
      showPlaybackNotice("该视频无法播放，已自动跳过。");
    } else {
      const message = "该视频无法播放，队列中没有可继续播放的内容。";
      status.textContent = message;
      showPlaybackNotice(message, { persistent: true });
    }
  } finally {
    if (requestVersion === playerState.requestVersion) {
      searchButton.disabled = false;
    }
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

function playSearchResult(index) {
  if (index < 0 || index >= searchState.results.length) {
    return;
  }

  playListItem("search", searchState.results, index, {
    searchVersion: searchState.requestVersion,
  });
}

function playListItem(source, videos, index, { searchVersion = null, playlistId = null } = {}) {
  if (index < 0 || index >= videos.length) {
    return;
  }

  playerState.queue = videos.map(normalizeTrack);
  playerState.queueSource = source;
  playerState.queueSearchVersion = source === "search" ? searchVersion : null;
  playerState.queuePlaylistId = source === "playlist" ? playlistId : null;
  playerState.currentIndex = -1;
  playerState.history = [];
  playerState.consecutiveResolveFailures = 0;
  clearPlaybackNotice();
  resetRandomRemaining();
  playQueueIndex(index, { recordCurrent: false });
}

function playQueueIndex(
  index,
  { recordCurrent = true, preserveFailureStreak = false } = {},
) {
  if (index < 0 || index >= playerState.queue.length) {
    return;
  }

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
    playerState.history.push(previousIndex);
  }
  playerState.currentIndex = index;
  markRandomIndexPlayed(index);
  updateQueueUi();
  emitCurrentTrackChanged();
  loadCurrentTrack();
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

function playNext({ automatic = false, skipFailed = false } = {}) {
  if (playerState.currentIndex < 0) {
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
    status.textContent = automatic ? "队列播放完毕。" : "已到队列末尾。";
    return false;
  }
  playQueueIndex(nextIndex, { preserveFailureStreak: skipFailed });
  return true;
}

function playPrevious() {
  if (playerState.currentIndex < 0) {
    return;
  }

  const historicalIndex = playerState.history.pop();
  if (historicalIndex !== undefined) {
    playQueueIndex(historicalIndex, { recordCurrent: false });
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
    status.textContent = "没有上一首。";
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

function currentSearchRequest(userKeyword) {
  const trimmed = userKeyword.trim();
  if (trimmed) {
    return {
      userKeyword: trimmed,
      requestKeyword: trimmed,
      order: null,
    };
  }
  return {
    userKeyword: "",
    requestKeyword: MUSIC_HOT_KEYWORD,
    order: "click",
  };
}

async function runSearch({ userKeyword = searchKeyword.value.trim(), recordHistory = false } = {}) {
  const query = currentSearchRequest(userKeyword);
  searchButton.disabled = true;
  searchStatus.textContent = query.userKeyword ? "正在搜索…" : "正在加载该分区热门…";
  const requestVersion = ++searchState.requestVersion;
  searchState.userKeyword = query.userKeyword;
  searchState.requestKeyword = query.requestKeyword;
  searchState.order = query.order;
  searchState.page = 1;
  searchState.hasMore = false;
  searchState.isLoadingMore = false;

  try {
    const payload = {
      keyword: searchState.requestKeyword,
      page: 1,
      tids: searchState.tids,
    };
    if (searchState.order) {
      payload.order = searchState.order;
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
    const modeLabel = searchState.userKeyword ? "" : "（分区热门）";
    searchStatus.textContent = videos.length
      ? searchState.hasMore
        ? `找到 ${videos.length} 个普通视频${modeLabel}。`
        : `找到 ${videos.length} 个普通视频${modeLabel}。没有更多了`
      : "没有找到普通视频。";
  } catch (error) {
    if (requestVersion !== searchState.requestVersion) {
      return;
    }
    searchStatus.textContent = `搜索失败：${error}`;
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
    searchState.userKeyword = "";
    searchState.requestKeyword = "";
    searchState.order = null;
    searchState.page = 0;
    searchState.hasMore = false;
    searchState.isLoadingMore = false;
    searchState.requestVersion += 1;
    setSearchResults([]);
    await cancelCurrentPlayback();
    playBvId(query);
    searchStatus.textContent = `已识别 BV 号：${query}`;
    return;
  }

  await runSearch({ userKeyword: query, recordHistory: true });
  return;

  searchButton.disabled = true;
  searchStatus.textContent = "正在搜索…";
  const requestVersion = ++searchState.requestVersion;
  searchState.userKeyword = query;
  searchState.page = 1;
  searchState.hasMore = false;
  searchState.isLoadingMore = false;

  try {
    const searchRequest = invoke("search_videos", {
      keyword: query,
      page: 1,
    });
    recordSearchHistoryFireAndForget(query);
    const videos = await searchRequest;
    if (requestVersion !== searchState.requestVersion) {
      return;
    }
    setSearchResults(videos);
    result.hidden = false;
    searchState.hasMore = videos.length >= SEARCH_PAGE_SIZE;
    searchStatus.textContent = videos.length
      ? searchState.hasMore
        ? `找到 ${videos.length} 个普通视频。`
        : `找到 ${videos.length} 个普通视频。没有更多了`
      : "没有找到普通视频。";
  } catch (error) {
    if (requestVersion !== searchState.requestVersion) {
      return;
    }
    searchStatus.textContent = `搜索失败：${error}`;
  } finally {
    if (requestVersion === searchState.requestVersion) {
      searchButton.disabled = false;
    }
  }
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
    const videos = await invoke("search_videos", {
      keyword: searchState.requestKeyword,
      page: nextPage,
      tids: searchState.tids,
      order: searchState.order,
    });
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

previousButton.addEventListener("click", playPrevious);
nextButton.addEventListener("click", () => playNext());
audio.addEventListener("ended", (event) => {
  const belongsToCurrentAudio =
    playerState.activeAudioVersion === playerState.requestVersion &&
    playerState.activeAudioUrl === audio.currentSrc &&
    event.timeStamp >= playerState.audioActivatedAt;
  if (belongsToCurrentAudio && audio.ended) {
    playNext({ automatic: true });
  }
});

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
  if (playerState.shuffle) {
    resetRandomRemaining();
  } else {
    playerState.randomRemaining = [];
  }
  updateQueueUi();
});

favoriteCurrentButton?.addEventListener("click", () => toggleFavorite());
immersiveFavoriteButton?.addEventListener("click", () => toggleFavorite());
createPlaylistButton?.addEventListener("click", createPlaylist);
renamePlaylistButton?.addEventListener("click", renameSelectedPlaylist);
deletePlaylistButton?.addEventListener("click", deleteSelectedPlaylist);
refreshRankingButton?.addEventListener("click", () => loadHomeRanking({ forceRefresh: true }));
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
homeRankingError?.addEventListener("click", () => {
  if (homeState.error) {
    loadHomeRanking({ forceRefresh: true });
  }
});
closeLibraryModalButton?.addEventListener("click", closeLibraryModal);
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
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && libraryModal?.classList.contains("is-open")) {
    closeLibraryModal();
  }
});

window.addEventListener("bilibili-music-viewchange", (event) => {
  if (event.detail?.view === "home") {
    loadHomeRanking();
  }
  if (["favorites", "playlists"].includes(event.detail?.view)) {
    loadLibrary();
  }
});

loadHomeRanking();
loadLibrary();
updateMusicTabs();
updateQueueUi();
emitCurrentTrackChanged();
