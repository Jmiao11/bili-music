import { findEnabledPageIndex, isPageDisabled, pickRandomEnabledPageIndex } from "./page-selection.ts";
import { buildDisplayTrack, displayThumbnailUrl, formatDuration, formatPlayCount, isBvId, normalizeTrack, normalizeVideoPage, playbackFailureMessage, playbackTrackSnapshot, shouldOpenPastedBvPages, unavailableTrackReason } from "./track-utils.ts";
import type { SearchPageCommit } from "./search-state.ts";
import { invoke } from "./runtime-api.ts";
import { audio, duration, favoriteCurrentButton, homeRankingList, immersiveFavoriteButton, immersiveResumeCurrentTimeLabel, immersiveResumeDurationLabel, immersiveResumeProgressSlider, loopModeButton, nextButton, playerPagesButton, playerPagesGroup, previousButton, queueCount, queuePosition, result, resumeCurrentTimeLabel, resumePlayPauseButton, resumeProgressSlider, searchForm, searchKeyword, searchResults, shuffleToggle, status, thumbnail, title, uploader } from "./player-dom.ts";
import { LOOP_MODES, MAX_AUDIO_RECOVERIES, MAX_CONSECUTIVE_RESOLVE_FAILURES, PLAYBACK_STATE_SAVE_INTERVAL_MS, playerState } from "./player-state.ts";
import { lufsToGain, readShuffleCollectionPrefs, shouldRecoverAudio } from "./playback-policy.ts";
import { clearPlaybackNotice, showPlaybackNotice } from "./playback-notice.ts";
import { getApplicationStore, getHomeSnapshot } from "./home.ts";
import { choosePlaylistAndAdd, clearLibraryUnavailable, getLibrarySnapshot, markLibraryUnavailable, openLoudnessModal, removeTrackFromPlaylist, renderLibraryViews, toggleFavorite, updateLibraryHighlights } from "./library-ui.ts";
import { bindTrackActivation, openCurrentPagesModal } from "./video-pages.ts";
import { appendSearchDisplay, fillSearchMetadata, getSearchSnapshot, recognizeSearchBv, renderSearchResults, resetSearchForBv, runSearch, setSearchPlaybackBusy } from "./search.ts";
import { isLoudnessNormalizationEnabled, setNormalizationGain } from "./appearance.ts";

type PlaybackStartPage = Partial<Omit<CommandContract.VideoPage, "page" | "cid"> & Pick<CommandContract.PlaybackState, "page" | "cid">>;

let playRecordedForCurrentTrack = false;
let cacheRequestedForCurrentTrack = false;
let cacheRequestPromise: Promise<void> | null = null;
let pendingResume: Pick<CommandContract.PlaybackState, "positionSeconds" | "page" | "cid"> | null = null;
let resumeInProgress = false;
let lastPlaybackStateSavedAt = Number.NEGATIVE_INFINITY;
let recoveryPromise: Promise<void> | null = null;
let recoveryVersion = -1;
let recoveryAttempts = 0;
let playingAudioVersion = -1;
let playbackIntended = false;

let pendingPastedBvPages: { bvid: string; requestVersion: number } | null = null;

function getQueueSnapshot() { return getApplicationStore().getState().playbackQueue; }
function getQueueActions() { return getApplicationStore().actions.playbackQueue; }

function currentTrackSnapshot() {
  const displayTrack = getQueueSnapshot().currentDisplayTrack;
  if (
    displayTrack &&
    playerState.currentPages.length > 1 &&
    getQueueSnapshot().currentIndex >= 0 &&
    getQueueSnapshot().currentIndex < getQueueSnapshot().queue.length
  ) {
    return {
      ...displayTrack,
      hasCurrent: true,
    };
  }

  const video = getQueueSnapshot().queue[getQueueSnapshot().currentIndex];
  return {
    bvid: video?.bvid ?? "",
    title: video?.title ?? "尚未播放",
    uploader: video?.uploader ?? "—",
    thumbnailUrl: displayThumbnailUrl(video?.thumbnailUrl ?? ""),
    durationSeconds: Number(video?.durationSeconds) || 0,
    hasCurrent:
      getQueueSnapshot().currentIndex >= 0 &&
      getQueueSnapshot().currentIndex < getQueueSnapshot().queue.length,
  };
}

