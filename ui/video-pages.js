import { isPageDisabled } from "./page-selection.js";
import { formatDuration, normalizeVideoPage } from "./track-utils.js";
import { invoke } from "./runtime-api.js";
import { pagesModal, pagesModalClose, pagesModalList, pagesModalRestoreAll, pagesModalStatus, pagesModalSub, pagesModalTitle, playerPagesButton, status } from "./player-dom.js";
import { PAGE_COUNT_LOOKUP_CONCURRENCY, PAGE_COUNT_LOOKUP_INTERVAL_MS, activePageCountBvids, failedPageCountBvids, libraryState, observedPageCountTargets, pageCountLookupQueue, pageModalOpeners, pendingPageCacheTargets, playerState, queuedPageCountBvids, videoPageCounts, videoPagesByBvid, visiblePageCountTargets } from "./player-state.js";
import { currentPlayableTrack, currentVideoPage, hasMultipleCurrentPages, playCurrentVideoPage } from "./playback-core.js";

let pageCountObserver;
let activePageCountLookups = 0;
let lastPageCountLookupStartedAt = Number.NEGATIVE_INFINITY;
let pageCountLookupTimer = null;
let pageCacheLookupScheduled = false;
let pagesMetaRequestVersion = 0;
let pagesMetaStatusBeforeLoad = null;
let pagesModalContext = null;
let pagesModalReturnFocus = null;

function updatePageCountBadge(playButton, bvid) {
  playButton.dataset.bvid = bvid;
  const count = videoPageCounts.get(bvid);
  const actions = playButton.parentElement?.querySelector(".track-actions");
  let badge = actions?.querySelector(".page-count-badge");
  if (!(count > 1)) {
    badge?.remove();
    return;
  }
  if (!badge && actions) {
    badge = document.createElement("button");
    badge.type = "button";
    badge.className = "page-count-badge";
    badge.title = "查看分P";
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      pageModalOpeners.get(playButton)?.(badge);
    });
    badge.addEventListener("dblclick", (event) => event.stopPropagation());
    actions.prepend(badge);
  }
  if (!badge) {
    return;
  }
  badge.textContent = `${count}P`;
  badge.setAttribute("aria-label", `查看 ${count} 个分P`);
}

function refreshPageCountBadges(bvid) {
  for (const playButton of document.querySelectorAll("button.track[data-bvid]")) {
    if (playButton.dataset.bvid === bvid) {
      updatePageCountBadge(playButton, bvid);
    }
  }
}

function rememberVideoPages(bvid, value) {
  const videos = Math.max(0, Math.round(Number(value?.videos) || 0));
  const pages = (Array.isArray(value?.pages) ? value.pages : [])
    .map(normalizeVideoPage)
    .filter((page) => page.cid > 0);
  videoPageCounts.set(bvid, videos);
  if (videos >= 1 && pages.length > 0) {
    videoPagesByBvid.set(bvid, { videos, pages });
  }
  refreshPageCountBadges(bvid);
  return { videos, pages };
}

function queueCachedVideoPagesLookup(item, bvid) {
  if (!bvid || videoPageCounts.has(bvid) || failedPageCountBvids.has(bvid)) {
    return;
  }
  let targets = pendingPageCacheTargets.get(bvid);
  if (!targets) {
    targets = new Set();
    pendingPageCacheTargets.set(bvid, targets);
  }
  targets.add(item);
  if (pageCacheLookupScheduled) {
    return;
  }
  pageCacheLookupScheduled = true;
  window.setTimeout(loadCachedVideoPagesBatch, 0);
}

async function loadCachedVideoPagesBatch() {
  pageCacheLookupScheduled = false;
  const batch = new Map(pendingPageCacheTargets);
  pendingPageCacheTargets.clear();
  const bvids = [...batch.keys()].filter((bvid) => !videoPageCounts.has(bvid));
  let cached = {};
  if (bvids.length > 0) {
    try {
      cached = await invoke("get_cached_video_pages", { bvids });
    } catch {
      cached = {};
    }
  }
  for (const [bvid, targets] of batch) {
    if (cached?.[bvid]) {
      rememberVideoPages(bvid, cached[bvid]);
      stopObservingPageCountBvid(bvid);
      continue;
    }
    for (const target of targets) {
      if (target.isConnected) {
        observePageCount(target, bvid);
      }
    }
  }
}

