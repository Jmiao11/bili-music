import { formatPlayedAt } from "../recent/recent-state.ts";
import { formatHomeTrackDuration, formatPlayCount, formatPubdate, homeTrackThumbnail, normalizeTrack } from "../../shared/track-utils.ts";
import {pagesUiVersion,pagesTriggerVersion,observedPagesBvid} from "../pages/pages-ui-state.ts";
import { installRootListProjection, readLibraryFilter, setRootTrackList } from "./root-lists.ts";
import type { TrackListTarget } from "./root-lists.ts";
import type { createApplicationStore } from "../../store/app-state.ts";
import type { SearchSnapshot } from "../search/search-state.ts";
import type { LibraryDragHandlers, LibraryDragVisual, PageSelection, TrackRowModel } from "./track-list-model.ts";
import { getHomeSnapshot } from "../home/home.ts";
import { homeFeeds, type HomeFeed } from "../home/home-view.ts";
import { choosePlaylistAndAdd, playPlaylistEntry, projectLibraryLists, removeTrackFromPlaylist, toggleFavorite, toggleFavoriteCollection, choosePlaylistAndAddCollection, removeCollectionFromPlaylist } from "../library/library-ui.ts";
import { createTrackActivationSession, observeTrackRow, suspendTrackRowLookup, unobserveTrackRow } from "../pages/video-pages.ts";
import { libraryEntryMatch, libraryTitleParts, matchesLibraryTerms } from "../library/library-entry.ts";
import { playListItem, playSearchResult, queueVideoNext } from "../playback/playback-core.ts";
import { playCollectionItem, openLibraryCollection } from "../collections/collection-controller.ts";

type Snapshot = ReturnType<ReturnType<typeof createApplicationStore>["getState"]>;
type Videos = readonly Readonly<CommandContract.TrackSnapshotInput>[];
type Play = (index: number, selection?: PageSelection) => void;
type Entry = Snapshot["library"]["favorites"][number];
type Playlist = Snapshot["library"]["playlists"][number];
type PlaylistHit = { playlist: Playlist; entry: Entry; index: number; collectionHits: number };
type RowSession = { entry: Entry | undefined; model: TrackRowModel | null; index: number; playlistId: string; drag: LibraryDragHandlers | null; lookup: boolean; openCollection: boolean; item: HTMLElement | null; button: HTMLButtonElement | null; badge: HTMLButtonElement|null;activation: ReturnType<typeof createTrackActivationSession> | null; video: Readonly<CommandContract.TrackSnapshotInput>; play: (selection?: PageSelection) => void; callbacks: Pick<TrackRowModel, "onBadgeNode" | "onNodes" | "onClick" | "onDoubleClick" | "onBadge" | "onQueueNext" | "onFavorite" | "onAdd" | "onRemove" | "onCapture" | "onDragStart" | "onDragOver" | "onDragLeave" | "onDrop" | "onDragEnd"> };
type Projection = { recent?: Snapshot["recent"]; library?: { entries: Snapshot["library"]["favorites"]; playlistId: string; visual: LibraryDragVisual | null; handlers: LibraryDragHandlers }; cross?: { hits: readonly PlaylistHit[]; playlists: readonly Playlist[]; terms: readonly string[]; total: number }; pauseLookups?: boolean; terms?: readonly string[]; lastActiveIndex?: number; inputs: readonly unknown[]; generation: number; videos: Videos; source: string; skeleton: boolean; unavailable: Snapshot["library"]["unavailableBvids"]; play: Play; sessions: Map<string, RowSession> };
const noTerms: readonly string[] = [];
const filteredLists = new Map<TrackListTarget, Projection>();
const discoveryProjections: Partial<Record<"newSongs" | "forYou", Projection>> = {};
let homeProjection: Projection | null = null;
let searchProjection: Projection | null = null;
let recentProjection: Projection | null = null;
let collectionProjection: Projection | null = null;
let favoritesProjection: Projection | null = null;
let playlistProjection: Projection | null = null;
let playlistSearchProjection: Projection | null = null;
let committedSearchVersion: number | null = null;
let projectedHomeContent: Snapshot["home"]["view"]["content"] | null = null;
let projectedSearchRows: number | null = null;

