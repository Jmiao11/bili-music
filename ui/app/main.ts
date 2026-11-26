import { installQueueDrawerPlayback } from "../features/playback/queue-drawer.ts";
import { clearPlaybackQueue, playListItem, playQueueIndex, removeQueueEntry } from "../features/playback/playback-core.ts";
import { installRecentController } from "../features/recent/recent-controller.ts";
import { focusLibraryFilter, installLibraryFilter } from "../features/tracks/root-lists.ts";
import { readApplicationStore } from "../store/application-store.ts";
import {finishPagesTransition} from "../features/pages/pages-view.ts";
import { installPageCallbacks, pageCallbacks } from "./root-controls.ts";
import { installSettingsCallbacks } from "../features/settings/root-settings.ts";
import { openAiSettingsDetails, readHomeHintDraft, readSearchDraft, writeSearchDraft } from "../platform/draft-ports.ts";
import { installPlaybackCallbacks } from "../features/playback/root-playback.ts";
import { DEFAULT_MUSIC_TIDS } from "../features/search/search-state.ts";
import { invoke } from "../platform/runtime-api.ts";
import { windowReady } from "./main-window-ready.ts";
import { audio, closeLibraryModalButton, homeFeedRefs, homeHintApply, installHomeRankingRetry, libraryModal, pagesModal, pagesModalClose, pagesModalRestoreAll, refreshRankingButton, searchResults } from "../platform/main-window-refs.ts";
import { clearPlaybackNotice, initPlaybackNotice } from "../features/playback/playback-notice.ts";
import { initPlaybackDiagnostics } from "../features/playback/playback-diagnostics.ts";
import { initializeRootLists, playHomeTrack } from "../features/tracks/track-list-ui.ts";
import { checkForUpdate, openUpdateDownload, getApplicationStore, getHomeSnapshot, loadHomeRanking, loadRecommendationHome, loadRecommendations, refreshAiKeyState, setHomeHint } from "../features/home/home.ts";
import { keepFocusInPagesModal } from "../features/pages/pages-view.ts";
import { finishLibraryModalTransition, keepFocusInLibraryModal } from "../features/library/library-view.ts";
import { cancelLibraryFilterDrag, choosePlaylistAndAdd, closeLibraryModal, createPlaylist, deleteSelectedPlaylist, importFavoritePlaylist, loadLibrary, openPurgeUnavailableTracksModal, renameSelectedPlaylist, toggleFavorite } from "../features/library/library-ui.ts";
import { changeDisabledPages, closePagesModal, getPagesSnapshot, openCurrentPagesModal } from "../features/pages/video-pages.ts";
import { clearSavedSearchHistory, closeSearchHistory, closeSearchHistoryFromOutside, deleteSearchHistory, enterSearchView, getSearchSnapshot, initializeSearchState, onSearchFilterKey, onSearchHistoryKey, onSearchScroll, readLastSearchKeyword, refreshSearchFromSidebar, runSearch, selectSearchHistory, setSearchDivision, setSearchSort, showSearchHistory, updateMusicTabs } from "../features/search/search.ts";
import { advancePageWithinCurrentBv, analyzeCurrentTrackAtThreshold, clearPendingResume, currentPlayableTrack, currentVideoPage, emitCurrentTrackChanged, getQueueSnapshot, getRequestSnapshot, getSessionSnapshot, handleAudioRecoveryError, initPastedBvPages, initPlaybackAudioIdentity, initPlaybackModes, initPlaybackPersistenceAndCache, initPlaybackRecord, initPlaybackResume, initPlaybackSearch, playNext, restorePlaybackState, savePlaybackState, savePlaybackStateOnUnload, updateQueueUi } from "../features/playback/playback-core.ts";
import { getPlaybackCommands, isLoudnessNormalizationEnabled, setActiveView } from "../features/settings/appearance.ts";
initializeRootLists();
installRecentController(readApplicationStore(), window);
installLibraryFilter(readApplicationStore(), cancelLibraryFilterDrag);
initPlaybackDiagnostics();
initPlaybackNotice();

initPlaybackSearch();

