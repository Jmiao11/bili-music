import { invoke } from "./runtime-api.ts";
import { playerPagesButton } from "./player-dom.ts";
import { PAGE_COUNT_LOOKUP_CONCURRENCY, PAGE_COUNT_LOOKUP_INTERVAL_MS, observedPageCountTargets, pageCountLookupQueue, pageModalOpeners, pendingPageCacheTargets, visiblePageCountTargets } from "./player-state.ts";
import { getApplicationStore } from "./home.ts";
import { preparePagesModal, renderPagesSnapshot, renderPagesTrigger, updatePageCountBadge } from "./pages-view.ts";
import { currentPlayableTrack, currentVideoPage, hasMultipleCurrentPages, playCurrentVideoPage } from "./playback-core.ts";

import { getPlaybackMessagesActions } from "./playback-messages.ts";
import { getPlaybackMessages } from "./playback-messages.ts";

type PageSelection = { startPage?: CommandContract.VideoPage; pages?: CommandContract.VideoPage[] };

let pageCountObserver: IntersectionObserver | null | undefined;
let activePageCountLookups = 0;
let lastPageCountLookupStartedAt = Number.NEGATIVE_INFINITY;
let pageCountLookupTimer: ReturnType<typeof window.setTimeout> | null = null;
let pageCacheLookupScheduled = false;
let pagesMounted = false;
let modalPlayCallback: ((selection: Required<PageSelection>) => void) | null = null;

