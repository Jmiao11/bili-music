import {finishPagesTransition} from "../features/pages/pages-view.ts";
import { installPageCallbacks } from "./root-controls.ts";
import { installSettingsCallbacks } from "../features/settings/root-settings.ts";
import { openAiSettingsDetails, readHomeHintDraft, readSearchDraft, writeSearchDraft } from "../platform/draft-ports.ts";
import { installPlaybackCallbacks } from "../features/playback/root-playback.ts";
import { DEFAULT_MUSIC_TIDS } from "../features/search/search-state.ts";
import { invoke } from "../platform/runtime-api.ts";
import { audio, closeLibraryModalButton, homeHintApply, homeModeTabs, homeRankingError, libraryModal, pagesModal, pagesModalClose, pagesModalRestoreAll, refreshRankingButton, searchResults } from "../platform/main-window-refs.ts";
import { LOAD_MORE_THRESHOLD_PX } from "../shared/controller-runtime.ts";
import { clearPlaybackNotice, initPlaybackNotice } from "../features/playback/playback-notice.ts";
import { initPlaybackDiagnostics } from "../features/playback/playback-diagnostics.ts";
import { initializeRootLists } from "../features/tracks/track-list-ui.ts";
import { checkForUpdate, openUpdateDownload, getHomeSnapshot, loadHomeRanking, loadRecommendationHome, loadRecommendations, refreshAiKeyState, setHomeHint, setHomeMode, updateHomeModeUi } from "../features/home/home.ts";
import { keepFocusInPagesModal } from "../features/pages/pages-view.ts";
import { finishLibraryModalTransition, keepFocusInLibraryModal } from "../features/library/library-view.ts";
import { choosePlaylistAndAdd, closeLibraryModal, createPlaylist, deleteSelectedPlaylist, importFavoritePlaylist, loadLibrary, openPurgeUnavailableTracksModal, renameSelectedPlaylist, toggleFavorite } from "../features/library/library-ui.ts";
import { changeDisabledPages, closePagesModal, getPagesSnapshot, openCurrentPagesModal } from "../features/pages/video-pages.ts";
import { getSearchSnapshot, loadMoreSearchResults, readLastSearchKeyword, runSearch, setPendingSearchRestore, setSearchDivision, setSearchSort, takePendingSearchRestore, updateMusicTabs } from "../features/search/search.ts";
import { advancePageWithinCurrentBv, analyzeCurrentTrackAtThreshold, clearPendingResume, currentPlayableTrack, currentVideoPage, emitCurrentTrackChanged, getQueueSnapshot, getRequestSnapshot, getSessionSnapshot, handleAudioRecoveryError, initPastedBvPages, initPlaybackAudioIdentity, initPlaybackModes, initPlaybackPersistenceAndCache, initPlaybackRecord, initPlaybackResume, initPlaybackSearch, playNext, restorePlaybackState, savePlaybackState, updateQueueUi } from "../features/playback/playback-core.ts";
import { getPlaybackCommands, isLoudnessNormalizationEnabled } from "../features/settings/appearance.ts";
initializeRootLists();
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

installPlaybackCallbacks({
  pages: () => openCurrentPagesModal(),
  skip: () => { if (playNext()) { clearPendingResume(); clearPlaybackNotice(); } },
  previous: () => { getPlaybackCommands().previous(); }, next: () => { getPlaybackCommands().next(); },
});
initPlaybackResume();

