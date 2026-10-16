import { buildRandomPageRound, findEnabledPageIndex, isPageDisabled, takeRandomPageFromRound } from "../pages/page-selection.ts";
import type { DeepReadonly } from "../../store/state-store.ts";
import { normalizeTrack } from "../../shared/track-utils.ts";

type QueueHistory = { index: number; cid: number | null; pageLevel?: boolean };
type PlaybackQueueState = {
  queue: ReturnType<typeof normalizeTrack>[]; queueSource: string; queueSearchVersion: number | null; playlistId: string | null;
  currentIndex: number; loopMode: string; shuffle: boolean; randomRemaining: number[]; history: QueueHistory[];
  currentPageIndex: number; currentDisplayTrack: (CommandContract.TrackSnapshotInput & { hasCurrent: boolean }) | null;
  randomPageRound: { bvid: string; playedCount: number; remaining: number[] } | null;
};
type PlaybackQueueSnapshot = DeepReadonly<PlaybackQueueState>;
type QueueNavigation = { kind: "empty" } | { kind: "end" } | { kind: "queue"; index: number; cid?: number | null; repeat?: boolean } | { kind: "page" };

function initialPlaybackQueueState(): PlaybackQueueState {
  return { queue: [], queueSource: "none", queueSearchVersion: null, playlistId: null, currentIndex: -1, loopMode: "sequence", shuffle: false, randomRemaining: [], history: [], currentPageIndex: 0, currentDisplayTrack: null, randomPageRound: null };
}