function currentPlayableTrack(): CommandContract.TrackSnapshotInput | null {
  if (
    getQueueSnapshot().currentIndex < 0 ||
    getQueueSnapshot().currentIndex >= getQueueSnapshot().queue.length
  ) {
    return null;
  }
  const track = normalizeTrack(getQueueSnapshot().queue[getQueueSnapshot().currentIndex]);
  return track.bvid ? track : null;
}

function resetCurrentPageState() {
  playerState.currentPages = [];
  getQueueActions().resetPage();
  updatePlayerPagesButton();
}

function hasMultipleCurrentPages() {
  return playerState.currentPages.length > 1;
}

function currentVideoPage() {
  if (!hasMultipleCurrentPages()) {
    return null;
  }
  return playerState.currentPages[getQueueSnapshot().currentPageIndex] ?? null;
}

function currentAudioCacheCid() {
  return currentVideoPage()?.cid ?? playerState.currentPages[0]?.cid ?? null;
}

function updatePlayerPagesButton() {
  const pageCount = playerState.currentPages.length;
  const hasCurrent =
    getQueueSnapshot().currentIndex >= 0 &&
    getQueueSnapshot().currentIndex < getQueueSnapshot().queue.length;
  playerPagesButton.hidden = !hasCurrent || pageCount <= 1;
  if (!playerPagesButton.hidden) {
    const currentPage = Math.min(getQueueSnapshot().currentPageIndex + 1, pageCount);
    playerPagesButton.textContent = `P${currentPage}/${pageCount}`;
    playerPagesButton.title = "查看分P";
    playerPagesButton.setAttribute(
      "aria-label",
      `查看分P，当前第 ${currentPage} 个，共 ${pageCount} 个`,
    );
  }
  if (playerPagesGroup) playerPagesGroup.hidden = playerPagesButton.hidden;
}

