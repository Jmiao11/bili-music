import {revealPlaybackBar} from "../../app/shell-stages.ts";
import { installPageCallbacks } from "../../app/root-controls.ts";
import { readSearchDraft } from "../../platform/draft-ports.ts";
import { installPlaybackCallbacks } from "./root-playback.ts";
import { findEnabledPageIndex, isPageDisabled, pickRandomEnabledPageIndex } from "../pages/page-selection.ts";
import { buildDisplayTrack, displayThumbnailUrl, formatDuration, isBvId, normalizeTrack, normalizeVideoPage, playbackFailureMessage, playbackTrackSnapshot, shouldOpenPastedBvPages, unavailableTrackReason } from "../../shared/track-utils.ts";
import type { SearchPageCommit } from "../search/search-state.ts";
import { invoke } from "../../platform/runtime-api.ts";
import { audio, resumePlayPauseButton } from "../../platform/main-window-refs.ts";
import { LOOP_MODES, MAX_AUDIO_RECOVERIES, MAX_CONSECUTIVE_RESOLVE_FAILURES, PLAYBACK_STATE_SAVE_INTERVAL_MS } from "../../shared/controller-runtime.ts";
import { lufsToGain, readShuffleCollectionPrefs, shouldRecoverAudio } from "./playback-policy.ts";
import { clearPlaybackNotice, showPlaybackNotice } from "./playback-notice.ts";
import type { PageSelection } from "../tracks/track-list-model.ts";
import type { QueueInput } from "./playback-queue-state.ts";
import { getApplicationStore } from "../home/home.ts";
import { clearLibraryUnavailable, getLibrarySnapshot, markLibraryUnavailable, openLoudnessModal, renderLibraryViews } from "../library/library-ui.ts";
import { openCurrentPagesModal } from "../pages/video-pages.ts";
import { appendSearchDisplay, fillSearchMetadata, getSearchSnapshot, recognizeSearchBv, renderSearchResults, resetSearchForBv, runSearch, setSearchPlaybackBusy } from "../search/search.ts";
import { getPlaybackCommands, isLoudnessNormalizationEnabled, setNormalizationGain } from "../settings/appearance.ts";
import { setPlaybackStatus } from "./playback-messages.ts";
type PlaybackStartPage = Partial<Omit<CommandContract.VideoPage, "page" | "cid"> & Pick<CommandContract.PlaybackState, "page" | "cid">>;

let cacheRequestPromise: Promise<void> | null = null;
let recoveryPromise: Promise<void> | null = null;


function getRequestSnapshot() { return getApplicationStore().getState().playbackRequest; }
function getRequestActions() { return getApplicationStore().actions.playbackRequest; }

function getSessionSnapshot() { return getApplicationStore().getState().playbackSession; }
function getSessionActions() { return getApplicationStore().actions.playbackSession; }

function getQueueSnapshot() { return getApplicationStore().getState().playbackQueue; }
function getQueueActions() { return getApplicationStore().actions.playbackQueue; }

function currentTrackSnapshot() {
  const displayTrack = getQueueSnapshot().currentDisplayTrack;
  if (
    displayTrack &&
    getSessionSnapshot().currentPages.length > 1 &&
    getQueueSnapshot().currentIndex >= 0 &&
    getQueueSnapshot().currentIndex < getQueueSnapshot().queue.length
  ) {
    return {
      ...displayTrack,
      hasCurrent: true,
    };
  }

  const video = getQueueActions().activeTrack();
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
  const track = normalizeTrack(getQueueActions().activeTrack());
  return track.bvid ? track : null;
}

function resetCurrentPageState() {
  getSessionActions().setCurrentPages([]);
  getQueueActions().resetPage();

}

function hasMultipleCurrentPages() {
  return getSessionSnapshot().currentPages.length > 1;
}

function currentVideoPage() {
  if (!hasMultipleCurrentPages()) {
    return null;
  }
  return getSessionSnapshot().currentPages[getQueueSnapshot().currentPageIndex] ?? null;
}

function currentAudioCacheCid() {
  return currentVideoPage()?.cid ?? getSessionSnapshot().currentPages[0]?.cid ?? null;
}


async function loadPagesForCurrentVideo(video: CommandContract.TrackSnapshotInput, requestVersion: number) {
  resetCurrentPageState();
  try {
    const pages = await invoke("get_video_pages", { bvId: video.bvid });
    if (!getRequestActions().isCurrent(requestVersion)) {
      return false;
    }
    getSessionActions().setCurrentPages((Array.isArray(pages) ? pages : [])
      .map(normalizeVideoPage)
      .filter((page) => page.cid > 0));
    getQueueActions().selectPage(0);

  } catch (error) {
    if (getRequestActions().isCurrent(requestVersion)) {
      console.warn(`get_video_pages failed for ${video.bvid}; treating as single-P:`, error);
      resetCurrentPageState();
      showPlaybackNotice("分P列表获取失败，暂按单个视频播放。");
    }
  }
  return getRequestActions().isCurrent(requestVersion);
}