function stopObservingPageCountBvid(bvid) {
  for (const target of observedPageCountTargets.get(bvid) ?? []) {
    pageCountObserver?.unobserve(target);
  }
  observedPageCountTargets.delete(bvid);
  visiblePageCountTargets.delete(bvid);
}

function hasVisiblePageCountTarget(bvid) {
  const targets = visiblePageCountTargets.get(bvid);
  if (!targets) {
    return false;
  }
  for (const target of [...targets]) {
    if (!target.isConnected) {
      targets.delete(target);
      observedPageCountTargets.get(bvid)?.delete(target);
      pageCountObserver?.unobserve(target);
    }
  }
  if (targets.size === 0) {
    visiblePageCountTargets.delete(bvid);
    return false;
  }
  return true;
}

function schedulePageCountLookups() {
  if (
    pageCountLookupTimer !== null ||
    activePageCountLookups >= PAGE_COUNT_LOOKUP_CONCURRENCY
  ) {
    return;
  }

  while (pageCountLookupQueue.length > 0) {
    const bvid = pageCountLookupQueue[0];
    if (
      videoPageCounts.has(bvid) ||
      failedPageCountBvids.has(bvid) ||
      activePageCountBvids.has(bvid) ||
      !hasVisiblePageCountTarget(bvid)
    ) {
      pageCountLookupQueue.shift();
      queuedPageCountBvids.delete(bvid);
      continue;
    }

    const elapsed = performance.now() - lastPageCountLookupStartedAt;
    const delay = Math.max(0, PAGE_COUNT_LOOKUP_INTERVAL_MS - elapsed);
    if (delay > 0) {
      pageCountLookupTimer = window.setTimeout(() => {
        pageCountLookupTimer = null;
        schedulePageCountLookups();
      }, Math.ceil(delay));
      return;
    }

    pageCountLookupQueue.shift();
    queuedPageCountBvids.delete(bvid);
    activePageCountBvids.add(bvid);
    activePageCountLookups += 1;
    lastPageCountLookupStartedAt = performance.now();
    void fetchPageCount(bvid);
    schedulePageCountLookups();
    return;
  }
}

function queuePageCountLookup(bvid) {
  if (
    videoPageCounts.has(bvid) ||
    failedPageCountBvids.has(bvid) ||
    queuedPageCountBvids.has(bvid) ||
    activePageCountBvids.has(bvid)
  ) {
    return;
  }
  queuedPageCountBvids.add(bvid);
  pageCountLookupQueue.push(bvid);
  schedulePageCountLookups();
}

async function fetchPageCount(bvid) {
  try {
    const meta = await invoke("get_video_meta", { bvid });
    rememberVideoPages(bvid, meta);
  } catch {
    failedPageCountBvids.add(bvid);
  } finally {
    stopObservingPageCountBvid(bvid);
    activePageCountBvids.delete(bvid);
    activePageCountLookups -= 1;
    schedulePageCountLookups();
  }
}

function observePageCount(item, bvid) {
  if (!bvid || videoPageCounts.has(bvid) || failedPageCountBvids.has(bvid)) {
    return;
  }
  if (pageCountObserver === undefined) {
    pageCountObserver = typeof window.IntersectionObserver === "function"
      ? new window.IntersectionObserver((entries) => {
          for (const entry of entries) {
            const targetBvid = entry.target.dataset.pageCountBvid;
            if (!targetBvid) {
              continue;
            }
            if (
              videoPageCounts.has(targetBvid) ||
              failedPageCountBvids.has(targetBvid)
            ) {
              stopObservingPageCountBvid(targetBvid);
              continue;
            }
            let visibleTargets = visiblePageCountTargets.get(targetBvid);
            if (entry.isIntersecting && entry.target.isConnected) {
              if (!visibleTargets) {
                visibleTargets = new Set();
                visiblePageCountTargets.set(targetBvid, visibleTargets);
              }
              visibleTargets.add(entry.target);
              queuePageCountLookup(targetBvid);
            } else {
              visibleTargets?.delete(entry.target);
              if (visibleTargets?.size === 0) {
                visiblePageCountTargets.delete(targetBvid);
              }
              if (!entry.target.isConnected) {
                observedPageCountTargets.get(targetBvid)?.delete(entry.target);
                pageCountObserver.unobserve(entry.target);
              }
            }
          }
        }, { threshold: 0.01 })
      : null;
  }
  if (!pageCountObserver) {
    return;
  }
  item.dataset.pageCountBvid = bvid;
  let observedTargets = observedPageCountTargets.get(bvid);
  if (!observedTargets) {
    observedTargets = new Set();
    observedPageCountTargets.set(bvid, observedTargets);
  }
  observedTargets.add(item);
  pageCountObserver.observe(item);
}