async function loadPagesForCurrentVideo(video: CommandContract.TrackSnapshotInput, requestVersion: number) {
  resetCurrentPageState();
  try {
    const pages = await invoke("get_video_pages", { bvId: video.bvid });
    if (requestVersion !== playerState.requestVersion) {
      return false;
    }
    playerState.currentPages = (Array.isArray(pages) ? pages : [])
      .map(normalizeVideoPage)
      .filter((page) => page.cid > 0);
    getQueueActions().selectPage(0);
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
  const snapshot = currentTrackSnapshot();
  const cid = currentAudioCacheCid();
  const identity = JSON.stringify([snapshot.bvid, cid === null ? "page" : "cid", cid ?? getQueueSnapshot().currentPageIndex]);
  if (identity !== playerState.lastEmittedTrackIdentity) {
    playerState.lastEmittedTrackIdentity = identity;
    playRecordedForCurrentTrack = false;
    loudnessAnalyzedForCurrentTrack = false;
    cacheRequestedForCurrentTrack = false;
    cacheRequestPromise = null;
  }
  window.dispatchEvent(
    new CustomEvent("bilibili-music-trackchange", {
      detail: snapshot,
    }),
  );
}

function resetRandomRemaining() { getQueueActions().resetRandom(Math.random); }

function markRandomIndexPlayed(index: number) { getQueueActions().markPlayed(index); }

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
  setSearchPlaybackBusy(false);
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
  if (getQueueSnapshot().queue.length === 0) {
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
      queue: getQueueSnapshot().queue.map(playbackTrackSnapshot),
      currentIndex: Math.max(
        0,
        Math.min(getQueueSnapshot().currentIndex, getQueueSnapshot().queue.length - 1),
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

function renderRestoredPlaybackUi(track: CommandContract.TrackSnapshotInput, positionSeconds: number) {
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
      getQueueSnapshot().queue.length > 0 ||
      getQueueSnapshot().currentIndex >= 0 ||
      audio.currentSrc
    ) {
      return;
    }

    setQueue(state.queue, { save: false });
    getQueueActions().restoreSelection(state.currentIndex);
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

function setQueue(videos: readonly CommandContract.TrackSnapshotInput[], { save = true } = {}) {
  clearPendingResume();
  getQueueActions().replaceQueue(videos);
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

function appendSearchResults(videos: readonly CommandContract.SearchVideo[], page?: SearchPageCommit) {
  const uniqueVideos = appendSearchDisplay(videos, (unique) => {
    if (getQueueActions().appendSearchQueue(unique, getSearchSnapshot().requestVersion, Math.random)) {
      savePlaybackState();
    }
  }, page);
  if (uniqueVideos.length === 0) {
    updateQueueUi();
    return 0;
  }
  updateQueueUi();
  emitCurrentTrackChanged();
  return uniqueVideos.length;
}

function updateQueueUi() {
  const hasCurrent =
    getQueueSnapshot().currentIndex >= 0 &&
    getQueueSnapshot().currentIndex < getQueueSnapshot().queue.length;
  queueCount.textContent = `${getSearchSnapshot().results.length} 首`;
  queuePosition.textContent = hasCurrent
    ? `♪${getQueueSnapshot().currentIndex + 1}/${getQueueSnapshot().queue.length}`
    : `♪0/${getQueueSnapshot().queue.length}`;
  previousButton.disabled = false;
  nextButton.disabled = false;

  const loopMode = LOOP_MODES.find(
    (candidate) => candidate.id === getQueueSnapshot().loopMode,
  );
  loopModeButton.dataset.loopMode = getQueueSnapshot().loopMode;
  if (!loopMode) return;
  loopModeButton.title = getQueueSnapshot().loopMode === "sequence" ? "关闭循环" : loopMode.label;
  loopModeButton.setAttribute("aria-label", loopModeButton.title);
  loopModeButton.classList.toggle("is-active", getQueueSnapshot().loopMode !== "sequence");
  shuffleToggle.checked = getQueueSnapshot().shuffle;

  for (const queueButton of [
    ...searchResults.querySelectorAll<HTMLButtonElement>("button[data-result-index]"),
  ]) {
    const index = Number(queueButton.dataset.resultIndex);
    if (
      getQueueSnapshot().queueSearchVersion === getSearchSnapshot().requestVersion &&
      index === getQueueSnapshot().currentIndex
    ) {
      queueButton.setAttribute("aria-current", "true");
    } else {
      queueButton.removeAttribute("aria-current");
    }
  }
  if (homeRankingList) {
    for (const rankingButton of homeRankingList.querySelectorAll<HTMLButtonElement>("button.track")) {
      const index = Number(rankingButton.dataset.libraryIndex);
      const activeHomeSource =
        getHomeSnapshot().mode === "recommendation" ? "recommendation" : "ranking";
      if (getQueueSnapshot().queueSource === activeHomeSource && index === getQueueSnapshot().currentIndex) {
        rankingButton.setAttribute("aria-current", "true");
      } else {
        rankingButton.removeAttribute("aria-current");
      }
    }
  }
  updateFavoriteButtons();
  updateLibraryHighlights();
}

function isFavorited(bvid: string) {
  return getLibrarySnapshot().favoriteBvids.has(String(bvid ?? "").toLowerCase());
}

function setFavoriteButtonState(button: HTMLButtonElement, bvid: string) {
  const favorited = isFavorited(bvid);
  button.classList.toggle("is-favorited", favorited);
  button.textContent = favorited ? "♥" : "♡";
  button.title = favorited ? "取消收藏" : "收藏";
  button.setAttribute("aria-label", favorited ? "取消收藏" : "收藏");
}

function updateFavoriteButtons() {
  for (const button of document.querySelectorAll<HTMLButtonElement & { dataset: DOMStringMap & { favoriteBvid: string } }>("[data-favorite-bvid]")) {
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

function createTrackActions(video: CommandContract.TrackSnapshotInput, { playlistId = "" } = {}) {
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

function createTrackRow(video: CommandContract.TrackSnapshotInput & { playCount?: number | null }, index: number, onPlay: (index: number, pageSelection?: Parameters<Parameters<typeof bindTrackActivation>[3]>[0]) => void, options: { showPlayCount?: boolean; playlistId?: string } = {}) {
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
  const unavailableReason = getLibrarySnapshot().unavailableBvids.get(video.bvid.toLowerCase());
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

function playCurrentVideoPage(page: CommandContract.VideoPage) {
  clearPendingResume();
  const pageIndex = playerState.currentPages.findIndex(
    (candidate) => candidate.cid === page.cid || candidate.page === page.page,
  );
  if (pageIndex < 0 || pageIndex === getQueueSnapshot().currentPageIndex) {
    return;
  }
  getQueueActions().selectPage(pageIndex);
  updatePlayerPagesButton();
  loadCurrentTrack({ keepPage: true });
}


function showLoudnessNormalizationDialog() {
  openLoudnessModal();
}

function waitForAudioMetadata() {
  return waitForRecoveryMetadata(playerState.requestVersion);
}

function recoveryAttemptsFor(version: number) {
  if (recoveryVersion !== version) {
    recoveryVersion = version;
    recoveryAttempts = 0;
  }
  return recoveryAttempts;
}

function refundRecoveryAttempt(version: number) {
  if (recoveryVersion === version) recoveryAttempts -= 1;
}

function waitForRecoveryMetadata(version: number) {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve(true);
  return new Promise<boolean>((resolve, reject) => {
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

async function recoverCurrentAudio(version: number, sourceUrl: string, position: number, wasPlaying: boolean) {
  if (version !== playerState.requestVersion || sourceUrl !== playerState.activeAudioUrl) {
    window.recordPlaybackDiag("audio-recovery", "abandoned before prepare_audio");
    return;
  }
  const video = getQueueSnapshot().queue[getQueueSnapshot().currentIndex];
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

function handleAudioRecoveryError(event: Event) {
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

function refreshTrackLoudness() {
  const queryVersion = ++loudnessQueryVersion;
  const requestVersion = playerState.requestVersion;
  setNormalizationGain(1);
  if (!isLoudnessNormalizationEnabled()) return;
  const bvid = getQueueSnapshot().queue[getQueueSnapshot().currentIndex]?.bvid;
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
  const bvid = getQueueSnapshot().queue[getQueueSnapshot().currentIndex]?.bvid;
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
}: { keepPage?: boolean; startPage?: PlaybackStartPage | null; resumePosition?: number | null; randomStartPage?: boolean } = {}) {
  const index = getQueueSnapshot().currentIndex;
  const video = getQueueSnapshot().queue[index];
  if (!video) {
    return;
  }

  const requestVersion = ++playerState.requestVersion;
  stopAudioElement();
  setSearchPlaybackBusy(true);
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
      const isDisabled = (page: CommandContract.VideoPage) => isPageDisabled(getLibrarySnapshot().disabledPages, video.bvid, page.cid);
      const pageIndex = random
        ? pickRandomEnabledPageIndex(playerState.currentPages, isDisabled, Math.random)
        : findEnabledPageIndex(playerState.currentPages, 0, 1, isDisabled);
      if (pageIndex < 0) throw new Error("all pages disabled by user");
      getQueueActions().selectPage(pageIndex);
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
        getQueueActions().selectPage(startPageIndex);
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
    if (clearLibraryUnavailable(unavailableKey)) {
      invoke("clear_track_unavailable", { bvid: video.bvid })
        .catch((error) => console.warn("unavailable track clear failed:", error));
      renderLibraryViews();
    }

    const displayTrack = buildDisplayTrack(video, info, page);
    getQueueActions().setDisplayTrack(displayTrack);
    if (!displayTrack) {
      getQueueActions().fillTrackMetadata(index, {
        title: info.title,
        uploader: info.uploader,
        thumbnailUrl: displayThumbnailUrl(info.thumbnailUrl),
        durationSeconds: info.durationSeconds,
      });
      if (
        getQueueSnapshot().queueSearchVersion === getSearchSnapshot().requestVersion &&
        getSearchSnapshot().results[index]
      ) {
        fillSearchMetadata(index, getSearchSnapshot().requestVersion, {
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
      markLibraryUnavailable(video.bvid.toLowerCase(), unavailableReason);
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
      setSearchPlaybackBusy(false);
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

function playBvId(bvId: string) {
  const queueIndex = getQueueSnapshot().queue.findIndex(
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

function playSearchResult(index: number, pageSelection: Parameters<Parameters<typeof bindTrackActivation>[3]>[0] | null = null) {
  if (index < 0 || index >= getSearchSnapshot().results.length) {
    return;
  }

  playListItem("search", getSearchSnapshot().results, index, {
    searchVersion: getSearchSnapshot().requestVersion,
    ...(pageSelection ?? {}),
  });
}

function playListItem(
  source: string,
  videos: readonly CommandContract.TrackSnapshotInput[],
  index: number,
  { searchVersion = null, playlistId = null, startPage = null, pages = [] }: { searchVersion?: number | null; playlistId?: string | null; startPage?: PlaybackStartPage | null; pages?: CommandContract.VideoPage[] } = {},
) {
  if (index < 0 || index >= videos.length) {
    return;
  }

  const currentVideo = getQueueSnapshot().queue[getQueueSnapshot().currentIndex];
  const targetBvid = String(videos[index]?.bvid ?? "").toLowerCase();
  const isCurrentQueueItem =
    !startPage &&
    targetBvid &&
    getQueueSnapshot().queueSource === source &&
    getQueueSnapshot().currentIndex === index &&
    String(currentVideo?.bvid ?? "").toLowerCase() === targetBvid &&
    (source !== "search" || getQueueSnapshot().queueSearchVersion === searchVersion) &&
    (source !== "playlist" || getQueueSnapshot().playlistId === playlistId);
  if (isCurrentQueueItem) {
    if (audio.paused) {
      void audio.play().catch(() => {});
    }
    return;
  }

  getQueueActions().replaceQueue(videos, source, searchVersion, playlistId);
  playerState.consecutiveResolveFailures = 0;
  resetCurrentPageState();
  clearPlaybackNotice();
  resetRandomRemaining();
  playQueueIndex(index, { recordCurrent: false, startPage, pages });
}

function playQueueIndex(
  index: number,
  {
    recordCurrent = true,
    preserveFailureStreak = false,
    startPage = null,
    pages = [],
    randomStartPage = false,
    historyCid = null,
  }: { recordCurrent?: boolean; preserveFailureStreak?: boolean; startPage?: PlaybackStartPage | null; pages?: CommandContract.VideoPage[]; randomStartPage?: boolean; historyCid?: number | null } = {},
) {
  if (index < 0 || index >= getQueueSnapshot().queue.length) {
    return;
  }
  clearPendingResume();

  if (!preserveFailureStreak) {
    playerState.consecutiveResolveFailures = 0;
    clearPlaybackNotice();
  }

  getQueueActions().selectIndex(index, recordCurrent, currentVideoPage()?.cid ?? null);
  resetCurrentPageState();
  if (startPage) {
    const normalizedPages = pages.map(normalizeVideoPage).filter((page) => page.cid > 0);
    const startPageIndex = normalizedPages.findIndex(
      (page) => page.cid === startPage.cid || page.page === startPage.page,
    );
    if (normalizedPages.length > 1 && startPageIndex >= 0) {
      playerState.currentPages = normalizedPages;
      getQueueActions().selectPage(startPageIndex);
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

function takeRandomNext() { return getQueueActions().takeRandomNext(Math.random); }

function advancePageWithinCurrentBv({ automatic = false, skipFailed = false } = {}) {
  if (!hasMultipleCurrentPages()) return false;
  if (automatic && getQueueSnapshot().loopMode === "single" && !skipFailed) {
    loadCurrentTrack({ keepPage: true }); return true;
  }
  if (!getQueueActions().advancePage(playerState.currentPages, getLibrarySnapshot().disabledPages, Math.random, readShuffleCollectionPrefs)) return false;
  updatePlayerPagesButton();
  loadCurrentTrack({ keepPage: true });
  return true;
}

function retreatPageWithinCurrentBv() {
  if (!getQueueActions().retreatPage(playerState.currentPages, getLibrarySnapshot().disabledPages)) return false;
  updatePlayerPagesButton();
  loadCurrentTrack({ keepPage: true });
  return true;
}

function playNext({ automatic = false, skipFailed = false } = {}) {
  const navigation = getQueueActions().nextNavigation(automatic, skipFailed, Math.random);
  if (navigation.kind === "empty") {
    if (!automatic) showPlaybackNotice("暂无可播放的歌曲", { kind: "info" });
    return false;
  }
  if (navigation.kind === "queue" && navigation.repeat) {
    playQueueIndex(navigation.index, { recordCurrent: false });
    return true;
  }
  if (navigation.kind === "end") {
    if (automatic) status.textContent = "队列播放完毕。";
    else showPlaybackNotice(getQueueSnapshot().shuffle ? "本轮随机播放已结束" : "已经是最后一首了", { kind: "info" });
    return false;
  }
  playQueueIndex(navigation.index, {
    preserveFailureStreak: skipFailed,
    ...(getQueueSnapshot().shuffle && readShuffleCollectionPrefs().order === "random" ? { randomStartPage: true } : {}),
  });
  return true;
}

function playPrevious() {
  const navigation = getQueueActions().previousNavigation(playerState.currentPages);
  if (navigation.kind === "empty") {
    showPlaybackNotice("暂无可播放的歌曲", { kind: "info" }); return;
  }
  if (navigation.kind === "page") {
    updatePlayerPagesButton(); loadCurrentTrack({ keepPage: true }); return;
  }
  if (navigation.kind === "queue") {
    playQueueIndex(navigation.index, { recordCurrent: false, ...("cid" in navigation ? { historyCid: navigation.cid } : {}) }); return;
  }
  showPlaybackNotice(getQueueSnapshot().shuffle ? "暂无上一首播放记录" : "已经是第一首了", { kind: "info" });
}

function initPlaybackSearch() {
searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = searchKeyword.value.trim();
  if (!query) {
    return;
  }

  if (isBvId(query)) {
    pendingPastedBvPages = null;
    const pasteVersion = resetSearchForBv();
    await cancelCurrentPlayback();
    if (pasteVersion !== getSearchSnapshot().requestVersion) return;
    if (pasteVersion === getSearchSnapshot().requestVersion) {
      pendingPastedBvPages = { bvid: query, requestVersion: playerState.requestVersion + 1 };
    }
    playBvId(query);
    recognizeSearchBv(query);
    return;
  }

  await runSearch({ userKeyword: query, recordHistory: true });
  return;
});
}

function initPastedBvPages() {
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
}

function initPlaybackResume() {
resumePlayPauseButton?.addEventListener("click", (event) => {
  if (!pendingResume && !resumeInProgress) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  void resumePendingPlayback();
}, true);
}

function initPlaybackPersistenceAndCache() {
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
}

function initPlaybackRecord() {
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
}

function initPlaybackAudioIdentity() {
audio.addEventListener("play", () => { playbackIntended = true; });
audio.addEventListener("pause", () => { playbackIntended = false; });
audio.addEventListener("playing", () => {
  if (playerState.activeAudioVersion === playerState.requestVersion &&
      playerState.activeAudioUrl === audio.currentSrc) {
    playingAudioVersion = playerState.activeAudioVersion;
  }
});
}

function initPlaybackModes() {
loopModeButton.addEventListener("click", () => {
  getQueueActions().cycleLoop(LOOP_MODES);
  updateQueueUi();
});

shuffleToggle.addEventListener("change", () => {
  getQueueActions().changeShuffle(shuffleToggle.checked, Math.random);
  updateQueueUi();
});
}


export { advancePageWithinCurrentBv, analyzeCurrentTrackAtThreshold, appendSearchResults, clearPendingResume, createTrackActions, createTrackRow, currentPlayableTrack, currentVideoPage, emitCurrentTrackChanged, getQueueSnapshot, handleAudioRecoveryError, hasMultipleCurrentPages, initPastedBvPages, initPlaybackAudioIdentity, initPlaybackModes, initPlaybackPersistenceAndCache, initPlaybackRecord, initPlaybackResume, initPlaybackSearch, playCurrentVideoPage, playListItem, playNext, playPrevious, playSearchResult, refreshTrackLoudness, restorePlaybackState, retreatPageWithinCurrentBv, savePlaybackState, showLoudnessNormalizationDialog, updateFavoriteButtons, updateQueueUi };
