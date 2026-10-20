import { buildRandomPageRound, findEnabledPageIndex, isPageDisabled, takeRandomPageFromRound } from "../pages/page-selection.ts";
import type { DeepReadonly } from "../../store/state-store.ts";
import { normalizeTrack } from "../../shared/track-utils.ts";
import { collectionInput } from "../library/library-entry.ts";

type QueueInput = CommandContract.TrackSnapshotInput & { entryId?: string; collection?: DeepReadonly<CommandContract.PlaybackCollection> };
type QueueHistory = CommandContract.PlaybackHistory;
type PlaybackQueueState = {
  queue: (ReturnType<typeof normalizeTrack> & Pick<QueueInput, "entryId" | "collection">)[]; queueSource: string; queueSearchVersion: number | null; playlistId: string | null;
  currentIndex: number; loopMode: string; shuffle: boolean; randomRemaining: number[]; history: QueueHistory[];
  currentPageIndex: number; currentDisplayTrack: (CommandContract.TrackSnapshotInput & { hasCurrent: boolean }) | null;
  randomPageRound: { bvid: string; playedCount: number; remaining: number[] } | null;
  collectionNeedsRefresh: boolean;
};
type PlaybackQueueSnapshot = DeepReadonly<PlaybackQueueState>;
type QueueNavigation = { kind: "empty" } | { kind: "end" } | { kind: "queue"; index: number; cid?: number | null; repeat?: boolean } | { kind: "page" };

function initialPlaybackQueueState(): PlaybackQueueState {
  return { queue: [], queueSource: "none", queueSearchVersion: null, playlistId: null, currentIndex: -1, loopMode: "sequence", shuffle: false, randomRemaining: [], history: [], currentPageIndex: 0, currentDisplayTrack: null, randomPageRound: null, collectionNeedsRefresh: false };
}

function activeQueueTrack(state: PlaybackQueueSnapshot) {
  const entry = state.queue[state.currentIndex];
  return entry?.collection ? entry.collection.historyTrack ?? entry.collection.data.snapshot.items[entry.collection.memberIndex] : entry;
}

function libraryQueueEntries(entries: readonly DeepReadonly<CommandContract.LibraryEntry>[]): QueueInput[] {
  return entries.map(entry => entry.kind === "video" ? { ...entry.video, entryId: entry.entryId } : {
    bvid: entry.anchorBvid, title: entry.title, uploader: "合集", thumbnailUrl: entry.thumbnailUrl, durationSeconds: 0, entryId: entry.entryId,
    collection: { data: collectionInput(entry), memberIndex: 0, remaining: entry.snapshot.items.map((_, index) => index).slice(1).reverse(), playedCount: 0, unitCharged: false, chargedUnits: [] },
  });
}

function normalizeQueueEntry(entry: DeepReadonly<QueueInput>) {
  return { ...normalizeTrack(entry), ...(entry.entryId ? { entryId: entry.entryId } : {}), ...(entry.collection ? { collection: { ...entry.collection, data: collectionInput(entry.collection.data), remaining: [...entry.collection.remaining], chargedUnits: [...entry.collection.chargedUnits], ...(entry.collection.historyTrack ? { historyTrack: { ...entry.collection.historyTrack } } : {}) } } : {}) };
}

function playbackQueueEntries(state: PlaybackQueueSnapshot): CommandContract.PlaybackQueueEntry[] {
  return state.queue.map(entry => ({ bvid: entry.bvid, title: entry.title, uploader: entry.uploader, thumbnailUrl: entry.thumbnailUrl, durationSeconds: entry.durationSeconds, addedAt: entry.addedAt,
    ...(entry.entryId ? { entryId: entry.entryId } : {}), ...(entry.collection ? { collection: { ...entry.collection, data: collectionInput(entry.collection.data), remaining: [...entry.collection.remaining], chargedUnits: [...entry.collection.chargedUnits], ...(entry.collection.historyTrack ? { historyTrack: { ...entry.collection.historyTrack } } : {}) } } : {}) }));
}