function emitCurrentTrackChanged() {
  const snapshot = currentTrackSnapshot();
  const cid = currentAudioCacheCid();
  const identity = JSON.stringify([snapshot.bvid, cid === null ? "page" : "cid", cid ?? getQueueSnapshot().currentPageIndex]);
  if (identity !== getSessionSnapshot().lastEmittedTrackIdentity) {
    getSessionActions().setTrackIdentity(identity);
    getSessionActions().setPlayRecorded(false);
    getSessionActions().setLoudnessAnalyzed(false);
    getSessionActions().setCacheRequested(false);
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
  getRequestActions().invalidateAudio();
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

async function cancelCurrentPlayback() {
  getRequestActions().beginRequest();
  stopAudioElement();
  setSearchPlaybackBusy(false);
  try {
    await invoke("cancel_prepare_audio");
  } catch {
    // There may be no active resolver to cancel.
  }
}

function clearPendingResume() {
  getSessionActions().setPendingResume(null);
  getSessionActions().setResumeInProgress(false);
}

function savePlaybackState() {
  getSessionActions().setLastSavedAt(Date.now());
  if (getQueueSnapshot().queue.length === 0) {
    invoke("clear_playback_state").catch((error) => {
      console.warn("clear playback state failed:", error);
    });
    return;
  }

  const page = currentVideoPage();
  const resume = getSessionSnapshot().pendingResume;
  const currentTime = Number(audio.currentTime);
  const hasCollections = getQueueSnapshot().queue.some(entry => entry.collection);
  invoke("save_playback_state", {
    state: {
      version: hasCollections ? 2 : 1,
      queue: hasCollections ? getQueueActions().persistedQueue() : getQueueSnapshot().queue.map(playbackTrackSnapshot),
      ...(hasCollections ? { traversal: getQueueActions().persistedTraversal() } : {}),
      currentIndex: Math.max(
        0,
        Math.min(getQueueSnapshot().currentIndex, getQueueSnapshot().queue.length - 1),
      ),
      positionSeconds: resume?.positionSeconds ??
        (getQueueSnapshot().queue[getQueueSnapshot().currentIndex]?.collection && getRequestSnapshot().activeAudioVersion !== getRequestSnapshot().requestVersion ? 0 : Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0),
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
  getApplicationStore().actions.playbackDisplay.setRenderedTrack({ title: track.title, uploader: track.uploader, thumbnailUrl: displayThumbnailUrl(track.thumbnailUrl) });
  getApplicationStore().actions.playbackDisplay.restoreProgress(safePosition, sliderMax, formatDuration(totalSeconds));
  setPlaybackStatus("已恢复上次播放，点击播放继续。");
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
    if (state.version === 2 && state.traversal) getQueueActions().restoreTraversal(state.traversal);
    else resetRandomRemaining();
    updateQueueUi();
    renderLibraryViews();
    const track = currentPlayableTrack();
    if (!track) {
      return;
    }
    const resume = {
      positionSeconds: Math.max(0, Number(state.positionSeconds) || 0),
      page: state.page == null ? null : Math.max(1, Math.round(Number(state.page) || 1)),
      cid: state.cid == null ? null : Math.max(0, Math.round(Number(state.cid) || 0)),
    };
    getSessionActions().setPendingResume(resume);
    renderRestoredPlaybackUi(track, resume.positionSeconds);
    emitCurrentTrackChanged();
  } catch (error) {
    console.warn("restore playback state failed:", error);
  }
}

function setQueue(videos: readonly QueueInput[], { save = true } = {}) {
  clearPendingResume();
  getQueueActions().replaceQueue(videos);
  getRequestActions().resetFailures();
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
  void getSearchSnapshot();
}


function playCurrentVideoPage(page: CommandContract.VideoPage) {
  clearPendingResume();
  const pageIndex = getSessionSnapshot().currentPages.findIndex(
    (candidate) => candidate.cid === page.cid || candidate.page === page.page,
  );
  if (pageIndex < 0 || pageIndex === getQueueSnapshot().currentPageIndex) {
    return;
  }
  if (getQueueSnapshot().queue[getQueueSnapshot().currentIndex]?.collection) {
    getQueueActions().selectCollectionPage(pageIndex, currentAudioCacheCid(), getRequestSnapshot().activeAudioVersion === getRequestSnapshot().requestVersion);
  } else getQueueActions().selectPage(pageIndex);

  loadCurrentTrack({ keepPage: true });
}


function showLoudnessNormalizationDialog() {
  openLoudnessModal();
}

function waitForAudioMetadata() {
  return waitForRecoveryMetadata(getRequestSnapshot().requestVersion);
}

function recoveryAttemptsFor(version: number) {
  if (getSessionSnapshot().recoveryVersion !== version) {
    getSessionActions().setRecoveryVersion(version);
    getSessionActions().setRecoveryAttempts(0);
  }
  return getSessionSnapshot().recoveryAttempts;
}

function refundRecoveryAttempt(version: number) {
  if (getSessionSnapshot().recoveryVersion === version) getSessionActions().setRecoveryAttempts(getSessionSnapshot().recoveryAttempts - 1);
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
      if (!getRequestActions().isCurrent(version)) { cleanup(); resolve(false); }
    };
    audio.addEventListener("loadedmetadata", loaded);
    audio.addEventListener("error", failed);
    audio.addEventListener("emptied", emptied);
  });
}

async function recoverCurrentAudio(version: number, sourceUrl: string, position: number, wasPlaying: boolean) {
  if (!getRequestActions().isCurrent(version) || sourceUrl !== getRequestSnapshot().activeAudioUrl) {
    window.recordPlaybackDiag("audio-recovery", "abandoned before prepare_audio");
    return;
  }
  const video = getQueueActions().activeTrack();
  if (!video) return;
  const page = currentVideoPage();
  const quality = getApplicationStore().getState().playbackDisplay.audioQuality;
  getSessionActions().setRecoveryAttempts(getSessionSnapshot().recoveryAttempts + 1);
  window.recordPlaybackDiag("audio-recovery", `start attempt=${getSessionSnapshot().recoveryAttempts} position=${position}`);
  try {
    const info = await invoke("prepare_audio", {
      ...(quality.preference !== "highest" ? { quality: quality.preference } : {}),
      ...(quality.audioId !== null ? { audioId: quality.audioId } : {}),
      bvId: video.bvid,
      cid: page?.cid ?? null,
      cacheCid: currentAudioCacheCid(),
      page: page?.page ?? null,
      part: page?.part ?? null,
      durationSeconds: page?.durationSeconds ?? null,
    });
    if (!getRequestActions().isCurrent(version) || sourceUrl !== getRequestSnapshot().activeAudioUrl) {
      refundRecoveryAttempt(version);
      window.recordPlaybackDiag("audio-recovery", "abandoned after prepare_audio");
      return;
    }
    getRequestActions().replaceAudio(info.audioUrl, performance.now());
    getApplicationStore().actions.playbackDisplay.setAudioQuality({ preference: quality.preference, audioId: info.audioId ?? null, isFallback: info.isFallback ?? false });
    if (quality.audioId !== (info.audioId ?? null)) {
      getSessionActions().setCacheRequested(false);
      getSessionActions().setLoudnessAnalyzed(false);
      refreshTrackLoudness();
    }
    audio.src = info.audioUrl;
    audio.load();
    const loaded = await waitForRecoveryMetadata(version);
    if (!loaded || !getRequestActions().isCurrent(version)) {
      refundRecoveryAttempt(version);
      window.recordPlaybackDiag("audio-recovery", "abandoned while loading metadata");
      return;
    }
    const maxPosition = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 1) : position;
    audio.currentTime = Math.min(Math.max(0, position), maxPosition);
    if (wasPlaying) await audio.play();
    if (!getRequestActions().isCurrent(version)) {
      refundRecoveryAttempt(version);
      window.recordPlaybackDiag("audio-recovery", "abandoned after play");
      return;
    }
    window.recordPlaybackDiag("audio-recovery", `success attempt=${getSessionSnapshot().recoveryAttempts}`);
  } catch (error) {
    if (!getRequestActions().isCurrent(version) || String(error).includes("audio resolution was cancelled")) {
      refundRecoveryAttempt(version);
      window.recordPlaybackDiag("audio-recovery", `abandoned: ${error}`);
      return;
    }
    window.recordPlaybackDiag("audio-recovery", `failed: ${error}`);
    showPlaybackNotice(`${playbackFailureMessage(error)}，播放已中断。`, { persistent: true });
  }
}

