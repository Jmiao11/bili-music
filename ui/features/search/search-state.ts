import type { DeepReadonly } from "../../store/state-store.ts";
import { normalizeTrack } from "../../shared/track-utils.ts";

const DEFAULT_MUSIC_TIDS = 3;
const SEARCH_PAGE_SIZE = 20;
const MUSIC_HOT_KEYWORD = "音乐";

type SearchState = {
  results: ReturnType<typeof normalizeTrack>[];
  userKeyword: string; requestKeyword: string; tids: number; order: string | null;
  rerank: boolean; sortMode: string; page: number; isLoadingMore: boolean; hasMore: boolean; requestVersion: number;
  pendingSearchRestore: string | null;
  searchBusy: boolean; playbackBusy: boolean;
  view: { rowsVersion: number | null; musicVersion: number | null; sortVersion: number | null; status: string | null; buttonDisabled: boolean | null; buttonSource: "search" | "playback" | null; resultVisible: boolean | null };
};
type SearchSnapshot = DeepReadonly<SearchState>;
type SearchAdapter = {
  invoke: <K extends "search_videos" | "record_search_history">(command: K, ...args: CommandArguments<K>) => Promise<CommandMap[K]["result"]>;
  report: (level: "warn" | "error", message: string, error: unknown) => void;
};
type SearchPageCommit = { page: number; responseLength: number };

function initialSearchState(): SearchState {
  return { results: [], userKeyword: "", requestKeyword: "", tids: DEFAULT_MUSIC_TIDS, order: null, rerank: true, sortMode: "all", page: 0, isLoadingMore: false, hasMore: false, requestVersion: 0,
    pendingSearchRestore: null, searchBusy: false, playbackBusy: false,
    view: { rowsVersion: null, musicVersion: null, sortVersion: null, status: null, buttonDisabled: null, buttonSource: null, resultVisible: null } };
}

