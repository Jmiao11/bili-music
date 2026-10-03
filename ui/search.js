import { displayThumbnailUrl, formatDuration, formatPlayCount, formatPubdate, normalizeTrack } from "./track-utils.js";
import { invoke } from "./runtime-api.js";
import { musicTabs, result, searchButton, searchKeyword, searchResults, searchStatus, sortModeTabs } from "./player-dom.js";
import { LAST_SEARCH_KEY, MUSIC_HOT_KEYWORD, SEARCH_PAGE_SIZE, searchState } from "./player-state.js";
import { bindTrackActivation } from "./video-pages.js";
import { appendSearchResults, createTrackActions, playSearchResult, updateQueueUi } from "./playback-core.js";

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

function setSearchResults(videos) {
  searchState.results = videos.map(normalizeTrack);
  renderSearchResults();
  updateQueueUi();
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

export { loadMoreSearchResults, readLastSearchKeyword, renderSearchResults, runSearch, setSearchResults, updateMusicTabs, updateSortModeTabs };