function createProjection(state: Snapshot, source: string, play: Play): Projection {
  return { inputs: [], generation: 0, videos: [], source, skeleton: false, unavailable: state.library.unavailableBvids, play, sessions: new Map() };
}
function activeLibraryIndex(queue: Snapshot["playbackQueue"], source: string, playlistId: string, entries: Snapshot["library"]["favorites"]): number {
  if (queue.queueSource !== source || source === "playlist" && queue.playlistId !== playlistId) return -1;
  const active = queue.queue[queue.currentIndex];
  if (!active) return -1;
  const bvid = active.bvid.toLowerCase();
  return entries.findIndex(entry => active.entryId ? entry.entryId === active.entryId : entry.kind === "video" && entry.video.bvid.toLowerCase() === bvid);
}
function projectRows(target: TrackListTarget, projection: Projection, state: Snapshot, search: boolean): void {
  const queue = state.playbackQueue;
  const filter = readLibraryFilter(state);
  const filterable = target === "favorites" || target === "recent" || target === "playlist";
  const queueIndex = projection.source === "collection"
    ? queue.queueSource === "collection" && queue.queueSearchVersion === state.collection.requestVersion ? queue.currentIndex : -1
    : search
    ? queue.queueSearchVersion === state.search.requestVersion ? queue.currentIndex : -1
    : projection.source === "recent" ? queue.queueSource === "recent" ? queue.currentIndex : -1
    : queue.queueSource === projection.source ? queue.currentIndex : -1;
  const activeBvid = queue.queue[queueIndex]?.bvid.toLowerCase();
  const currentIndex = projection.library
    ? activeLibraryIndex(queue, projection.source, state.library.selectedPlaylistId, projection.library.entries)
    : projection.source === "recent" ? projection.videos.findIndex(video => video.bvid.toLowerCase() === activeBvid) : queueIndex;
  const activeIndex = filterable && filter.terms.length ? projection.lastActiveIndex ?? currentIndex : currentIndex;
  projection.lastActiveIndex = activeIndex;
  const homeFeed = state.home.aiHasKey !== null && (Object.hasOwn(homeFeeds, projection.source) || projection.source === "recommendation");
  const view = state.settings.session.currentView;
  const shown = !state.collection.active && (target === "playlist" ? view === "playlists" && state.library.view.playlistDetail : target === view);
  const terms = projection.cross?.terms ?? projection.terms ?? noTerms;
  if (filterable && shown) projection.pauseLookups = filter.pauseLookups;
  const lookup = !projection.pauseLookups && !projection.cross && !projection.terms;
  const crossActive = projection.cross && queue.queueSource === "playlist" ? queue.queue[queue.currentIndex] : undefined;
  const inputs = [projection.videos, projection.source, projection.generation, projection.skeleton, projection.unavailable, activeIndex, state.pages.videoPageCounts, state.library.favoriteBvids, state.library.favorites, pagesUiVersion(),projection.library?.playlistId, projection.library?.visual, projection.recent, homeFeed, terms, lookup, projection.cross, crossActive, crossActive && queue.playlistId];
  if (inputs.length === projection.inputs.length && inputs.every((value, index) => Object.is(value, projection.inputs[index]))) return;
  projection.inputs = inputs;
  const duplicates = new Map<string, number>();
  const rows: TrackRowModel[] = [];
  for (const [index, video] of projection.videos.entries()) {
    const hit = projection.cross?.hits[index];
    const entry = hit?.entry ?? projection.library?.entries[index];
    const originalIndex = hit?.index ?? index;
    const playlistId = hit?.playlist.id ?? projection.library?.playlistId ?? "";
    const identity = entry?.entryId ?? video.bvid;
    const duplicate = duplicates.get(identity) ?? 0; duplicates.set(identity, duplicate + 1);
    const hits = hit?.collectionHits ?? (terms.length ? entry
      ? libraryEntryMatch(entry, terms, projection.source === "playlist" ? "" : undefined)
      : matchesLibraryTerms(terms, video.title, video.uploader) ? 0 : -1 : 0);
    if (hits < 0) continue;
    const collectionHits = hits;
    const collection = entry?.kind === "collection" ? entry : undefined;
    const key = entry ? `${playlistId || "favorites"}:${entry.entryId}:${duplicate}` : `${projection.generation}:${video.bvid}:${duplicate}`;
    let session = projection.sessions.get(key);
    if (!session) {
      const current: RowSession = { model: null, index, playlistId, drag: null, lookup, openCollection: false, item: null, button: null,badge:null, activation: null, entry, video, play: selection => {
        if (current.openCollection && current.entry?.kind === "collection") openLibraryCollection(current.entry, current.playlistId || null);
        else projection.play(current.index, selection);
      }, callbacks: {
        onBadgeNode(node) {current.badge=node;},
        onNodes(item, button) {
          if (!item || !button) {
            if (current.item) { unobserveTrackRow(current.item); }
            current.item = null; current.button = null; projection.sessions.delete(key); return;
          }
          if (current.item === item) return;
          current.item = item; current.button = button;
          projection.sessions.set(key, current);
          current.activation = createTrackActivationSession(item, button, current.video, current.play, current.entry?.kind === "collection" ? () => { if (current.entry?.kind === "collection") openLibraryCollection(current.entry, current.playlistId || null); } : undefined);
          if (current.lookup && current.entry?.kind !== "collection") observeTrackRow(item, current.video.bvid);
        },
        onClick: event => current.activation?.handleClick(event),
        onDoubleClick: event => current.activation?.doubleClick(event),
        onBadge() { const trigger = current.button?.parentElement?.querySelector<HTMLButtonElement>(".page-count-badge"); if (trigger) current.activation?.badge(trigger); },
        onQueueNext: () => queueVideoNext(current.video),
        onFavorite: () => { void (current.entry?.kind === "collection" ? toggleFavoriteCollection(current.entry) : toggleFavorite(current.video)); },
        onAdd: () => current.entry?.kind === "collection" ? choosePlaylistAndAddCollection(current.entry) : choosePlaylistAndAdd(current.video),
        onRemove: () => { void (current.entry?.kind === "collection" ? removeCollectionFromPlaylist(current.playlistId, current.entry.entryId) : removeTrackFromPlaylist(current.playlistId, current.video.bvid)); },
        onCapture: event => current.drag?.capture(event),
        onDragStart: event => current.drag?.start(event, current.index, key),
        onDragOver: event => current.drag?.over(event, current.index, key),
        onDragLeave: event => current.drag?.leave(event, key),
        onDrop: event => current.drag?.drop(event, current.index),
        onDragEnd: () => current.drag?.end(),
      } };
      session = current; projection.sessions.set(key, session);
    }
    if (session.item && session.lookup !== lookup && entry?.kind !== "collection") {
      if (lookup) observeTrackRow(session.item, video.bvid);
      else suspendTrackRowLookup(session.item);
    }
    session.entry = entry; session.video = video; session.index = index; session.playlistId = playlistId; session.drag = terms.length ? null : projection.library?.handlers ?? null;
    session.lookup = lookup; session.openCollection = terms.length > 0;
    session.activation?.update(video, session.play);
    const visual = projection.library?.visual;
    const dragClass = visual?.sourceKey === key ? "is-dragging" : visual?.targetKey === key ? "is-drop-" + visual.direction : "";
    const active = hit
      ? Boolean(crossActive && queue.playlistId === playlistId && (crossActive.entryId ? crossActive.entryId === entry?.entryId : crossActive.bvid.toLowerCase() === video.bvid.toLowerCase()))
      : index === activeIndex;
    const pageCount = collection ? 0 : state.pages.videoPageCounts.get(video.bvid) ?? 0;
    const favorited = collection ? state.library.favorites.some(entry => entry.kind === "collection" && entry.collectionId === collection.collectionId) : state.library.favoriteBvids.has(video.bvid.toLowerCase());
    const unavailableReason = collection ? collection.sourceStatus === "invalid" ? "合集来源已失效" : "" : search ? "" : projection.unavailable.get(video.bvid.toLowerCase()) ?? "";
    const playPagesVersion=pagesTriggerVersion(session.button),badgePagesVersion=pagesTriggerVersion(session.badge),pageCountBvid=observedPagesBvid(session.item);
    const cached = projection.recent?.cached.has(video.bvid.toLowerCase());
    const needsNetwork = projection.recent ? !projection.recent.online && !cached : undefined;
    const playCountText = projection.recent ? formatPlayedAt(projection.recent.items[index].lastPlayedAt, new Date(projection.recent.now)) : formatPlayCount((video as TrackRowModel["video"]).playCount);
    const durationText = homeFeed ? formatHomeTrackDuration(video.durationSeconds) : undefined;
    const thumbnailSrc = homeFeed ? homeTrackThumbnail(video.thumbnailUrl) : undefined;
    const previous = session.model;
    const rowVideo = video as TrackRowModel["video"];
    const sameVideo = previous && (previous.video === video || previous.video.bvid === video.bvid && previous.video.title === video.title && previous.video.uploader === video.uploader && previous.video.thumbnailUrl === video.thumbnailUrl && previous.video.durationSeconds === video.durationSeconds && previous.video.playCount === rowVideo.playCount && previous.video.pubdate === rowVideo.pubdate);
    const titleParts = terms.length ? libraryTitleParts(video.title, terms) : undefined;
    const oldParts = previous?.titleParts;
    const sameParts = titleParts === oldParts || Boolean(titleParts && oldParts && titleParts.length === oldParts.length && titleParts.every((part, index) => part.match === oldParts[index].match && part.text === oldParts[index].text));
    if (previous && previous.cached === cached && previous.needsNetwork === needsNetwork && previous.playCountText === playCountText && previous.durationText === durationText && previous.thumbnailSrc === thumbnailSrc && previous.collection === collection && sameVideo && previous.index === originalIndex && previous.active === active && previous.pageCount === pageCount && previous.favorited === favorited && previous.unavailableReason === unavailableReason && previous.playlistId === projection.library?.playlistId && previous.dragClass === dragClass && previous.playPagesVersion === playPagesVersion && previous.badgePagesVersion === badgePagesVersion && previous.pageCountBvid === pageCountBvid && sameParts && previous.filterDragDisabled === Boolean(terms.length) && previous.collectionHits === collectionHits && previous.fromPlaylist === hit?.playlist.name && previous.localArtwork === !lookup) {
      rows.push(previous);
      continue;
    }
    const pubdateText = formatPubdate((video as Readonly<CommandContract.TrackSnapshotInput & { pubdate?: number | null }>).pubdate);
    const creatorTitle = target === "search" ? [video.uploader || video.bvid, pubdateText].filter(Boolean).join(" · ") : undefined;
    rows.push(session.model = { key, index: originalIndex, search, video, cached, needsNetwork, collection, draggable: projection.library ? !terms.length : undefined, showPlayCount: !projection.library && !hit, playlistId: projection.library?.playlistId, dragClass, active, creatorTitle,
      titleParts, collectionHits, fromPlaylist: hit?.playlist.name, filterDragDisabled: Boolean(terms.length), localArtwork: !lookup,
      durationText, thumbnailSrc,
      playCountText,
      pubdateText,
      pageCount,playPagesVersion,badgePagesVersion,pageCountBvid,
      favorited,
      unavailableReason, ...session.callbacks });
  }
  setRootTrackList(target, rows, projection.skeleton, projection.cross?.total);
}