async function loadVideoPagesForModal(video, onPlay, trigger) {
  const cached = videoPagesByBvid.get(video.bvid);
  if (cached) {
    if (cached.videos <= 1) {
      status.textContent = "该视频只有一个分P";
      return;
    }
    openPagesModal(video, cached.videos, cached.pages, onPlay, trigger);
    return;
  }
  const requestVersion = ++pagesMetaRequestVersion;
  if (pagesMetaStatusBeforeLoad === null) {
    pagesMetaStatusBeforeLoad = status.textContent;
  }
  trigger.setAttribute("aria-busy", "true");
  trigger.dataset.pagesRequestVersion = String(requestVersion);
  status.textContent = "正在获取分P信息…";
  try {
    const meta = await invoke("get_video_meta", { bvid: video.bvid });
    if (requestVersion !== pagesMetaRequestVersion) {
      return;
    }
    const { videos, pages } = rememberVideoPages(video.bvid, meta);
    if (videos <= 1) {
      status.textContent = "该视频只有一个分P";
      return;
    }
    status.textContent = pagesMetaStatusBeforeLoad;
    openPagesModal(video, videos, pages, onPlay, trigger);
  } catch (error) {
    if (requestVersion === pagesMetaRequestVersion) {
      console.warn(`get_video_meta failed for ${video.bvid}:`, error);
      status.textContent = "获取分P信息失败";
    }
  } finally {
    if (requestVersion === pagesMetaRequestVersion) {
      pagesMetaStatusBeforeLoad = null;
    }
    if (trigger.dataset.pagesRequestVersion === String(requestVersion)) {
      trigger.removeAttribute("aria-busy");
      delete trigger.dataset.pagesRequestVersion;
    }
  }
}

function bindTrackActivation(item, playButton, video, onPlay) {
  let clickTimer = null;
  pageModalOpeners.set(playButton, (trigger) => {
    void loadVideoPagesForModal(video, onPlay, trigger);
  });
  updatePageCountBadge(playButton, video.bvid);
  playButton.addEventListener("click", (event) => {
    if (event.detail === 0) {
      onPlay();
      return;
    }
    if (clickTimer !== null) {
      window.clearTimeout(clickTimer);
    }
    clickTimer = window.setTimeout(() => {
      clickTimer = null;
      onPlay();
    }, 250);
  });
  item.addEventListener("dblclick", (event) => {
    if (event.target.closest(".track-actions")) {
      return;
    }
    event.preventDefault();
    if (clickTimer !== null) {
      window.clearTimeout(clickTimer);
      clickTimer = null;
    }
    pageModalOpeners.get(playButton)?.(playButton);
  });
  queueCachedVideoPagesLookup(item, video.bvid);
}

function openPagesModal(video, videos, pages, onPlay, trigger) {
  pagesModalContext = { video, videos, pages, onPlay };
  pagesModalReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
  pagesModalStatus.textContent = "";
  renderPagesModal();

  pagesModal.hidden = false;
  requestAnimationFrame(() => {
    pagesModal.classList.add("is-open");
    pagesModal.setAttribute("aria-hidden", "false");
    const focusTarget =
      pagesModalList.querySelector("button[aria-current]") ??
      pagesModalList.querySelector("button") ?? pagesModalClose;
    pagesModalList.querySelector("button[aria-current]")?.scrollIntoView({ block: "nearest" });
    focusTarget.focus();
  });
}