function queueCachedVideoPagesLookup(item: HTMLElement, bvid: string): void {
  if (!bvid || getPagesSnapshot().videoPageCounts.has(bvid) || getPagesSnapshot().queries.get(bvid)?.phase === "failed") {
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

async function loadCachedVideoPagesBatch(): Promise<void> {
  pageCacheLookupScheduled = false;
  const batch = new Map(pendingPageCacheTargets);
  pendingPageCacheTargets.clear();
  const bvids = [...batch.keys()].filter((bvid) => !getPagesSnapshot().videoPageCounts.has(bvid));
  let cached: CommandMap["get_cached_video_pages"]["result"] = {};
  if (bvids.length > 0) {
    try {
      cached = await invoke("get_cached_video_pages", { bvids });
    } catch {
      cached = {};
    }
  }
  for (const [bvid, targets] of batch) {
    if (cached?.[bvid]) {
      getPagesActions().remember(bvid, cached[bvid]);
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

function stopObservingPageCountBvid(bvid: string): void {
  for (const target of observedPageCountTargets.get(bvid) ?? []) {
    pageCountObserver?.unobserve(target);
  }
  observedPageCountTargets.delete(bvid);
  visiblePageCountTargets.delete(bvid);
}

function hasVisiblePageCountTarget(bvid: string): boolean {
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

function schedulePageCountLookups(): void {
  if (
    pageCountLookupTimer !== null ||
    activePageCountLookups >= PAGE_COUNT_LOOKUP_CONCURRENCY
  ) {
    return;
  }

  while (pageCountLookupQueue.length > 0) {
    const bvid = pageCountLookupQueue[0];
    if (
      getPagesSnapshot().videoPageCounts.has(bvid) ||
      getPagesSnapshot().queries.get(bvid)?.phase === "failed" ||
      getPagesSnapshot().queries.get(bvid)?.phase === "active" ||
      !hasVisiblePageCountTarget(bvid)
    ) {
      pageCountLookupQueue.shift();
      getPagesActions().dropQueued(bvid, performance.now());
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
    getPagesActions().query(bvid, "active", performance.now());
    activePageCountLookups += 1;
    lastPageCountLookupStartedAt = performance.now();
    void fetchPageCount(bvid);
    schedulePageCountLookups();
    return;
  }
}

function queuePageCountLookup(bvid: string): void {
  if (
    getPagesSnapshot().videoPageCounts.has(bvid) ||
    getPagesSnapshot().queries.get(bvid)?.phase === "failed" ||
    getPagesSnapshot().queries.get(bvid)?.phase === "queued" ||
    getPagesSnapshot().queries.get(bvid)?.phase === "active"
  ) {
    return;
  }
  getPagesActions().query(bvid, "queued", performance.now());
  pageCountLookupQueue.push(bvid);
  schedulePageCountLookups();
}

async function fetchPageCount(bvid: string): Promise<void> {
  let data: CommandContract.VideoMeta | null = null;
  try { data = await invoke("get_video_meta", { bvid }); }
  catch { data = null; }
  finally {
    getPagesActions().finishLookup(bvid, data, performance.now());
    stopObservingPageCountBvid(bvid);
    activePageCountLookups -= 1;
    schedulePageCountLookups();
  }
}

function observePageCount(item: HTMLElement, bvid: string): void {
  if (!bvid || getPagesSnapshot().videoPageCounts.has(bvid) || getPagesSnapshot().queries.get(bvid)?.phase === "failed") {
    return;
  }
  if (pageCountObserver === undefined) {
    pageCountObserver = typeof window.IntersectionObserver === "function"
      ? new window.IntersectionObserver((entries: IntersectionObserverEntry[]) => {
          for (const entry of entries) {
            const targetBvid = (entry.target as HTMLElement).dataset.pageCountBvid;
            if (!targetBvid) {
              continue;
            }
            if (
              getPagesSnapshot().videoPageCounts.has(targetBvid) ||
              getPagesSnapshot().queries.get(targetBvid)?.phase === "failed"
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
              visibleTargets.add(entry.target as HTMLElement);
              queuePageCountLookup(targetBvid);
            } else {
              visibleTargets?.delete(entry.target as HTMLElement);
              if (visibleTargets?.size === 0) {
                visiblePageCountTargets.delete(targetBvid);
              }
              if (!entry.target.isConnected) {
                observedPageCountTargets.get(targetBvid)?.delete(entry.target as HTMLElement);
                pageCountObserver?.unobserve(entry.target);
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

async function loadVideoPagesForModal(video: CommandContract.TrackSnapshotInput, onPlay: (selection?: PageSelection) => void, trigger: HTMLElement): Promise<void> {
  const cached = getPagesSnapshot().videoPagesByBvid.get(video.bvid);
  if (cached) {
    if (cached.videos <= 1) {
      getPagesActions().showSinglePage();
      return;
    }
    openPagesModal(video, cached.videos, cached.pages, onPlay, trigger);
    return;
  }
  const requestVersion = getPagesActions().beginModalQuery(getPlaybackMessages().status);
  renderPagesTrigger(trigger, requestVersion, true);
  try {
    const data = await invoke("get_video_meta", { bvid: video.bvid });
    if (requestVersion !== getPagesSnapshot().requestVersion) return;
    if (data.videos > 1) { modalPlayCallback = onPlay; preparePagesModal(trigger); }
    getPagesActions().finishModalQuery(requestVersion, video, data);
  } catch (error) {
    if (requestVersion !== getPagesSnapshot().requestVersion) return;
    console.warn(`get_video_meta failed for ${video.bvid}:`, error);
    getPagesActions().finishModalQuery(requestVersion, video, null);
  } finally { renderPagesTrigger(trigger, requestVersion, false); }
}

function createTrackActivationSession(item: HTMLElement, playButton: HTMLButtonElement, video: CommandContract.TrackSnapshotInput, onPlay: (selection?: PageSelection) => void) {
  let clickTimer: ReturnType<typeof window.setTimeout> | null = null;
  pageModalOpeners.set(playButton, (trigger: HTMLElement) => {
    void loadVideoPagesForModal(video, onPlay, trigger);
  });
  getPagesActions();
  const click = (event: MouseEvent) => {
    if (event.detail === 0) {
      onPlay();
      return;
    }
    if (clickTimer !== null) {
      window.clearTimeout(clickTimer);
    }
    const delayedPlay = onPlay;
    clickTimer = window.setTimeout(() => {
      clickTimer = null;
      delayedPlay();
    }, 250);
  };
  const doubleClick = (event: MouseEvent) => {
    if ((event.target as Element).closest(".track-actions")) {
      return;
    }
    event.preventDefault();
    if (clickTimer !== null) {
      window.clearTimeout(clickTimer);
      clickTimer = null;
    }
    pageModalOpeners.get(playButton)?.(playButton);
  };
  return { handleClick: click, doubleClick,
    update(nextVideo: CommandContract.TrackSnapshotInput, nextPlay: (selection?: PageSelection) => void) { video = nextVideo; onPlay = nextPlay; },
    badge(trigger: HTMLElement) { pageModalOpeners.get(playButton)?.(trigger); },
  };
}
function observeTrackRow(item: HTMLElement, bvid: string): void { queueCachedVideoPagesLookup(item, bvid); }
function unobserveTrackRow(item: HTMLElement): void {
  pageCountObserver?.unobserve(item);
  for (const targets of [pendingPageCacheTargets, observedPageCountTargets, visiblePageCountTargets]) {
    for (const [bvid, elements] of targets) { elements.delete(item); if (elements.size === 0) targets.delete(bvid); }
  }
}
function bindTrackActivation(item: HTMLElement, playButton: HTMLButtonElement, video: CommandContract.TrackSnapshotInput, onPlay: (selection?: PageSelection) => void): void {
  const activation = createTrackActivationSession(item, playButton, video, onPlay);
  updatePageCountBadge(playButton, video.bvid, getPagesSnapshot(), pagesBindings());
  playButton.addEventListener("click", activation.handleClick);
  item.addEventListener("dblclick", activation.doubleClick);
  queueCachedVideoPagesLookup(item, video.bvid);
}

function openPagesModal(video: CommandContract.TrackSnapshotInput, videos: number, pages: readonly CommandContract.VideoPage[], onPlay: (selection: Required<PageSelection>) => void, trigger: Element | null = null): void {
  modalPlayCallback = onPlay; preparePagesModal(trigger); getPagesActions().open(video, videos, pages);
}
function changeDisabledPages(bvid: string, cid: number | null, disabled = false): Promise<void> { getPagesActions(); return getApplicationStore().actions.library.changeDisabledPages(bvid, cid, disabled); }
function openCurrentPagesModal(): void {
  const video = currentPlayableTrack();
  if (!video || !hasMultipleCurrentPages()) {
    return;
  }
  openPagesModal(
    video,
    getApplicationStore().getState().playbackSession.currentPages.length,
    getApplicationStore().getState().playbackSession.currentPages,
    ({ startPage }) => playCurrentVideoPage(startPage),
    playerPagesButton,
  );
}

function closePagesModal(): void { getPagesActions().close(); }
function getPagesSnapshot() { return getApplicationStore().getState().pages; }
function pagesBindings() {
  return { openFromBadge: (button: HTMLButtonElement, trigger: HTMLButtonElement | null | undefined) => pageModalOpeners.get(button)?.(trigger),
    playPage: (page: Readonly<CommandContract.VideoPage>) => { const modal = getPagesSnapshot().modal; closePagesModal(); if (modal) modalPlayCallback?.({ startPage: { ...page }, pages: modal.pages.map(value => ({ ...value })) }); },
    changeDisabledPages, currentTrack: currentPlayableTrack, currentPage: currentVideoPage };
}
function getPagesActions() {
  getPlaybackMessagesActions();
  const store = getApplicationStore();
  if (!pagesMounted) {
    pagesMounted = true;
    let previous: ReturnType<typeof store.getState> | undefined;
    const render = (state: ReturnType<typeof store.getState>) => { const before = previous; previous = state; renderPagesSnapshot(state.pages, state.library, before ? { pages: before.pages, library: before.library } : undefined, pagesBindings()); };
    store.subscribe(render); render(store.getState());
  }
  return store.actions.pages;
}
export { bindTrackActivation, changeDisabledPages, closePagesModal, createTrackActivationSession, getPagesSnapshot, observeTrackRow, openCurrentPagesModal, unobserveTrackRow };