function projectFilteredLibrary(target: "favoritesFiltered" | "playlistFiltered" | "recentFiltered", source: Projection, state: Snapshot): void {
  const { scope, terms } = readLibraryFilter(state);
  if (!terms.length || (source.source === "playlist" ? !scope.startsWith("playlist:") : scope !== source.source)) return;
  let filtered = filteredLists.get(target);
  if (!filtered) {
    filtered = createProjection(state, source.source, source.play);
    filteredLists.set(target, filtered);
  }
  filtered.videos = source.videos;
  filtered.library = source.library;
  filtered.recent = source.recent;
  filtered.unavailable = source.unavailable;
  filtered.play = source.play;
  filtered.terms = terms;
  projectRows(target, filtered, state, false);
}
function renderHomeRows(state: Snapshot, videos: Videos, source: string, skeleton: boolean, play: Play): void {
  homeProjection ??= createProjection(state, source, play);
  if (videos !== homeProjection.videos || source !== homeProjection.source) homeProjection.generation++;
  homeProjection.videos = videos; homeProjection.source = source; homeProjection.skeleton = skeleton;
  homeProjection.unavailable = state.library.unavailableBvids; homeProjection.play = play;
  projectRows("home", homeProjection, state, false);
}
function refreshHomeRows(state: Snapshot): void { if (homeProjection) projectRows("home", homeProjection, state, false); }
function renderSearchRows(state: Snapshot, search: SearchSnapshot, play: Play): void {
  searchProjection ??= createProjection(state, "search", play);
  if (!search.searchBusy && search.page === 1 && search.results !== searchProjection.videos && search.requestVersion !== committedSearchVersion) {
    searchProjection.generation++; committedSearchVersion = search.requestVersion;
  }
  searchProjection.videos = search.results; searchProjection.play = play;
  projectRows("search", searchProjection, state, true);
}
function refreshSearchRows(state: Snapshot): void { if (searchProjection) projectRows("search", searchProjection, state, true); }
function libraryEntryVideo(entry: Entry): Readonly<CommandContract.TrackSnapshotInput> {
  return entry.kind === "video" ? entry.video : { ...entry.snapshot.items[0], title: entry.title, thumbnailUrl: entry.thumbnailUrl, durationSeconds: 0 };
}
function renderLibraryTrackRows(_host: HTMLElement, state: Snapshot, videos: Snapshot["library"]["favorites"], source: "favorites" | "playlist", playlistId: string, unavailable: Snapshot["library"]["unavailableBvids"], visual: LibraryDragVisual | null, handlers: LibraryDragHandlers, play: Play): void {
  const projection = source === "favorites" ? favoritesProjection ??= createProjection(state, source, play) : playlistProjection ??= createProjection(state, source, play);
  if (projection.library?.entries !== videos) projection.videos = videos.map(libraryEntryVideo);
  projection.unavailable = unavailable; projection.play = play; projection.library = { entries: videos, playlistId, visual, handlers };
  projectRows(source === "favorites" ? "favorites" : "playlist", projection, state, false);
  projectFilteredLibrary(source === "favorites" ? "favoritesFiltered" : "playlistFiltered", projection, state);
}
function renderPlaylistSearch(state: Snapshot): void {
  const { scope, terms } = readLibraryFilter(state);
  if (scope !== "playlists" || !terms.length) return;
  const playlists = state.library.playlists;
  const projection: Projection = playlistSearchProjection ??= createProjection(state, "playlistSearch", (index, selection) => {
    const hit = projection.cross?.hits[index];
    if (hit) playPlaylistEntry(hit.playlist, hit.index, selection);
  });
  if (projection.cross?.playlists !== playlists || projection.cross.terms !== terms) {
    const hits: PlaylistHit[] = [];
    let total = 0;
    for (const playlist of playlists) {
      playlist.items.forEach((entry, index) => {
        const collectionHits = libraryEntryMatch(entry, terms, playlist.name);
        if (collectionHits < 0) return;
        total++;
        if (hits.length < 200) hits.push({ playlist, entry, index, collectionHits });
      });
    }
    projection.cross = { hits, playlists, terms, total };
    projection.videos = hits.map(hit => libraryEntryVideo(hit.entry));
  }
  projection.unavailable = state.library.unavailableBvids;
  projectRows("playlistSearch", projection, state, false);
}
function playHomeTrack(source: HomeFeed, index: number, selection?: PageSelection): void {
  if (source === "ai") playListItem("recommendation", getHomeSnapshot().recommendations, index, selection);
  else playListItem(source, getHomeSnapshot()[source], index, selection);
}
function projectApplicationLists(state: Snapshot): void {
  const home = state.home;
  const aiRows = home.view.section === "ai" || home.aiHasKey === null && home.view.content.kind === "recommendations";
  const source = aiRows ? "recommendation" : "ranking";
  if (home.view.content !== projectedHomeContent || homeProjection?.source !== source) {
    projectedHomeContent = home.view.content;
    if (home.aiHasKey !== null || home.view.content.kind !== "mode") {
      const skeleton = aiRows ? home.recommendationLoading : home.loading && !home.ranking.length;
      const videos = skeleton || !aiRows && home.error ? [] : aiRows ? home.recommendations : home.ranking;
      renderHomeRows(state, videos, source, skeleton, aiRows
        ? (index, selection) => playHomeTrack("ai", index, selection) : playRankingTrack);
    }
  }
  if(home.aiHasKey !== null) {
    for (const source of ["newSongs", "forYou"] as const) {
      const projection = discoveryProjections[source] ??= createProjection(state, source, (index, selection) => playHomeTrack(source, index, selection));
      if (projection.videos !== home[source]) projection.generation++;
      projection.videos = home[source];
      projection.skeleton = home.feed[source].busy && !projection.videos.length;
      projection.unavailable = state.library.unavailableBvids;
      projectRows(source, projection, state, false);
    }
  }
  refreshHomeRows(state);
  if (state.search.view.rowsVersion !== null && state.search.view.rowsVersion !== projectedSearchRows) {
    projectedSearchRows = state.search.view.rowsVersion;
    renderSearchRows(state, state.search, playSearchResult);
  }
  refreshSearchRows(state);
  if (state.collection.active) {
    collectionProjection ??= createProjection(state, "collection", playCollectionItem);
    if (collectionProjection.generation !== state.collection.requestVersion) collectionProjection.generation = state.collection.requestVersion;
    collectionProjection.videos = state.collection.items;
    projectRows("collection", collectionProjection, state, true);
  }
  if (state.settings.session.currentView === "recent") {
    recentProjection ??= createProjection(state, "recent", (index, selection) => playListItem("recent", state.recent.items, index, selection));
    if (recentProjection.recent?.items !== state.recent.items) recentProjection.videos = state.recent.items.map(normalizeTrack);
    recentProjection.recent = state.recent;
    recentProjection.play = (index, selection) => playListItem("recent", state.recent.items, index, selection);
    projectRows("recent", recentProjection, state, false);
    projectFilteredLibrary("recentFiltered", recentProjection, state);
  }
  projectLibraryLists(state);
  renderPlaylistSearch(state);
}
function playRankingTrack(index: number, selection?: PageSelection): void { playHomeTrack("ranking", index, selection); }
function initializeRootLists(): void { installRootListProjection(projectApplicationLists); }

export { activeLibraryIndex, initializeRootLists, playHomeTrack, renderLibraryTrackRows };
