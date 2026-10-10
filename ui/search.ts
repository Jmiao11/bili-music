import type { SearchPageCommit } from "./search-state.ts";
import { searchKeyword } from "./player-dom.ts";
import { LAST_SEARCH_KEY } from "./player-state.ts";
import { getApplicationStore } from "./home.ts";
import { bindTrackActivation } from "./video-pages.ts";
import { renderSearchSnapshot } from "./search-view.ts";
import { appendSearchResults, createTrackActions, playSearchResult, updateQueueUi } from "./playback-core.ts";

let searchMounted = false;

function readLastSearchKeyword(): string {
  try {
    const value = localStorage.getItem(LAST_SEARCH_KEY);
    return typeof value === "string" ? value.trim().slice(0, 100) : "";
  } catch {
    return "";
  }
}

function saveLastSearchKeyword(keyword: string): void {
  try {
    localStorage.setItem(LAST_SEARCH_KEY, keyword);
  } catch (error) {
    console.warn("last search keyword save failed:", error);
  }
}

function getSearchActions() {
  const store = getApplicationStore();
  if (!searchMounted) {
    searchMounted = true;
    let previous: ReturnType<typeof getSearchSnapshot> | null = null;
    const render = (state: ReturnType<typeof store.getState>) => {
      const rendered = renderSearchSnapshot(state.search, previous, { createActions: createTrackActions, bindActivation: bindTrackActivation, play: playSearchResult });
      previous = state.search;
      if (rendered) updateQueueUi();
    };
    store.subscribe(render);
    render(store.getState());
  }
  return store.actions.search;
}
function setPendingSearchRestore(keyword: string): void { getApplicationStore().actions.search.setPendingRestore(keyword); }
function takePendingSearchRestore(): string | null { return getApplicationStore().actions.search.takePendingRestore(); }
function getSearchSnapshot() { return getApplicationStore().getState().search; }
function renderSearchResults(): void { getSearchActions().refreshResults(); }
function updateMusicTabs(): void { getSearchActions().refreshDivision(); }
function setSearchDivision(tids: number): void { getSearchActions().chooseDivision(tids); }
function setSearchSort(sortMode: string): void { getSearchActions().chooseSort(sortMode); }
function resetSearchForBv(): number { return getSearchActions().resetForBv(); }
function setSearchPlaybackBusy(busy: boolean): void { getSearchActions().setPlaybackBusy(busy); }
function recognizeSearchBv(bvid: string): void { getSearchActions().recognizeBv(bvid); }
function fillSearchMetadata(index: number, version: number, metadata: Pick<CommandContract.AudioResponse, "title" | "uploader" | "thumbnailUrl" | "durationSeconds">): void {
  getSearchActions().updateMetadata(index, version, metadata);
}
function appendSearchDisplay(videos: readonly CommandContract.SearchVideo[], beforeCommit: (unique: ReturnType<typeof getSearchSnapshot>["results"]) => void, page?: SearchPageCommit) {
  return getSearchActions().appendResults(videos, beforeCommit, page);
}
function runSearch({ userKeyword = searchKeyword.value.trim(), recordHistory = false, restored = false }: { userKeyword?: string; recordHistory?: boolean; restored?: boolean } = {}): Promise<void> {
  return getSearchActions().runSearch({ userKeyword, recordHistory, restored, saveKeyword: saveLastSearchKeyword });
}
function loadMoreSearchResults(): Promise<void> {
  return getSearchActions().loadMoreSearchResults(() => searchKeyword.value, (videos, page) => appendSearchResults(videos, page));
}

export { appendSearchDisplay, fillSearchMetadata, getSearchSnapshot, loadMoreSearchResults, readLastSearchKeyword, recognizeSearchBv, renderSearchResults, resetSearchForBv, runSearch, setPendingSearchRestore, setSearchDivision, setSearchPlaybackBusy, setSearchSort, takePendingSearchRestore, updateMusicTabs };
