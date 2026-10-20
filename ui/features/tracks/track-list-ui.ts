import {pagesUiVersion,pagesTriggerVersion,observedPagesBvid} from "../pages/pages-ui-state.ts";
import { installRootListProjection, setRootTrackList } from "./root-lists.ts";
import type { TrackListTarget } from "./root-lists.ts";
import type { createApplicationStore } from "../../store/app-state.ts";
import { formatPlayCount, formatPubdate } from "../../shared/track-utils.ts";
import type { SearchSnapshot } from "../search/search-state.ts";
import { homeRankingList } from "../../platform/main-window-refs.ts";
import type { LibraryDragHandlers, LibraryDragVisual, PageSelection, TrackRowModel } from "./track-list-model.ts";
import { getHomeSnapshot } from "../home/home.ts";
import { choosePlaylistAndAdd, projectLibraryLists, removeTrackFromPlaylist, toggleFavorite, toggleFavoriteCollection, choosePlaylistAndAddCollection, removeCollectionFromPlaylist } from "../library/library-ui.ts";
import { createTrackActivationSession, observeTrackRow, unobserveTrackRow } from "../pages/video-pages.ts";
import { playListItem, playSearchResult } from "../playback/playback-core.ts";
import { playCollectionItem, openLibraryCollection } from "../collections/collection-controller.ts";

type Snapshot = ReturnType<ReturnType<typeof createApplicationStore>["getState"]>;
type Videos = readonly Readonly<CommandContract.TrackSnapshotInput>[];
type Play = (index: number, selection?: PageSelection) => void;
type RowSession = { entry: Snapshot["library"]["favorites"][number] | undefined; model: TrackRowModel | null; index: number; playlistId: string; drag: LibraryDragHandlers | null; item: HTMLElement | null; button: HTMLButtonElement | null; badge: HTMLButtonElement|null;activation: ReturnType<typeof createTrackActivationSession> | null; video: Readonly<CommandContract.TrackSnapshotInput>; play: (selection?: PageSelection) => void; callbacks: Pick<TrackRowModel, "onBadgeNode" | "onNodes" | "onClick" | "onDoubleClick" | "onBadge" | "onFavorite" | "onAdd" | "onRemove" | "onCapture" | "onDragStart" | "onDragOver" | "onDragLeave" | "onDrop" | "onDragEnd"> };
type Projection = { library?: { entries: Snapshot["library"]["favorites"]; playlistId: string; visual: LibraryDragVisual | null; handlers: LibraryDragHandlers }; inputs: readonly unknown[]; generation: number; videos: Videos; source: string; skeleton: boolean; unavailable: Snapshot["library"]["unavailableBvids"]; play: Play; sessions: Map<string, RowSession> };
let homeProjection: Projection | null = null;
let searchProjection: Projection | null = null;
let collectionProjection: Projection | null = null;
let favoritesProjection: Projection | null = null;
let playlistProjection: Projection | null = null;
let committedSearchVersion: number | null = null;
let projectedHomeContent: Snapshot["home"]["view"]["content"] | null = null;
let projectedSearchRows: number | null = null;