searchResults.addEventListener("scroll", onSearchScroll);

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
    const audioId = readApplicationStore().getState().playbackDisplay.audioQuality.audioId;
    if (!advancePageWithinCurrentBv({ automatic: true })) {
      playNext({ automatic: true });
    }
    if (bvid && cid && isLoudnessNormalizationEnabled()) {
      invoke("analyze_track_loudness", { audioUrl, key: `${bvid}:${cid}`, ...(audioId !== null ? { audioId } : {}) }).catch((error) => {
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
window.addEventListener("beforeunload", savePlaybackStateOnUnload);

installQueueDrawerPlayback(playQueueIndex, removeQueueEntry, clearPlaybackQueue, savePlaybackState);
initPlaybackModes();

installPlaybackCallbacks({ favorite: track => { if (track) void toggleFavorite(track); }, addPlaylistImmersive: track => { if (track) choosePlaylistAndAdd(track); } });




refreshRankingButton?.addEventListener("click", () => {
  if (getHomeSnapshot().aiHasKey === false) {
    loadHomeRanking({ forceRefresh: true });
  } else {
    loadRecommendations({ forceRefresh: true });
  }
});
installPageCallbacks({
  retryFeed: source => { void getApplicationStore().actions.retryHomeSection(source); },
  openFeed: source => {
    const store = getApplicationStore();
    const previous = store.getState().home.view.section;
    store.actions.openHomeSection(source);
    if (source) homeFeedRefs.back?.focus();
    else if (previous) homeFeedRefs.open[previous]?.focus();
  },
  playFeed: source => playHomeTrack(source, 0),
  openRecent: () => setActiveView("recent"),
  playRecent: index => playListItem("recent", getApplicationStore().getState().recent.items, index),
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
installPageCallbacks({
  showSearchHistory, closeSearchHistory: closeSearchHistoryFromOutside, selectSearchHistory, deleteSearchHistory,
  clearSearchHistory: () => { void clearSavedSearchHistory(); },
  refreshSearch: refreshSearchFromSidebar,
  division: value => {
    const tids = Number(value) || DEFAULT_MUSIC_TIDS;
    if (getSearchSnapshot().tids === tids) return;
    setSearchDivision(tids);
    runSearch({ userKeyword: readSearchDraft().trim(), recordHistory: false });
  },
  sort: mode => {
    if (getSearchSnapshot().sortMode === mode) return;
    setSearchSort(mode);
    runSearch({ userKeyword: readSearchDraft().trim(), recordHistory: false });
  },
});
installHomeRankingRetry(() => {
  if (getHomeSnapshot().error) {
    void getApplicationStore().actions.retryHomeSection("ranking");
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
function setPointerFocus(pointer: boolean): void {
  document.documentElement.toggleAttribute("data-pointer-focus", pointer);
}
let watchingPointerFocus = false;
window.addEventListener("keydown", (event) => {
  setPointerFocus(false);
  // Chromium can carry keyboard focus visibility through a click on the focused card.
  if (!watchingPointerFocus) {
    watchingPointerFocus = true;
    window.addEventListener("pointerdown", () => setPointerFocus(true), { capture: true, passive: true });
  }
  keepFocusInLibraryModal(event);
  if (focusLibraryFilter(event)) return;
  if (onSearchHistoryKey(event)) return;
  onSearchFilterKey(event, pageCallbacks);
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
    getApplicationStore().actions.openHomeSection(null);
    loadRecommendationHome();
  }
  if (["favorites", "playlists"].includes(event.detail?.view)) {
    loadLibrary();
  }
  if (event.detail?.view === "search") enterSearchView();
  else closeSearchHistory();
});
window.addEventListener("ai-config-updated", refreshAiKeyState);

getApplicationStore();
void checkForUpdate();
const initialHome = getApplicationStore().actions.refreshAiKeyState(true);
void Promise.all([initialHome,windowReady]).then(() => {
  if (getHomeSnapshot().aiHasKey === false && getApplicationStore().getState().settings.session.currentView === "home") void loadHomeRanking();
});
window.addEventListener("DOMContentLoaded", restorePlaybackState, { once: true });
const restoreKeyword = readLastSearchKeyword();
if (restoreKeyword && !readSearchDraft().trim()) {
  writeSearchDraft(restoreKeyword);
}
loadLibrary();
updateMusicTabs();
updateQueueUi();
void Promise.resolve().then(initializeSearchState);
emitCurrentTrackChanged();

export {};