function handleAudioRecoveryError(event: Event) {
  const version = getRequestSnapshot().requestVersion;
  const isCurrent = getRequestSnapshot().activeAudioVersion === version &&
    getRequestSnapshot().activeAudioUrl === audio.currentSrc &&
    event.timeStamp >= getRequestSnapshot().audioActivatedAt;
  const attempts = recoveryAttemptsFor(version);
  if (recoveryPromise) {
    if (audio.error?.code === 2 && isCurrent) {
      window.recordPlaybackDiag("audio-recovery", "abandoned: recovery already running");
    }
    return;
  }
  if (!shouldRecoverAudio(audio.error?.code, isCurrent, getSessionSnapshot().playingAudioVersion === version, attempts)) {
    if (audio.error?.code === 2 && isCurrent && getSessionSnapshot().playingAudioVersion === version && attempts >= MAX_AUDIO_RECOVERIES) {
      window.recordPlaybackDiag("audio-recovery", "limit reached");
      showPlaybackNotice(`${playbackFailureMessage("request failed")}，播放已中断。`, { persistent: true });
    }
    return;
  }
  const sourceUrl = audio.currentSrc;
  const position = audio.currentTime;
  const wasPlaying = getSessionSnapshot().playbackIntended;
  const recovery = Promise.resolve().then(() => recoverCurrentAudio(version, sourceUrl, position, wasPlaying));
  recoveryPromise = recovery;
  const clear = () => { if (recoveryPromise === recovery) recoveryPromise = null; };
  void recovery.then(clear, clear);
}