function createProjection(state: Snapshot, source: string, play: Play): Projection {
  return { inputs: [], generation: 0, videos: [], source, skeleton: false, unavailable: state.library.unavailableBvids, play, sessions: new Map() };
}
function projectRows(target: TrackListTarget, projection: Projection, state: Snapshot, search: boolean): void {
  const queue = state.playbackQueue;
  const queueIndex = projection.source === "collection"
    ? queue.queueSource === "collection" && queue.queueSearchVersion === state.collection.requestVersion ? queue.currentIndex : -1
    : search
    ? queue.queueSearchVersion === state.search.requestVersion ? queue.currentIndex : -1
    : projection.source === "favorites" ? queue.queueSource === "favorites" ? queue.currentIndex : -1
    : projection.source === "playlist" ? queue.queueSource === "playlist" && queue.playlistId === state.library.selectedPlaylistId ? queue.currentIndex : -1
    : queue.queueSource === (state.home.mode === "recommendation" ? "recommendation" : "ranking") ? queue.currentIndex : -1;
  const activeBvid = queue.queue[queueIndex]?.bvid.toLowerCase();
  const activeEntry = queue.queue[queueIndex];
  const activeIndex = projection.library ? projection.library.entries.findIndex(entry => activeEntry?.entryId ? entry.entryId === activeEntry.entryId : entry.kind === "video" && entry.video.bvid.toLowerCase() === activeBvid) : queueIndex;
  const inputs = [projection.videos, projection.source, projection.generation, projection.skeleton, projection.unavailable, activeIndex, state.pages.videoPageCounts, state.library.favoriteBvids, state.library.favorites, pagesUiVersion(),projection.library?.playlistId, projection.library?.visual];
  if (inputs.length === projection.inputs.length && inputs.every((value, index) => Object.is(value, projection.inputs[index]))) return;
  projection.inputs = inputs;
  const duplicates = new Map<string, number>();
  const rows: TrackRowModel[] = projection.videos.map((video, index) => {
    const entry = projection.library?.entries[index];
    const identity = entry?.entryId ?? video.bvid;
    const duplicate = duplicates.get(identity) ?? 0; duplicates.set(identity, duplicate + 1);
    const collection = entry?.kind === "collection" ? entry : undefined;
    const key = entry ? `${projection.library?.playlistId || "favorites"}:${entry.entryId}:${duplicate}` : `${projection.generation}:${video.bvid}:${duplicate}`;
    let session = projection.sessions.get(key);
    if (!session) {
      const current: RowSession = { model: null, index, playlistId: "", drag: null, item: null, button: null,badge:null, activation: null, entry, video, play: selection => projection.play(current.index, selection), callbacks: {
        onBadgeNode(node) {current.badge=node;},
        onNodes(item, button) {
          if (!item || !button) {
            if (current.item) { unobserveTrackRow(current.item); }
            current.item = null; current.button = null; projection.sessions.delete(key); return;
          }
          if (current.item === item) return;
          current.item = item; current.button = button;
          current.activation = createTrackActivationSession(item, button, current.video, current.play, current.entry?.kind === "collection" ? () => { if (current.entry?.kind === "collection") openLibraryCollection(current.entry, current.playlistId || null); } : undefined);
          if (current.entry?.kind !== "collection") observeTrackRow(item, current.video.bvid);
        },
        onClick: event => current.activation?.handleClick(event),
        onDoubleClick: event => current.activation?.doubleClick(event),
        onBadge() { const trigger = current.button?.parentElement?.querySelector<HTMLButtonElement>(".page-count-badge"); if (trigger) current.activation?.badge(trigger); },
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
    session.entry = entry; session.video = video; session.index = index; session.playlistId = projection.library?.playlistId ?? ""; session.drag = projection.library?.handlers ?? null;
    session.activation?.update(video, session.play);
    const visual = projection.library?.visual;
    const dragClass = visual?.sourceKey === key ? "is-dragging" : visual?.targetKey === key ? "is-drop-" + visual.direction : "";
    const active = index === activeIndex, pageCount = collection ? 0 : state.pages.videoPageCounts.get(video.bvid) ?? 0;
    const favorited = collection ? state.library.favorites.some(entry => entry.kind === "collection" && entry.collectionId === collection.collectionId) : state.library.favoriteBvids.has(video.bvid.toLowerCase());
    const unavailableReason = collection ? collection.sourceStatus === "invalid" ? "合集来源已失效" : "" : search ? "" : projection.unavailable.get(video.bvid.toLowerCase()) ?? "";
    const playPagesVersion=pagesTriggerVersion(session.button),badgePagesVersion=pagesTriggerVersion(session.badge),pageCountBvid=observedPagesBvid(session.item);
    const previous = session.model;
    const rowVideo = video as TrackRowModel["video"];
    const sameVideo = previous && (previous.video === video || previous.video.bvid === video.bvid && previous.video.title === video.title && previous.video.uploader === video.uploader && previous.video.thumbnailUrl === video.thumbnailUrl && previous.video.durationSeconds === video.durationSeconds && previous.video.playCount === rowVideo.playCount && previous.video.pubdate === rowVideo.pubdate);
    if (previous && previous.collection === collection && sameVideo && previous.index === index && previous.active === active && previous.pageCount === pageCount && previous.favorited === favorited && previous.unavailableReason === unavailableReason && previous.playlistId === projection.library?.playlistId && previous.dragClass === dragClass && previous.playPagesVersion === playPagesVersion && previous.badgePagesVersion === badgePagesVersion && previous.pageCountBvid === pageCountBvid) return previous;
    return session.model = { key, index, search, video, collection, draggable: projection.library ? true : undefined, showPlayCount: !projection.library, playlistId: projection.library?.playlistId, dragClass, active,
      playCountText: formatPlayCount((video as Readonly<CommandContract.TrackSnapshotInput & { playCount?: number | null }>).playCount),
      pubdateText: formatPubdate((video as Readonly<CommandContract.TrackSnapshotInput & { pubdate?: number | null }>).pubdate),
      pageCount,playPagesVersion,badgePagesVersion,pageCountBvid,
      favorited,
      unavailableReason, ...session.callbacks };
  });
  setRootTrackList(target, rows, projection.skeleton);
}
function renderHomeRows(state: Snapshot, videos: Videos, source: string, skeleton: boolean, play: Play): void {
  if (!homeRankingList) return;
  homeProjection ??= createProjection(state, source, play);
  if (videos !== homeProjection.videos || source !== homeProjection.source) homeProjection.generation++;
  homeProjection.videos = videos; homeProjection.source = source; homeProjection.skeleton = skeleton;
  homeProjection.unavailable = state.library.unavailableBvids; homeProjection.play = play;
  projectRows("home", homeProjection, state, false);
}
function refreshHomeRows(state: Snapshot): void { if (homeRankingList && homeProjection) projectRows("home", homeProjection, state, false); }
function renderSearchRows(state: Snapshot, search: SearchSnapshot, play: Play): void {
  searchProjection ??= createProjection(state, "search", play);
  if (!search.searchBusy && search.page === 1 && search.results !== searchProjection.videos && search.requestVersion !== committedSearchVersion) {
    searchProjection.generation++; committedSearchVersion = search.requestVersion;
  }
  searchProjection.videos = search.results; searchProjection.play = play;
  projectRows("search", searchProjection, state, true);
}
function refreshSearchRows(state: Snapshot): void { if (searchProjection) projectRows("search", searchProjection, state, true); }
function renderLibraryTrackRows(_host: HTMLElement, state: Snapshot, videos: Snapshot["library"]["favorites"], source: "favorites" | "playlist", playlistId: string, unavailable: Snapshot["library"]["unavailableBvids"], visual: LibraryDragVisual | null, handlers: LibraryDragHandlers, play: Play): void {
  const projection = source === "favorites" ? favoritesProjection ??= createProjection(state, source, play) : playlistProjection ??= createProjection(state, source, play);
  if (projection.library?.entries !== videos) projection.videos = videos.map(entry => entry.kind === "video" ? entry.video : { ...entry.snapshot.items[0], title: entry.title, thumbnailUrl: entry.thumbnailUrl, durationSeconds: 0 });
  projection.unavailable = unavailable; projection.play = play; projection.library = { entries: videos, playlistId, visual, handlers };
  projectRows(source === "favorites" ? "favorites" : "playlist", projection, state, false);
}
function projectApplicationLists(state: Snapshot): void {
  const home = state.home;
  if (home.view.content !== projectedHomeContent) {
    projectedHomeContent = home.view.content;
    const kind = home.view.content.kind;
    if (kind === "ranking" || kind === "recommendations") {
      const source = kind === "ranking" ? "ranking" : "recommendation";
      const skeleton = kind === "ranking" ? home.loading : home.recommendationLoading;
      const error = kind === "ranking" ? home.error : "";
      const videos = skeleton || error ? [] : kind === "ranking" ? home.ranking : home.recommendations;
      renderHomeRows(state, videos, source, skeleton, (index, selection) => {
        const current = getHomeSnapshot();
        playListItem(source, source === "ranking" ? current.ranking : current.recommendations, index, selection);
      });
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
  projectLibraryLists(state);
}
function initializeRootLists(): void { installRootListProjection(projectApplicationLists); }

export { initializeRootLists, renderLibraryTrackRows };