function playbackTraversal(state: PlaybackQueueSnapshot): CommandContract.PlaybackTraversal {
  return { randomRemaining: [...state.randomRemaining], history: state.history.map(entry => ({ ...entry, ...(entry.track ? { track: { ...entry.track } } : {}) })),
    randomPageRound: state.randomPageRound ? { ...state.randomPageRound, remaining: [...state.randomPageRound.remaining] } : null, shuffle: state.shuffle, loopMode: state.loopMode };
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
  function replaceQueue(videos: readonly DeepReadonly<QueueInput>[], source = "direct", searchVersion: number | null = null, playlistId: string | null = null): void {
    update({ queue: videos.map(normalizeQueueEntry), queueSource: source, queueSearchVersion: source === "search" || source === "collection" ? searchVersion : null, playlistId: source === "playlist" ? playlistId : null, currentIndex: -1, history: [], collectionNeedsRefresh: false });
  }
  function historyEntry(cid: number | null, pageLevel = false): QueueHistory {
    const state = read(), entry = state.queue[state.currentIndex], track = activeQueueTrack(state);
    return { index: state.currentIndex, cid, ...(pageLevel ? { pageLevel: true } : {}), ...(state.queue.some(item => item.collection) ? { entryId: entry.entryId ?? `video:${entry.bvid.toLowerCase()}`, bvid: track?.bvid ?? "", ...(entry.collection && track ? { track: { ...track } } : {}) } : {}) };
  }
  function updateCollection(collection: DeepReadonly<CommandContract.PlaybackCollection>, fields: Partial<PlaybackQueueSnapshot> = {}): void {
    const state = read(); update({ queue: state.queue.map((entry, index) => index === state.currentIndex ? { ...entry, collection } : entry), ...fields });
  }
  function freezeCollection(data: DeepReadonly<CommandContract.LibraryCollection>, order: string, random: () => number): void {
    const indexes = data.snapshot.items.map((_, index) => index);
    const remaining = read().shuffle && order === "random" ? shuffledQueueIndexes(indexes, random) : indexes.reverse();
    const memberIndex = remaining.pop() ?? 0;
    updateCollection({ data: collectionInput(data), memberIndex, remaining, playedCount: 0, unitCharged: false, chargedUnits: [] }, { collectionNeedsRefresh: false, randomPageRound: null, currentPageIndex: 0, currentDisplayTrack: null });
  }
  function settleCollectionUnit(cid: number | null = null): void {
    const state = read(), group = state.queue[state.currentIndex]?.collection;
    if (group && !group.unitCharged) {
      const key = `${activeQueueTrack(state)?.bvid}:${cid ?? `page${state.currentPageIndex}`}`;
      const charged = group.chargedUnits.includes(key);
      updateCollection({ ...group, playedCount: group.playedCount + (charged ? 0 : 1), chargedUnits: charged ? group.chargedUnits : [...group.chargedUnits, key], unitCharged: true });
    }
  }
  function restoreTraversal(traversal: DeepReadonly<CommandContract.PlaybackTraversal>): void {
    update({ ...traversal, randomRemaining: [...traversal.randomRemaining], history: traversal.history.map(entry => ({ ...entry, ...(entry.track ? { track: { ...entry.track } } : {}) })), randomPageRound: traversal.randomPageRound ? { ...traversal.randomPageRound, remaining: [...traversal.randomPageRound.remaining] } : null, collectionNeedsRefresh: false });
  }
  function restoreSelection(index: number): void { update({ queueSource: "restored", currentIndex: Math.max(0, Math.min(Math.round(Number(index) || 0), read().queue.length - 1)) }); }
  function resetPage(): void { update({ currentPageIndex: 0, currentDisplayTrack: null }); }
  function selectPage(index: number): void { update({ currentPageIndex: index, currentDisplayTrack: null }); }
  function selectCollectionPage(index: number, cid: number | null, recordCurrent: boolean): void {
    const group = read().queue[read().currentIndex]?.collection;
    if (group) updateCollection({ ...group, unitCharged: false }, { currentPageIndex: index, currentDisplayTrack: null, ...(recordCurrent ? { history: [...read().history, historyEntry(cid, true)] } : {}) });
  }
  function selectIndex(index: number, recordCurrent: boolean, cid: number | null, refreshCollection = true): void {
    const previous = read().currentIndex;
    update({ randomPageRound: null, currentIndex: index, collectionNeedsRefresh: !!read().queue[index]?.collection && refreshCollection, ...(recordCurrent && previous >= 0 && previous !== index ? { history: [...read().history, historyEntry(cid)] } : {}) });
  }
  function resetRandom(random: () => number): void { update({ randomRemaining: remaining(random) }); }
  function appendSearchQueue(videos: readonly CommandContract.TrackSnapshotInput[], version: number, random: () => number, source = "search"): boolean {
    if (read().queueSource !== source || read().queueSearchVersion !== version) return false;
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
      const pageIndex = index === state.currentIndex && (!entry.bvid || entry.bvid === activeQueueTrack(state)?.bvid) && cid != null ? pages.findIndex(page => page.cid === cid) : -1;
      const group = state.queue[index]?.collection;
      const memberIndex = group && entry.bvid ? group.data.snapshot.items.findIndex(item => item.bvid === entry.bvid) : -1;
      update({ history: state.history.slice(0, -1), ...(group && (memberIndex >= 0 || entry.track) ? { queue: state.queue.map((item, position) => position === index ? { ...item, collection: { ...group, memberIndex: memberIndex >= 0 ? memberIndex : group.memberIndex, remaining: group.remaining.filter(value => value !== memberIndex), historyTrack: memberIndex < 0 ? entry.track : undefined, unitCharged: true } } : item) } : {}), ...(pageIndex >= 0 ? { currentPageIndex: pageIndex, currentDisplayTrack: null } : {}) });
      return pageIndex >= 0 ? { kind: "page" } : { kind: "queue", index, cid };
    }
    if (!state.shuffle && state.currentIndex > 0) return { kind: "queue", index: state.currentIndex - 1 };
    return !state.shuffle && state.loopMode === "list" && state.queue.length > 0 ? { kind: "queue", index: state.queue.length - 1 } : { kind: "end" };
  }
  function cycleLoop(modes: readonly { id: string }[]): void { const index = modes.findIndex(mode => mode.id === read().loopMode); update({ loopMode: modes[(index + 1) % modes.length].id }); }
  function changeShuffle(shuffle: boolean, random: () => number): void {
    update({ shuffle, randomPageRound: null, randomRemaining: shuffle ? remaining(random) : [], ...(!shuffle ? { history: read().history.filter(entry => !entry?.pageLevel) } : {}) });
  }
  function advancePage(pages: readonly CommandContract.VideoPage[], disabled: ReadonlyMap<string, ReadonlySet<number>>, random: () => number, readPreferences: () => { order: string; limit: number }, recordCurrent = true): boolean {
    const state = read(), bvid = activeQueueTrack(state)?.bvid;
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
    const collection = state.queue[state.currentIndex]?.collection;
    update({ currentPageIndex: next, currentDisplayTrack: null, ...((state.shuffle || collection) && recordCurrent ? { history: [...state.history, historyEntry(pages[state.currentPageIndex]?.cid ?? null, true)] } : {}), ...(state.shuffle && round ? { randomPageRound: { ...round, playedCount: round.playedCount + 1 } } : {}) }); return true;
  }
  function advanceCollection(pages: readonly CommandContract.VideoPage[], disabled: ReadonlyMap<string, ReadonlySet<number>>, random: () => number, preferences: { order: string; limit: number }, cid: number | null, recordCurrent: boolean): "page" | "member" | null {
    const state = read(), group = state.queue[state.currentIndex]?.collection;
    if (!group || state.shuffle && preferences.limit > 0 && group.playedCount >= preferences.limit) return null;
    if (pages.length > 1 && advancePage(pages, disabled, random, () => ({ ...preferences, limit: 0 }), recordCurrent)) {
      updateCollection({ ...group, unitCharged: false }); return "page";
    }
    const next = group.remaining.at(-1);
    if (next === undefined) return null;
    updateCollection({ ...group, memberIndex: next, remaining: group.remaining.slice(0, -1), unitCharged: false, historyTrack: undefined }, {
      currentPageIndex: 0, currentDisplayTrack: null, randomPageRound: null,
      ...(recordCurrent ? { history: [...read().history, historyEntry(cid)] } : {}),
    }); return "member";
  }
  function retreatPage(pages: readonly CommandContract.VideoPage[], disabled: ReadonlyMap<string, ReadonlySet<number>>): boolean {
    const state = read(), bvid = activeQueueTrack(state)?.bvid;
    if (pages.length <= 1 || state.currentPageIndex <= 0) return false;
    const previous = findEnabledPageIndex(pages, state.currentPageIndex - 1, -1, page => isPageDisabled(disabled, bvid, page.cid));
    if (previous < 0) return false; selectPage(previous); return true;
  }
  function setDisplayTrack(track: PlaybackQueueSnapshot["currentDisplayTrack"]): void { update({ currentDisplayTrack: track ? { ...track } : null }); }
  function fillTrackMetadata(index: number, metadata: Pick<CommandContract.TrackSnapshotInput, "title" | "uploader" | "thumbnailUrl" | "durationSeconds">): void {
    update({ queue: read().queue.map((track, position) => position !== index ? track : track.collection ? { ...track, collection: { ...track.collection, data: { ...track.collection.data, snapshot: { ...track.collection.data.snapshot, items: track.collection.data.snapshot.items.map((member, memberIndex) => memberIndex === track.collection?.memberIndex ? { ...member, ...metadata } : member) } } } } : { ...track, ...metadata }) });
  }
  return { activeTrack: () => activeQueueTrack(read()), persistedQueue: () => playbackQueueEntries(read()), persistedTraversal: () => playbackTraversal(read()), advanceCollection, freezeCollection, settleCollectionUnit, restoreTraversal, advancePage, appendSearchQueue, changeShuffle, cycleLoop, fillTrackMetadata, markPlayed, nextNavigation, previousNavigation, replaceQueue, resetPage, resetRandom, restoreSelection, retreatPage, selectIndex, selectPage, selectCollectionPage, setDisplayTrack, takeRandomNext: drawNextQueueIndex };
}

export { createPlaybackQueueActions, initialPlaybackQueueState, activeQueueTrack, playbackQueueEntries, playbackTraversal, libraryQueueEntries };
export type { PlaybackQueueSnapshot, QueueInput };