function refreshTrackLoudness() {
  const queryVersion = getSessionActions().nextLoudnessQuery();
  const requestVersion = getRequestSnapshot().requestVersion;
  setNormalizationGain(1);
  if (!isLoudnessNormalizationEnabled()) return;
  const bvid = getQueueActions().activeTrack()?.bvid;
  const cid = currentVideoPage()?.cid ?? getSessionSnapshot().currentPages[0]?.cid;
  if (!bvid || !cid) {
    console.warn("track loudness unavailable: missing bvid/cid");
    return;
  }
  const audioId = getApplicationStore().getState().playbackDisplay.audioQuality.audioId;
  invoke("get_track_loudness", { key: `${bvid}:${cid}`, ...(audioId !== null ? { audioId } : {}) }).then((lufs) => {
    if (queryVersion !== getSessionSnapshot().loudnessQueryVersion || !getRequestActions().isCurrent(requestVersion)) return;
    if (lufs === null || !Number.isFinite(lufs)) {
      console.warn("track loudness unavailable:", `${bvid}:${cid}`);
    }
    setNormalizationGain(lufsToGain(lufs));
  }).catch((error) => {
    if (queryVersion !== getSessionSnapshot().loudnessQueryVersion || !getRequestActions().isCurrent(requestVersion)) return;
    setNormalizationGain(1);
    console.warn("get_track_loudness failed:", error);
  });
}