function createSearchActions(read: () => SearchSnapshot, commitSearch: (next: SearchSnapshot) => void, adapter: SearchAdapter) {
  const updateSearch = (fields: Partial<SearchSnapshot>, view: Partial<SearchSnapshot["view"]> = {}) => {
    const current = read();
    commitSearch({ ...current, ...fields, view: Object.keys(view).length ? { ...current.view, ...view } : current.view });
  };
  function setPendingRestore(pendingSearchRestore: string): void { updateSearch({ pendingSearchRestore }); }
  function takePendingRestore(): string | null { const keyword = read().pendingSearchRestore; updateSearch({ pendingSearchRestore: null }); return keyword; }
  const rows = () => (read().view.rowsVersion ?? 0) + 1;

  function appendResults(videos: readonly CommandContract.SearchVideo[], beforeCommit?: (unique: SearchSnapshot["results"]) => void, page?: SearchPageCommit): SearchSnapshot["results"] {
    const current = read();
    const known = new Set(current.results.map(video => video.bvid));
    const unique = videos.filter(video => {
      if (!video?.bvid || known.has(video.bvid)) return false;
      known.add(video.bvid); return true;
    }).map(normalizeTrack);
    if (unique.length > 0) beforeCommit?.(unique);
    if (unique.length > 0 || page) {
      const hasMore = page ? page.responseLength >= SEARCH_PAGE_SIZE && unique.length > 0 : current.hasMore;
      updateSearch({ ...(unique.length > 0 ? { results: [...current.results, ...unique] } : {}),
        ...(page ? { page: page.page, hasMore, isLoadingMore: false } : {}) }, {
        ...(unique.length > 0 ? { rowsVersion: rows() } : {}),
        ...(page ? { status: !hasMore && current.results.length + unique.length > 0 ? "没有更多了" : unique.length > 0 ? `已加载第 ${page.page} 页，追加 ${unique.length} 个普通视频。` : "没有更多了" } : {}),
      });
    }
    return unique;
  }

  async function searchNow({ userKeyword, recordHistory = false, restored = false, saveKeyword }: { userKeyword: string; recordHistory?: boolean; restored?: boolean; saveKeyword?: (keyword: string) => void }): Promise<void> {
    const trimmed = userKeyword.trim();
    const version = read().requestVersion + 1;
    updateSearch({ userKeyword: trimmed, requestKeyword: trimmed || MUSIC_HOT_KEYWORD, order: trimmed ? null : "click", rerank: !!trimmed,
      page: 1, hasMore: false, isLoadingMore: false, requestVersion: version, searchBusy: true }, {
      buttonDisabled: true, buttonSource: "search", status: trimmed ? restored ? `已复用上次搜索关键词「${trimmed}」，正在搜索…` : "正在搜索…" : "正在加载该分区热门…",
    });
    try {
      const state = read();
      const payload: CommandMap["search_videos"]["args"] = { keyword: state.requestKeyword, page: 1, tids: state.tids, rerank: state.rerank };
      if (state.order) payload.order = state.order;
      if (state.rerank) payload.sortMode = state.sortMode;
      const request = adapter.invoke("search_videos", payload);
      if (recordHistory && state.userKeyword) adapter.invoke("record_search_history", { keyword: state.userKeyword }).catch(error => adapter.report("warn", "record_search_history failed:", error));
      const videos = await request;
      if (version !== read().requestVersion) return;
      const hasMore = videos.length >= SEARCH_PAGE_SIZE;
      if (read().userKeyword) saveKeyword?.(read().userKeyword);
      const modeLabel = read().userKeyword ? "" : "（分区热门）";
      const found = videos.length ? `找到 ${videos.length} 个普通视频${modeLabel}。${hasMore ? "" : "没有更多了"}` : "没有找到普通视频。";
      updateSearch({ results: videos.map(normalizeTrack), hasMore, searchBusy: false }, {
        rowsVersion: rows(), resultVisible: true, buttonDisabled: false, buttonSource: "search",
        status: restored ? `已复用上次搜索关键词「${read().userKeyword}」刷新完成，${found}` : found,
      });
    } catch (error) {
      if (version !== read().requestVersion) return;
      updateSearch({ searchBusy: false }, { buttonDisabled: false, buttonSource: "search", status: restored ? `复用上次搜索关键词「${read().userKeyword}」搜索失败：${error}` : `搜索失败：${error}` });
    }
  }

  async function loadNextPage(readDraft: () => string, appendPage?: (videos: readonly CommandContract.SearchVideo[], page: SearchPageCommit) => number): Promise<void> {
    const start = read();
    if (!start.requestKeyword || !start.hasMore || start.isLoadingMore) return;
    const nextPage = start.page + 1;
    const version = start.requestVersion;
    updateSearch({ isLoadingMore: true }, { status: `正在加载第 ${nextPage} 页…` });
    try {
      const state = read();
      const payload: CommandMap["search_videos"]["args"] = { keyword: state.requestKeyword, page: nextPage, tids: state.tids, order: state.order, rerank: state.rerank };
      if (state.rerank) payload.sortMode = state.sortMode;
      const videos = await adapter.invoke("search_videos", payload);
      if (version !== read().requestVersion) return;
      if (readDraft().trim() !== read().userKeyword) {
        updateSearch({ isLoadingMore: false }, !read().hasMore && read().results.length > 0 ? { status: "没有更多了" } : {}); return;
      }
      const page = { page: nextPage, responseLength: videos.length };
      if (appendPage) appendPage(videos, page); else appendResults(videos, undefined, page);
    } catch (error) {
      if (version !== read().requestVersion) return;
      updateSearch({ isLoadingMore: false }, { status: !read().hasMore && read().results.length > 0 ? "没有更多了" : `加载更多失败：${error}` });
    }
  }

  function resetForBv(): number {
    const version = read().requestVersion + 1;
    updateSearch({ userKeyword: "", requestKeyword: "", order: null, rerank: true, page: 0, hasMore: false, isLoadingMore: false, searchBusy: false, requestVersion: version, results: [] }, { rowsVersion: rows() });
    return version;
  }
  function updateMetadata(index: number, version: number, metadata: Pick<CommandContract.AudioResponse, "title" | "uploader" | "thumbnailUrl" | "durationSeconds">): void {
    const state = read();
    if (version !== state.requestVersion || !state.results[index]) return;
    updateSearch({ results: state.results.map((video, current) => current === index ? { ...video, ...metadata } : video) });
  }
  function playbackButtonBusy(busy: boolean): void { updateSearch({ playbackBusy: busy }, { buttonDisabled: busy, buttonSource: "playback" }); }
  function recognizeBv(bvid: string): void { updateSearch({}, { status: `已识别 BV 号：${bvid}` }); }
  function refreshResults(): void { updateSearch({}, { rowsVersion: rows() }); }
  function refreshDivision(): void { updateSearch({}, { musicVersion: (read().view.musicVersion ?? 0) + 1 }); }
  function refreshSort(): void { updateSearch({}, { sortVersion: (read().view.sortVersion ?? 0) + 1 }); }
  function chooseDivision(tids: number): void { updateSearch({ tids }, { musicVersion: (read().view.musicVersion ?? 0) + 1 }); }
  function chooseSort(sortMode: string): void { updateSearch({ sortMode: read().sortMode === sortMode ? "all" : sortMode }, { sortVersion: (read().view.sortVersion ?? 0) + 1 }); }
  return { setPendingRestore, takePendingRestore, appendResults, chooseDivision, chooseSort, loadMoreSearchResults: loadNextPage, recognizeBv, refreshDivision, refreshResults, refreshSort, resetForBv, runSearch: searchNow, setPlaybackBusy: playbackButtonBusy, updateMetadata };
}

export { DEFAULT_MUSIC_TIDS, createSearchActions, initialSearchState };
export type { SearchSnapshot, SearchPageCommit };