function renderPagesModal() {
  const { video, videos, pages } = pagesModalContext;
  const bvidKey = video.bvid.toLowerCase();
  const pending = libraryState.disabledPagePending.has(bvidKey);
  const pendingCid = libraryState.disabledPagePending.get(bvidKey);
  const disabledCids = libraryState.disabledPages.get(bvidKey);
  const hadFocus = pagesModalList.contains(document.activeElement) ||
    document.activeElement === pagesModalRestoreAll;
  pagesModalTitle.textContent = "选择分P";
  pagesModalSub.textContent = `${video.title || video.bvid} · 共 ${videos}P`;
  pagesModalRestoreAll.hidden = !disabledCids?.size && !(pending && pendingCid === null);
  pagesModalRestoreAll.disabled = pending;
  pagesModalRestoreAll.textContent = pending && pendingCid === null ? "恢复中…" : "全部恢复";
  pagesModalList.replaceChildren();
  const currentTrack = currentPlayableTrack();
  const currentPage =
    currentTrack?.bvid.toLowerCase() === String(video.bvid).toLowerCase()
      ? currentVideoPage()
      : null;

  for (const page of pages) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const isCurrent = currentPage?.cid === page.cid;
    const isDisabled = isPageDisabled(libraryState.disabledPages, video.bvid, page.cid);
    item.classList.toggle("is-disabled", isDisabled);
    button.type = "button";
    button.className = "pages-list-button";
    button.classList.toggle("is-current", isCurrent);
    button.textContent =
      `${page.page} · ${page.part || `第 ${page.page} P`} · ` +
      `${formatDuration(page.durationSeconds)}${isCurrent ? " · 当前" : ""}`;
    if (isCurrent) {
      button.setAttribute("aria-current", "true");
    }
    button.addEventListener("click", () => {
      const context = pagesModalContext;
      closePagesModal();
      context?.onPlay({ startPage: page, pages: context.pages });
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pages-disable-button";
    toggle.innerHTML = isDisabled
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 18.4 18.4 5.6"/></svg>';
    toggle.title = isDisabled ? "恢复" : "不想听";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.disabled = pending;
    toggle.setAttribute("aria-busy", String(pending && (pendingCid === null || pendingCid === page.cid)));
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      void changeDisabledPages(video.bvid, page.cid, !isDisabled);
    });
    item.append(button, toggle);
    pagesModalList.append(item);
  }
  if (hadFocus) pagesModalClose.focus({ preventScroll: true });
}

async function changeDisabledPages(bvid, cid, disabled = false) {
  const key = bvid.toLowerCase();
  if (libraryState.disabledPagePending.has(key)) return;
  const before = new Set(libraryState.disabledPages.get(key) ?? []);
  const after = new Set(before);
  if (cid === null) after.clear();
  else if (disabled) after.add(cid);
  else after.delete(cid);
  libraryState.disabledPagePending.set(key, cid);
  if (after.size) libraryState.disabledPages.set(key, after);
  else libraryState.disabledPages.delete(key);
  if (pagesModalContext?.video.bvid.toLowerCase() === key) pagesModalStatus.textContent = "";
  if (pagesModalContext?.video.bvid.toLowerCase() === key) renderPagesModal();
  try {
    if (cid === null) await invoke("clear_disabled_pages", { bvid });
    else await invoke("set_page_disabled", { bvid, cid, disabled });
  } catch (error) {
    if (before.size) libraryState.disabledPages.set(key, before);
    else libraryState.disabledPages.delete(key);
    if (pagesModalContext?.video.bvid.toLowerCase() === key) {
      pagesModalStatus.textContent = `保存分P设置失败：${error}`;
    }
  } finally {
    libraryState.disabledPagePending.delete(key);
    if (pagesModalContext?.video.bvid.toLowerCase() === key) renderPagesModal();
  }
}

function openCurrentPagesModal() {
  const video = currentPlayableTrack();
  if (!video || !hasMultipleCurrentPages()) {
    return;
  }
  openPagesModal(
    video,
    playerState.currentPages.length,
    playerState.currentPages,
    ({ startPage }) => playCurrentVideoPage(startPage),
    playerPagesButton,
  );
}

function closePagesModal() {
  pagesModal.classList.remove("is-open");
  pagesModal.setAttribute("aria-hidden", "true");
  pagesModalContext = null;
  const returnFocus = pagesModalReturnFocus;
  pagesModalReturnFocus = null;
  if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
    returnFocus.focus({ preventScroll: true });
  }
}

function keepFocusInPagesModal(event) {
  if (event.key !== "Tab" || !pagesModal.classList.contains("is-open")) {
    return;
  }
  const focusable = [...pagesModal.querySelectorAll("button:not([disabled])")];
  if (focusable.length === 0) {
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export { bindTrackActivation, changeDisabledPages, closePagesModal, keepFocusInPagesModal, openCurrentPagesModal, pagesModalContext };