function analyzeCurrentTrackAtThreshold() {
  if (getSessionSnapshot().loudnessAnalyzedForCurrentTrack || !isLoudnessNormalizationEnabled()) return;
  const dur = Number(audio.duration);
  const threshold = dur > 0 ? Math.min(30, dur * 0.9) : 30;
  if (audio.currentTime < threshold) return;
  const bvid = getQueueActions().activeTrack()?.bvid;
  const cid = currentVideoPage()?.cid ?? getSessionSnapshot().currentPages[0]?.cid;
  const audioUrl = getRequestSnapshot().activeAudioUrl;
  const audioId = getApplicationStore().getState().playbackDisplay.audioQuality.audioId;
  if (!bvid || !cid || !audioUrl) return;

  getSessionActions().setLoudnessAnalyzed(true);
  const requestVersion = getRequestSnapshot().requestVersion;
  const startAnalysis = () => {
    if (!getRequestActions().isCurrent(requestVersion) || audioUrl !== getRequestSnapshot().activeAudioUrl || !isLoudnessNormalizationEnabled()) return;
    invoke("analyze_track_loudness", { audioUrl, key: `${bvid}:${cid}`, ...(audioId !== null ? { audioId } : {}) }).then((lufs) => {
      if (!getRequestActions().isCurrent(requestVersion) || audioUrl !== getRequestSnapshot().activeAudioUrl) return;
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
  let video = getQueueActions().activeTrack();
  if (!video) {
    return;
  }

  const requestVersion = getRequestActions().beginRequest();
  const quality = getApplicationStore().getState().settings.audioQuality;
  const previousAudioId = getApplicationStore().getState().playbackDisplay.audioQuality.audioId;
  getApplicationStore().actions.playbackDisplay.setAudioQuality({ preference: quality, audioId: null, isFallback: false });
  stopAudioElement();
  setSearchPlaybackBusy(true);
  revealPlaybackBar();
  setPlaybackStatus("正在解析音频…");

  try {
    const entry = getQueueSnapshot().queue[index];
    if (entry.collection && getQueueSnapshot().collectionNeedsRefresh) {
      const reference = entry.entryId && (getQueueSnapshot().queueSource === "favorites" || getQueueSnapshot().queueSource === "playlist")
        ? { entryId: entry.entryId, playlistId: getQueueSnapshot().playlistId } : null;
      const result = await getApplicationStore().actions.collection.resolveForPlayback(entry.collection.data, reference, () => getRequestActions().isCurrent(requestVersion));
      if (!result) return;
      getQueueActions().freezeCollection(result.snapshot, readShuffleCollectionPrefs().order, Math.random);
      if (result.notice) showPlaybackNotice(result.notice);
      video = getQueueActions().activeTrack();
      if (!video) return;
      randomStartPage = getQueueSnapshot().shuffle && readShuffleCollectionPrefs().order === "random";
    }
    if (!keepPage) {
      const stillCurrent = await loadPagesForCurrentVideo(video, requestVersion);
      if (!stillCurrent) {
        return;
      }
    }

    const selectDefaultPage = (random = false) => {
      const isDisabled = (page: CommandContract.VideoPage) => isPageDisabled(getLibrarySnapshot().disabledPages, video.bvid, page.cid);
      const pageIndex = random
        ? pickRandomEnabledPageIndex(getSessionSnapshot().currentPages, isDisabled, Math.random)
        : findEnabledPageIndex(getSessionSnapshot().currentPages, 0, 1, isDisabled);
      if (pageIndex < 0) throw new Error("all pages disabled by user");
      getQueueActions().selectPage(pageIndex);

    };

    if (!startPage && !keepPage && resumePosition === null && hasMultipleCurrentPages()) {
      selectDefaultPage(randomStartPage);
    }

    if (startPage) {
      const startPageIndex = getSessionSnapshot().currentPages.findIndex(
        (page) => page.cid === startPage.cid || page.page === startPage.page,
      );
      if (startPageIndex >= 0) {
        getQueueActions().selectPage(startPageIndex);

      } else if (hasMultipleCurrentPages()) {
        selectDefaultPage();
      }
    }

    const page = currentVideoPage();
    if (recoveryPromise) {
      const recovery = recoveryPromise;
      void invoke("cancel_prepare_audio").catch(() => {});
      await recovery.catch(() => {});
      if (!getRequestActions().isCurrent(requestVersion)) return;
    }
    const info = await invoke("prepare_audio", {
      ...(quality !== "highest" ? { quality } : {}),
      bvId: video.bvid,
      cid: page?.cid ?? null,
      cacheCid: currentAudioCacheCid(),
      page: page?.page ?? null,
      part: page?.part ?? null,
      durationSeconds: page?.durationSeconds ?? null,
    });
    if (!getRequestActions().isCurrent(requestVersion)) {
      return;
    }

    getRequestActions().resetFailures();
    if (previousAudioId !== (info.audioId ?? null)) {
      getSessionActions().setCacheRequested(false);
      getSessionActions().setLoudnessAnalyzed(false);
    }
    getApplicationStore().actions.playbackDisplay.setAudioQuality({ preference: quality, audioId: info.audioId ?? null, isFallback: info.isFallback ?? false });
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
    getApplicationStore().actions.playbackDisplay.setRenderedTrack({ title: visibleTrack.title, uploader: visibleTrack.uploader, thumbnailUrl: displayThumbnailUrl(visibleTrack.thumbnailUrl) });
    getApplicationStore().actions.playbackDisplay.setTrackDuration(formatDuration(visibleTrack.durationSeconds));
    emitCurrentTrackChanged();
    (page?.cid ?? getSessionSnapshot().currentPages[0]?.cid) && window.dispatchEvent(new CustomEvent("bili-track-changed", { detail: { bvid: video.bvid, cid: page?.cid ?? getSessionSnapshot().currentPages[0].cid } }));
    refreshTrackLoudness();
    getRequestActions().activateAudio(requestVersion, info.audioUrl, performance.now());
    audio.src = info.audioUrl;
    audio.load();
    if (resumePosition !== null) {
      await waitForAudioMetadata();
      if (!getRequestActions().isCurrent(requestVersion)) {
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
      if (getRequestActions().isCurrent(requestVersion)) {
        setPlaybackStatus("在线播放中。");
      }
    } catch (error) {
      if (getRequestActions().isCurrent(requestVersion)) {
        setPlaybackStatus("音频已就绪，点击播放。");
      }
      if (resumePosition !== null) {
        console.warn("restored audio could not start playing:", error);
      }
    }
  } catch (error) {
    if (!getRequestActions().isCurrent(requestVersion)) {
      return;
    }

    if (String(error).includes("audio resolution was cancelled")) return;
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

    getQueueActions().settleCollectionUnit(currentAudioCacheCid());
    getRequestActions().recordFailure();
    if (
      getRequestSnapshot().consecutiveResolveFailures >=
      MAX_CONSECUTIVE_RESOLVE_FAILURES
    ) {
      const message = "队列中多首无法播放，已停止。";
      setPlaybackStatus(message);
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
      setPlaybackStatus(message);
      showPlaybackNotice(message, { persistent: true });
    }
  } finally {
    if (getRequestActions().isCurrent(requestVersion)) {
      setSearchPlaybackBusy(false);
    }
  }
}

async function resumePendingPlayback() {
  if (!getSessionSnapshot().pendingResume || getSessionSnapshot().resumeInProgress || audio.currentSrc) {
    return;
  }
  const resume = { ...getSessionSnapshot().pendingResume };
  getSessionActions().setResumeInProgress(true);
  try {
    await loadCurrentTrack({
      startPage: resume,
      resumePosition: resume.positionSeconds,
    });
  } catch (error) {
    clearPendingResume();
    console.warn("resume playback failed:", error);
  } finally {
    getSessionActions().setResumeInProgress(false);
  }
}

function playBvId(bvId: string) {
  const queueIndex = getQueueSnapshot().queue.findIndex(
    (video) => !video.collection && video.bvid.toLowerCase() === bvId.toLowerCase(),
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

function playSearchResult(index: number, pageSelection: PageSelection | null = null) {
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
  videos: readonly QueueInput[],
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
    currentVideo?.entryId === videos[index]?.entryId &&
    (source !== "search" && source !== "collection" || getQueueSnapshot().queueSearchVersion === searchVersion) &&
    (source !== "playlist" || getQueueSnapshot().playlistId === playlistId);
  if (isCurrentQueueItem) {
    if (audio.paused) {
      void audio.play().catch(() => {});
    }
    return;
  }

  getQueueActions().replaceQueue(videos, source, searchVersion, playlistId);
  getRequestActions().resetFailures();
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
    historySelection = false,
  }: { recordCurrent?: boolean; preserveFailureStreak?: boolean; startPage?: PlaybackStartPage | null; pages?: CommandContract.VideoPage[]; randomStartPage?: boolean; historyCid?: number | null; historySelection?: boolean } = {},
) {
  if (index < 0 || index >= getQueueSnapshot().queue.length) {
    return;
  }
  getApplicationStore().actions.collection.setPrompt("", null);
  clearPendingResume();

  if (!preserveFailureStreak) {
    getRequestActions().resetFailures();
    clearPlaybackNotice();
  }

  const current = getQueueSnapshot().queue[getQueueSnapshot().currentIndex];
  const recordAudio = !current?.collection || getRequestSnapshot().activeAudioVersion === getRequestSnapshot().requestVersion;
  const cid = currentVideoPage()?.cid ?? (getQueueSnapshot().queue.some(entry => entry.collection) ? getSessionSnapshot().currentPages[0]?.cid ?? null : null);
  getQueueActions().selectIndex(index, recordCurrent && recordAudio, cid, !historySelection && historyCid == null);
  resetCurrentPageState();
  if (startPage) {
    const normalizedPages = pages.map(normalizeVideoPage).filter((page) => page.cid > 0);
    const startPageIndex = normalizedPages.findIndex(
      (page) => page.cid === startPage.cid || page.page === startPage.page,
    );
    if (normalizedPages.length > 1 && startPageIndex >= 0) {
      getSessionActions().setCurrentPages(normalizedPages);
      getQueueActions().selectPage(startPageIndex);
    }
  }

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
  if (getQueueSnapshot().queue[getQueueSnapshot().currentIndex]?.collection) {
    if (automatic && getQueueSnapshot().loopMode === "single" && !skipFailed) {
      loadCurrentTrack({ keepPage: true }); return true;
    }
    if (automatic) getQueueActions().settleCollectionUnit(getSessionSnapshot().currentPages[getQueueSnapshot().currentPageIndex]?.cid ?? null);
    const recordCurrent = getRequestSnapshot().activeAudioVersion === getRequestSnapshot().requestVersion;
    const navigation = getQueueActions().advanceCollection(getSessionSnapshot().currentPages, getLibrarySnapshot().disabledPages, Math.random, readShuffleCollectionPrefs(), getSessionSnapshot().currentPages[getQueueSnapshot().currentPageIndex]?.cid ?? null, recordCurrent);
    if (!navigation) return false;
    loadCurrentTrack({ keepPage: navigation === "page", ...(navigation === "member" ? { randomStartPage: getQueueSnapshot().shuffle && readShuffleCollectionPrefs().order === "random" } : {}) }); return true;
  }
  if (!hasMultipleCurrentPages()) return false;
  if (automatic && getQueueSnapshot().loopMode === "single" && !skipFailed) {
    loadCurrentTrack({ keepPage: true }); return true;
  }
  if (!getQueueActions().advancePage(getSessionSnapshot().currentPages, getLibrarySnapshot().disabledPages, Math.random, readShuffleCollectionPrefs)) return false;

  loadCurrentTrack({ keepPage: true });
  return true;
}

function retreatPageWithinCurrentBv() {
  if (getQueueSnapshot().queue[getQueueSnapshot().currentIndex]?.collection) {
    if (!getQueueSnapshot().history.length) return false;
    playPrevious(); return true;
  }
  if (!getQueueActions().retreatPage(getSessionSnapshot().currentPages, getLibrarySnapshot().disabledPages)) return false;

  loadCurrentTrack({ keepPage: true });
  return true;
}

function playNext({ automatic = false, skipFailed = false } = {}) {
  if (getQueueSnapshot().queue[getQueueSnapshot().currentIndex]?.collection) {
    const recordCurrent = getRequestSnapshot().activeAudioVersion === getRequestSnapshot().requestVersion;
    if (getQueueActions().advanceCollection([], getLibrarySnapshot().disabledPages, Math.random, readShuffleCollectionPrefs(), getSessionSnapshot().currentPages[getQueueSnapshot().currentPageIndex]?.cid ?? null, recordCurrent)) {
      loadCurrentTrack({ randomStartPage: getQueueSnapshot().shuffle && readShuffleCollectionPrefs().order === "random" }); return true;
    }
  }
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
    if (automatic) setPlaybackStatus("队列播放完毕。");
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
  const navigation = getQueueActions().previousNavigation(getSessionSnapshot().currentPages);
  if (navigation.kind === "empty") {
    showPlaybackNotice("暂无可播放的歌曲", { kind: "info" }); return;
  }
  if (navigation.kind === "page") {
     loadCurrentTrack({ keepPage: true }); return;
  }
  if (navigation.kind === "queue") {
    playQueueIndex(navigation.index, { recordCurrent: false, ...("cid" in navigation ? { historyCid: navigation.cid, historySelection: true } : {}) }); return;
  }
  showPlaybackNotice(getQueueSnapshot().shuffle ? "暂无上一首播放记录" : "已经是第一首了", { kind: "info" });
}

function initPlaybackSearch() {
installPageCallbacks({submit: async event => {
  event.preventDefault();
  const query = readSearchDraft().trim();
  if (!query) {
    return;
  }

  if (isBvId(query)) {
    getApplicationStore().actions.collection.setPrompt(query, null);
    getSessionActions().setPendingPastedPages(null);
    const pasteVersion = resetSearchForBv();
    await cancelCurrentPlayback();
    if (pasteVersion !== getSearchSnapshot().requestVersion) return;
    if (pasteVersion === getSearchSnapshot().requestVersion) {
      getSessionActions().setPendingPastedPages({ bvid: query, requestVersion: getRequestSnapshot().requestVersion + 1 });
    }
    playBvId(query);
    recognizeSearchBv(query);
    const requestVersion = getRequestSnapshot().requestVersion;
    void invoke("get_video_meta", { bvid: query }).then(meta => {
      if (getRequestSnapshot().requestVersion === requestVersion && currentPlayableTrack()?.bvid.toLowerCase() === query.toLowerCase()) {
        getApplicationStore().actions.collection.setPrompt(query, meta.collection);
      }
    }).catch(() => {});
    return;
  }

  await runSearch({ userKeyword: query, recordHistory: true });
  return;
}});
}

function initPastedBvPages() {
window.addEventListener("bili-track-changed", (event) => {
  const pending = getSessionSnapshot().pendingPastedBvPages;
  if (!pending) return;
  const shouldOpen = shouldOpenPastedBvPages(
    getSessionSnapshot().pendingPastedBvPages,
    event.detail?.bvid,
    currentPlayableTrack()?.bvid,
    getRequestSnapshot().requestVersion,
    getSessionSnapshot().currentPages.length,
  );
  getSessionActions().setPendingPastedPages(null);
  if (shouldOpen) openCurrentPagesModal();
});

window.addEventListener("bilibili-music-trackchange", () => {
  const pending = getSessionSnapshot().pendingPastedBvPages;
  if (!pending) return;
  const current = currentPlayableTrack();
  if (current && (
    current.bvid.toLowerCase() !== pending.bvid.toLowerCase() ||
    getRequestSnapshot().requestVersion > pending.requestVersion ||
    (getRequestSnapshot().requestVersion === pending.requestVersion && getSessionSnapshot().currentPages.length <= 1)
  )) getSessionActions().setPendingPastedPages(null);
});

window.addEventListener("bilibili-music-notice-change", () => {
  if (getSessionSnapshot().pendingPastedBvPages && getRequestSnapshot().consecutiveResolveFailures > 0) getSessionActions().setPendingPastedPages(null);
});
}

function initPlaybackResume() {
resumePlayPauseButton?.addEventListener("click", (event) => {
  if (!getPlaybackCommands().hasPendingResume()) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  void getPlaybackCommands().togglePlayPause();
}, true);
}

function initPlaybackPersistenceAndCache() {
audio.addEventListener("timeupdate", () => {
  const now = Date.now();
  if (now - getSessionSnapshot().lastPlaybackStateSavedAt >= PLAYBACK_STATE_SAVE_INTERVAL_MS) {
    savePlaybackState();
  }
});

audio.addEventListener("timeupdate", () => {
  if (getSessionSnapshot().cacheRequestedForCurrentTrack) return;
  const dur = Number(audio.duration);
  const threshold = dur > 0 ? Math.min(30, dur * 0.9) : 30;
  if (audio.currentTime < threshold) return;
  const snapshot = currentTrackSnapshot();
  const bvid = snapshot.bvid;
  const cid = currentAudioCacheCid();
  const audioUrl = getRequestSnapshot().activeAudioUrl;
  if (
    !bvid || !cid || !audioUrl || !snapshot.title || !snapshot.uploader ||
    !snapshot.thumbnailUrl || !snapshot.durationSeconds ||
    !getRequestActions().isCurrent(getRequestSnapshot().activeAudioVersion) ||
    audioUrl !== audio.currentSrc
  ) return;
  getSessionActions().setCacheRequested(true);
  const request = invoke("cache_track_audio", {
    audioUrl, bvid, cid,
    audioId: getApplicationStore().getState().playbackDisplay.audioQuality.audioId,
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
  if (getSessionSnapshot().playRecordedForCurrentTrack) return;
  const dur = Number(audio.duration);
  const threshold = dur > 0 ? Math.min(30, dur * 0.9) : 30;
  if (audio.currentTime < threshold) return;
  const snapshot = currentTrackSnapshot();
  if (!snapshot.bvid) return;
  getSessionActions().setPlayRecorded(true);
  invoke("record_play", { track: snapshot }).catch(() => {});
});
}

function initPlaybackAudioIdentity() {
audio.addEventListener("play", () => { getSessionActions().setPlaybackIntended(true); });
audio.addEventListener("pause", () => { getSessionActions().setPlaybackIntended(false); });
audio.addEventListener("playing", () => {
  if (getRequestActions().isCurrent(getRequestSnapshot().activeAudioVersion) &&
      getRequestSnapshot().activeAudioUrl === audio.currentSrc) {
    getSessionActions().setPlayingVersion(getRequestSnapshot().activeAudioVersion);
  }
});
}

function initPlaybackModes() {
installPlaybackCallbacks({
  loop: () => { getQueueActions().cycleLoop(LOOP_MODES); updateQueueUi(); },
  shuffle: checked => { getQueueActions().changeShuffle(checked, Math.random); updateQueueUi(); },
});
}


export { advancePageWithinCurrentBv, analyzeCurrentTrackAtThreshold, appendSearchResults, clearPendingResume, currentPlayableTrack, currentVideoPage, emitCurrentTrackChanged, getQueueSnapshot, getRequestSnapshot, getSessionSnapshot, handleAudioRecoveryError, hasMultipleCurrentPages, initPastedBvPages, initPlaybackAudioIdentity, initPlaybackModes, initPlaybackPersistenceAndCache, initPlaybackRecord, initPlaybackResume, initPlaybackSearch, playCurrentVideoPage, playListItem, playNext, playPrevious, playSearchResult, refreshTrackLoudness, restorePlaybackState, resumePendingPlayback, retreatPageWithinCurrentBv, savePlaybackState, showLoudnessNormalizationDialog, updateQueueUi };