function shuffledQueueIndexes(values: readonly number[], random: () => number): number[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function createPlaybackQueueActions(read: () => PlaybackQueueSnapshot, commit: (next: PlaybackQueueSnapshot) => void) {
  const update = (fields: Partial<PlaybackQueueSnapshot>) => commit({ ...read(), ...fields });
  const remaining = (random: () => number) => shuffledQueueIndexes(read().queue.map((_, index) => index).filter(index => index !== read().currentIndex), random);
  function replaceQueue(videos: readonly CommandContract.TrackSnapshotInput[], source = "direct", searchVersion: number | null = null, playlistId: string | null = null): void {
    update({ queue: videos.map(normalizeTrack), queueSource: source, queueSearchVersion: source === "search" ? searchVersion : null, playlistId: source === "playlist" ? playlistId : null, currentIndex: -1, history: [] });
  }
  function restoreSelection(index: number): void { update({ queueSource: "restored", currentIndex: Math.max(0, Math.min(Math.round(Number(index) || 0), read().queue.length - 1)) }); }
  function resetPage(): void { update({ currentPageIndex: 0, currentDisplayTrack: null }); }
  function selectPage(index: number): void { update({ currentPageIndex: index, currentDisplayTrack: null }); }
  function selectIndex(index: number, recordCurrent: boolean, cid: number | null): void {
    const previous = read().currentIndex;
    update({ randomPageRound: null, currentIndex: index, ...(recordCurrent && previous >= 0 && previous !== index ? { history: [...read().history, { index: previous, cid }] } : {}) });
  }
  function resetRandom(random: () => number): void { update({ randomRemaining: remaining(random) }); }
  function appendSearchQueue(videos: readonly CommandContract.TrackSnapshotInput[], version: number, random: () => number): boolean {
    if (read().queueSearchVersion !== version) return false;
    const start = read().queue.length, indexes = Array.from({ length: videos.length }, (_, offset) => start + offset).filter(index => index !== read().currentIndex);
    update({ queue: [...read().queue, ...videos.map(normalizeTrack)], ...(read().shuffle && videos.length > 0 ? { randomRemaining: [...read().randomRemaining, ...shuffledQueueIndexes(indexes, random)] } : {}) }); return true;
  }
  function markPlayed(index: number): void { update({ randomRemaining: read().randomRemaining.filter(value => value !== index) }); }
  function drawNextQueueIndex(random: () => number): number | null {
    let values = read().randomRemaining;
    if (values.length === 0) {
      if (read().loopMode !== "list") return null;
      values = remaining(random);
      if (values.length === 0 && read().queue.length === 1) { update({ randomRemaining: values }); return read().currentIndex; }
    }
    const next = values.at(-1) ?? null; update({ randomRemaining: values.slice(0, -1) }); return next;
  }
  function sequentialNextQueueIndex(): number | null { const next = read().currentIndex + 1; return next < read().queue.length ? next : read().loopMode === "list" && read().queue.length > 0 ? 0 : null; }
  function nextNavigation(automatic: boolean, skipFailed: boolean, random: () => number): Exclude<QueueNavigation, { kind: "page" }> {
    if (read().currentIndex < 0) return { kind: "empty" };
    if (automatic && read().loopMode === "single" && !skipFailed) return { kind: "queue", index: read().currentIndex, repeat: true };
    const index = read().shuffle ? drawNextQueueIndex(random) : sequentialNextQueueIndex();
    return index === null || skipFailed && index === read().currentIndex ? { kind: "end" } : { kind: "queue", index };
  }
  function previousNavigation(pages: readonly CommandContract.VideoPage[]): QueueNavigation {
    const state = read();
    if (state.currentIndex < 0) return { kind: "empty" };
    const entry = state.history.at(-1);
    if (entry !== undefined) {
      const { index, cid } = typeof entry === "number" ? { index: entry, cid: null } : entry;
      const pageIndex = index === state.currentIndex && cid != null ? pages.findIndex(page => page.cid === cid) : -1;
      update({ history: state.history.slice(0, -1), ...(pageIndex >= 0 ? { currentPageIndex: pageIndex, currentDisplayTrack: null } : {}) });
      return pageIndex >= 0 ? { kind: "page" } : { kind: "queue", index, cid };
    }
    if (!state.shuffle && state.currentIndex > 0) return { kind: "queue", index: state.currentIndex - 1 };
    return !state.shuffle && state.loopMode === "list" && state.queue.length > 0 ? { kind: "queue", index: state.queue.length - 1 } : { kind: "end" };
  }
  function cycleLoop(modes: readonly { id: string }[]): void { const index = modes.findIndex(mode => mode.id === read().loopMode); update({ loopMode: modes[(index + 1) % modes.length].id }); }
  function changeShuffle(shuffle: boolean, random: () => number): void {
    update({ shuffle, randomPageRound: null, randomRemaining: shuffle ? remaining(random) : [], ...(!shuffle ? { history: read().history.filter(entry => !entry?.pageLevel) } : {}) });
  }
  function advancePage(pages: readonly CommandContract.VideoPage[], disabled: ReadonlyMap<string, ReadonlySet<number>>, random: () => number, readPreferences: () => { order: string; limit: number }): boolean {
    const state = read(), bvid = state.queue[state.currentIndex]?.bvid;
    const unavailable = (page: CommandContract.VideoPage) => isPageDisabled(disabled, bvid, page.cid);
    let round = state.randomPageRound, next: number;
    if (state.shuffle) {
      if (round?.bvid !== bvid) round = null;
      if (!round) round = { bvid, playedCount: 1, remaining: buildRandomPageRound(pages, state.currentPageIndex, unavailable) };
      const { order, limit } = readPreferences();
      if (limit > 0 && round.playedCount >= limit) { update({ randomPageRound: round }); return false; }
      if (order === "random") {
        const picked = takeRandomPageFromRound(round.remaining, index => index === state.currentPageIndex || unavailable(pages[index]), random);
        next = picked.index; round = { ...round, remaining: picked.remaining };
      } else { next = findEnabledPageIndex(pages, state.currentPageIndex + 1, 1, unavailable); round = { ...round, remaining: round.remaining.filter(index => index !== next) }; }
    } else next = findEnabledPageIndex(pages, state.currentPageIndex + 1, 1, unavailable);
    if (next < 0) { if (state.shuffle) update({ randomPageRound: round }); return false; }
    update({ currentPageIndex: next, currentDisplayTrack: null, ...(state.shuffle && round ? { history: [...state.history, { index: state.currentIndex, cid: pages.length > 1 ? pages[state.currentPageIndex]?.cid ?? null : null, pageLevel: true }], randomPageRound: { ...round, playedCount: round.playedCount + 1 } } : {}) }); return true;
  }
  function retreatPage(pages: readonly CommandContract.VideoPage[], disabled: ReadonlyMap<string, ReadonlySet<number>>): boolean {
    const state = read(), bvid = state.queue[state.currentIndex]?.bvid;
    if (pages.length <= 1 || state.currentPageIndex <= 0) return false;
    const previous = findEnabledPageIndex(pages, state.currentPageIndex - 1, -1, page => isPageDisabled(disabled, bvid, page.cid));
    if (previous < 0) return false; selectPage(previous); return true;
  }
  function setDisplayTrack(track: PlaybackQueueSnapshot["currentDisplayTrack"]): void { update({ currentDisplayTrack: track ? { ...track } : null }); }
  function fillTrackMetadata(index: number, metadata: Pick<CommandContract.TrackSnapshotInput, "title" | "uploader" | "thumbnailUrl" | "durationSeconds">): void {
    update({ queue: read().queue.map((track, position) => position === index ? { ...track, ...metadata } : track) });
  }
  return { advancePage, appendSearchQueue, changeShuffle, cycleLoop, fillTrackMetadata, markPlayed, nextNavigation, previousNavigation, replaceQueue, resetPage, resetRandom, restoreSelection, retreatPage, selectIndex, selectPage, setDisplayTrack, takeRandomNext: drawNextQueueIndex };
}

export { createPlaybackQueueActions, initialPlaybackQueueState };
export type { PlaybackQueueSnapshot };