audio.addEventListener("ended", (event) => {
  const belongsToCurrentAudio =
    getRequestSnapshot().activeAudioVersion === getRequestSnapshot().requestVersion &&
    getRequestSnapshot().activeAudioUrl === audio.currentSrc &&
    event.timeStamp >= getRequestSnapshot().audioActivatedAt;
  if (belongsToCurrentAudio && audio.ended) {
    const bvid = currentPlayableTrack()?.bvid;
    const cid = currentVideoPage()?.cid ?? getSessionSnapshot().currentPages[0]?.cid;
    const audioUrl = getRequestSnapshot().activeAudioUrl;
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

installPlaybackCallbacks({ favorite: () => { toggleFavorite(); }, addPlaylistImmersive: () => { choosePlaylistAndAdd(); } });




refreshRankingButton?.addEventListener("click", () => {
  if (getHomeSnapshot().mode === "recommendation") {
    if (getHomeSnapshot().aiHasKey === false) {
      loadHomeRanking({ forceRefresh: true });
    } else {
      loadRecommendations({ forceRefresh: true });
    }
  } else {
    loadHomeRanking({ forceRefresh: true });
  }
});
installPageCallbacks({
  update: () => { void openUpdateDownload(); },
  createPlaylist, renamePlaylist: renameSelectedPlaylist, deletePlaylist: deleteSelectedPlaylist, importPlaylist: importFavoritePlaylist,
  hint: () => {
  setHomeHint(readHomeHintDraft());
  loadRecommendations({ forceRefresh: true });
  },
  hintKey: event => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  homeHintApply?.click();
  },
  setup: () => {
  document.querySelector<HTMLButtonElement>("#open-settings-button")?.click();
  const ai = document.querySelector<HTMLDetailsElement>(".ai-settings");
  if (ai) {
    openAiSettingsDetails();
    ai.scrollIntoView({ block: "center" });
  }
  },
});
for (const tab of homeModeTabs) {
  tab.addEventListener("click", () => setHomeMode(tab.dataset.homeMode));
}
installPageCallbacks({
  division: value => {
    const tids = Number(value) || DEFAULT_MUSIC_TIDS;
    if (getSearchSnapshot().tids === tids && getSearchSnapshot().results.length > 0) return;
    setSearchDivision(tids);
    runSearch({ userKeyword: readSearchDraft().trim(), recordHistory: false });
  },
  sort: mode => { setSearchSort(mode); runSearch({ userKeyword: readSearchDraft().trim(), recordHistory: false }); },
});
homeRankingError?.addEventListener("click", () => {
  if (getHomeSnapshot().error) {
    loadHomeRanking({ forceRefresh: true });
  }
});
closeLibraryModalButton?.addEventListener("click", closeLibraryModal);
installSettingsCallbacks({purge:openPurgeUnavailableTracksModal});
libraryModal?.addEventListener("click", (event) => {
  if (event.target === libraryModal) {
    closeLibraryModal();
  }
});
libraryModal?.addEventListener("transitionend", (event) => {
  finishLibraryModalTransition(event);
});
pagesModalClose?.addEventListener("click", closePagesModal);
pagesModalRestoreAll?.addEventListener("click", (event) => {
  event.stopPropagation();
  const context = getPagesSnapshot().modal;
  if (context) void changeDisabledPages(context.video.bvid, null);
});
pagesModal?.addEventListener("click", (event) => {
  if (event.target === pagesModal) {
    closePagesModal();
  }
});
pagesModal?.addEventListener("keydown", keepFocusInPagesModal);
pagesModal?.addEventListener("transitionend", (event) => {
  if (event.target === pagesModal && !pagesModal.classList.contains("is-open")) {
    finishPagesTransition();
  }
});
window.addEventListener("keydown", (event) => {
  keepFocusInLibraryModal(event);
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
    if (getHomeSnapshot().mode === "recommendation") {
      loadRecommendationHome();
    } else {
      loadHomeRanking();
    }
  }
  if (["favorites", "playlists"].includes(event.detail?.view)) {
    loadLibrary();
  }
  if (event.detail?.view === "search" && getSearchSnapshot().pendingSearchRestore) {
    const keyword = takePendingSearchRestore();
    if (keyword !== null && !getSearchSnapshot().results.length && readSearchDraft().trim() === keyword) {
      // 自动恢复不算用户搜索，不计入搜索历史。
      runSearch({ userKeyword: keyword, recordHistory: false, restored: true });
    }
  }
});
window.addEventListener("ai-config-updated", refreshAiKeyState);

updateHomeModeUi();
void checkForUpdate();
refreshAiKeyState();
window.addEventListener("DOMContentLoaded", restorePlaybackState, { once: true });
const restoreKeyword = readLastSearchKeyword();
if (restoreKeyword && !readSearchDraft().trim()) {
  writeSearchDraft(restoreKeyword);
  setPendingSearchRestore(restoreKeyword);
}
loadLibrary();
updateMusicTabs();
updateQueueUi();
emitCurrentTrackChanged();

export {};
