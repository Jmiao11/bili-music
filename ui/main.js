import { invoke } from "./runtime-api.ts";
import { audio, closeLibraryModalButton, createPlaylistButton, deletePlaylistButton, favoriteCurrentButton, homeHintApply, homeHintInput, homeModeTabs, homeRankingError, homeSetupSettings, immersiveFavoriteButton, libraryModal, musicTabs, nextButton, pagesModal, pagesModalClose, pagesModalRestoreAll, playerPagesButton, previousButton, purgeUnavailableTracksButton, refreshRankingButton, renamePlaylistButton, searchKeyword, searchResults, skipVideoButton, sortModeTabs } from "./player-dom.ts";
import { DEFAULT_MUSIC_TIDS, LOAD_MORE_THRESHOLD_PX, homeState, playerState, searchState } from "./player-state.ts";
import { clearPlaybackNotice, initPlaybackNotice } from "./playback-notice.ts";
import { initPlaybackDiagnostics } from "./playback-diagnostics.js";
import { loadHomeRanking, loadRecommendationHome, loadRecommendations, refreshAiKeyState, setHomeMode, updateHomeModeUi } from "./home.js";
import { choosePlaylistAndAdd, closeLibraryModal, createPlaylist, deleteSelectedPlaylist, importFavoritePlaylist, loadLibrary, openPurgeUnavailableTracksModal, renameSelectedPlaylist, toggleFavorite } from "./library-ui.js";
import { changeDisabledPages, closePagesModal, keepFocusInPagesModal, openCurrentPagesModal, pagesModalContext } from "./video-pages.js";
import { loadMoreSearchResults, readLastSearchKeyword, runSearch, updateMusicTabs, updateSortModeTabs } from "./search.js";
import { advancePageWithinCurrentBv, analyzeCurrentTrackAtThreshold, clearPendingResume, currentVideoPage, emitCurrentTrackChanged, handleAudioRecoveryError, initPastedBvPages, initPlaybackAudioIdentity, initPlaybackModes, initPlaybackPersistenceAndCache, initPlaybackRecord, initPlaybackResume, initPlaybackSearch, playNext, playPrevious, restorePlaybackState, retreatPageWithinCurrentBv, savePlaybackState, updateQueueUi } from "./playback-core.js";
import { isLoudnessNormalizationEnabled } from "./appearance.js";

let pendingSearchRestore = null;

initPlaybackDiagnostics();
initPlaybackNotice();

initPlaybackSearch();

searchResults.addEventListener("scroll", () => {
  const distanceToBottom =
    searchResults.scrollHeight - searchResults.scrollTop - searchResults.clientHeight;
  if (distanceToBottom <= LOAD_MORE_THRESHOLD_PX) {
    loadMoreSearchResults();
  }
});

initPastedBvPages();

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
initPlaybackResume();

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

initPlaybackPersistenceAndCache();

audio.addEventListener("timeupdate", analyzeCurrentTrackAtThreshold);

initPlaybackRecord();

audio.addEventListener("pause", savePlaybackState);
initPlaybackAudioIdentity();

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

initPlaybackModes();

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

export {};
