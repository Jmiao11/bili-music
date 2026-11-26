import { readSearchDraft } from "../../platform/draft-ports.ts";
import type { SearchPageCommit } from "./search-state.ts";
import type { PageCallbacks } from "../../app/root-controls.ts";
import { LAST_SEARCH_KEY, LOAD_MORE_THRESHOLD_PX } from "../../shared/controller-runtime.ts";
import { searchResults } from "../../platform/main-window-refs.ts";
import { getApplicationStore } from "../home/home.ts";
import { renderSearchSnapshot } from "./search-view.ts";
import { appendSearchResults, updateQueueUi } from "../playback/playback-core.ts";
let searchMounted = false;
let scrollSample = { top: 0, width: 0, height: 0 };
let resizeTrackingStarted = false;

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
      const rendered = renderSearchSnapshot(state.search, previous, { renderRows: () => {} });
      previous = state.search;
      if (rendered) {
        if (state.settings.session.currentView === "search") syncSearchScroll();
        updateQueueUi();
      }
    };
    store.subscribe(render);
    render(store.getState());
  }
  return store.actions.search;
}
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
function runSearch({ userKeyword = readSearchDraft().trim(), recordHistory = false }: { userKeyword?: string; recordHistory?: boolean } = {}): Promise<void> {
  return getSearchActions().runSearch({ userKeyword, recordHistory, saveKeyword: saveLastSearchKeyword });
}
function loadMoreSearchResults(): Promise<void> {
  return getSearchActions().loadMoreSearchResults(() => readSearchDraft(), (videos, page) => appendSearchResults(videos, page));
}

function syncSearchScroll(): void {
  scrollSample = { top: searchResults.scrollTop, width: searchResults.clientWidth, height: searchResults.clientHeight };
}

function enterSearchView(): void {
  syncSearchScroll();
  if (!resizeTrackingStarted) {
    resizeTrackingStarted = true;
    window.addEventListener("resize", syncSearchScroll);
  }
}

function onSearchScroll(): void {
  if (getApplicationStore().getState().settings.session.currentView !== "search") return;
  const previous = scrollSample;
  syncSearchScroll();
  const { top, width, height } = scrollSample;
  if (top > previous.top && width === previous.width && height === previous.height &&
      searchResults.scrollHeight - top - height <= LOAD_MORE_THRESHOLD_PX) {
    void loadMoreSearchResults();
  }
}

function onSearchFilterKey(event: KeyboardEvent, callbacks: Pick<PageCallbacks, "division" | "sort">): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement)) return;
  const group = event.target.closest("#view-search .search-tab-group");
  if (!group) return;
  const tabs = [...group.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
  const index = tabs.findIndex(tab => tab === event.target);
  if (index < 0) return;
  let next: number;
  switch (event.key) {
    case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
    case "ArrowRight": next = (index + 1) % tabs.length; break;
    case "Home": next = 0; break;
    case "End": next = tabs.length - 1; break;
    default: return;
  }
  event.preventDefault();
  const tab = tabs[next];
  tab.focus();
  if (tab.dataset.tids !== undefined) callbacks.division(tab.dataset.tids);
  else if (tab.dataset.sortMode !== undefined) callbacks.sort(tab.dataset.sortMode);
}

export { appendSearchDisplay, enterSearchView, fillSearchMetadata, getSearchSnapshot, loadMoreSearchResults, onSearchFilterKey, onSearchScroll, readLastSearchKeyword, recognizeSearchBv, renderSearchResults, resetSearchForBv, runSearch, setSearchDivision, setSearchPlaybackBusy, setSearchSort, updateMusicTabs };
