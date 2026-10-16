import { installRootListProjection, setRootTrackList } from "./root-lists.ts";
import type { TrackListTarget } from "./root-lists.ts";
import type { createApplicationStore } from "../../store/app-state.ts";
import { formatPlayCount, formatPubdate } from "../../shared/track-utils.ts";
import type { SearchSnapshot } from "../search/search-state.ts";
import { homeRankingList } from "../../platform/main-window-dom.ts";
import type { LibraryDragHandlers, LibraryDragVisual, PageSelection, TrackRowModel } from "./track-list-model.ts";
import { getHomeSnapshot } from "../home/home.ts";
import { choosePlaylistAndAdd, projectLibraryLists, removeTrackFromPlaylist, toggleFavorite } from "../library/library-ui.ts";
import { createTrackActivationSession, observeTrackRow, unobserveTrackRow } from "../pages/video-pages.ts";
import { playListItem, playSearchResult } from "../playback/playback-core.ts";

type Snapshot = ReturnType<ReturnType<typeof createApplicationStore>["getState"]>;
type Videos = readonly Readonly<CommandContract.TrackSnapshotInput>[];
type Play = (index: number, selection?: PageSelection) => void;
type RowSession = { model: TrackRowModel | null; index: number; playlistId: string; drag: LibraryDragHandlers | null; item: HTMLElement | null; button: HTMLButtonElement | null; activation: ReturnType<typeof createTrackActivationSession> | null; video: Readonly<CommandContract.TrackSnapshotInput>; play: (selection?: PageSelection) => void; callbacks: Pick<TrackRowModel, "onNodes" | "onClick" | "onDoubleClick" | "onBadge" | "onFavorite" | "onAdd" | "onRemove" | "onCapture" | "onDragStart" | "onDragOver" | "onDragLeave" | "onDrop" | "onDragEnd"> };
type Projection = { library?: { playlistId: string; visual: LibraryDragVisual | null; handlers: LibraryDragHandlers }; inputs: readonly unknown[]; generation: number; videos: Videos; source: string; skeleton: boolean; unavailable: Snapshot["library"]["unavailableBvids"]; play: Play; sessions: Map<string, RowSession> };
let homeProjection: Projection | null = null;
let searchProjection: Projection | null = null;
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
  const activeIndex = search
    ? queue.queueSearchVersion === state.search.requestVersion ? queue.currentIndex : -1
    : projection.source === "favorites" ? queue.queueSource === "favorites" ? queue.currentIndex : -1
    : projection.source === "playlist" ? queue.queueSource === "playlist" && queue.playlistId === state.library.selectedPlaylistId ? queue.currentIndex : -1
    : queue.queueSource === (state.home.mode === "recommendation" ? "recommendation" : "ranking") ? queue.currentIndex : -1;
  const inputs = [projection.videos, projection.source, projection.generation, projection.skeleton, projection.unavailable, activeIndex, state.pages.videoPageCounts, state.library.favoriteBvids, projection.library?.playlistId, projection.library?.visual];
  if (inputs.length === projection.inputs.length && inputs.every((value, index) => Object.is(value, projection.inputs[index]))) return;
  projection.inputs = inputs;
  const duplicates = new Map<string, number>();
  const rows: TrackRowModel[] = projection.videos.map((video, index) => {
    const duplicate = duplicates.get(video.bvid) ?? 0; duplicates.set(video.bvid, duplicate + 1);
    const key = `${projection.library ? projection.source === "playlist" ? projection.library.playlistId : "favorites" : projection.generation}:${video.bvid}:${duplicate}`;
    let session = projection.sessions.get(key);
    if (!session) {
      const current: RowSession = { model: null, index, playlistId: "", drag: null, item: null, button: null, activation: null, video, play: selection => projection.play(current.index, selection), callbacks: {
        onNodes(item, button) {
          if (!item || !button) {
            if (current.item) { unobserveTrackRow(current.item); }
            current.item = null; current.button = null; projection.sessions.delete(key); return;
          }
          if (current.item === item) return;
          current.item = item; current.button = button;
          current.activation = createTrackActivationSession(item, button, current.video, current.play);
          observeTrackRow(item, current.video.bvid);
        },
        onClick: event => current.activation?.handleClick(event),
        onDoubleClick: event => current.activation?.doubleClick(event),
        onBadge() { const trigger = current.button?.parentElement?.querySelector<HTMLButtonElement>(".page-count-badge"); if (trigger) current.activation?.badge(trigger); },
        onFavorite: () => { void toggleFavorite(current.video); },
        onAdd: () => choosePlaylistAndAdd(current.video),
        onRemove: () => { void removeTrackFromPlaylist(current.playlistId, current.video.bvid); },
        onCapture: event => current.drag?.capture(event),
        onDragStart: event => current.drag?.start(event, current.index, key),
        onDragOver: event => current.drag?.over(event, current.index, key),
        onDragLeave: event => current.drag?.leave(event, key),
        onDrop: event => current.drag?.drop(event, current.index),
        onDragEnd: () => current.drag?.end(),
      } };
      session = current; projection.sessions.set(key, session);
    }
    session.video = video; session.index = index; session.playlistId = projection.library?.playlistId ?? ""; session.drag = projection.library?.handlers ?? null;
    session.activation?.update(video, session.play);
    const visual = projection.library?.visual;
    const dragClass = visual?.sourceKey === key ? "is-dragging" : visual?.targetKey === key ? "is-drop-" + visual.direction : "";
    const active = index === activeIndex, pageCount = state.pages.videoPageCounts.get(video.bvid) ?? 0;
    const favorited = state.library.favoriteBvids.has(video.bvid.toLowerCase());
    const unavailableReason = search ? "" : projection.unavailable.get(video.bvid.toLowerCase()) ?? "";
    const previous = session.model;
    const rowVideo = video as TrackRowModel["video"];
    const sameVideo = previous && (previous.video === video || previous.video.bvid === video.bvid && previous.video.title === video.title && previous.video.uploader === video.uploader && previous.video.thumbnailUrl === video.thumbnailUrl && previous.video.durationSeconds === video.durationSeconds && previous.video.playCount === rowVideo.playCount && previous.video.pubdate === rowVideo.pubdate);
    if (previous && sameVideo && previous.index === index && previous.active === active && previous.pageCount === pageCount && previous.favorited === favorited && previous.unavailableReason === unavailableReason && previous.playlistId === projection.library?.playlistId && previous.dragClass === dragClass) return previous;
    return session.model = { key, index, search, video, draggable: projection.library ? true : undefined, showPlayCount: !projection.library, playlistId: projection.library?.playlistId, dragClass, active,
      playCountText: formatPlayCount((video as Readonly<CommandContract.TrackSnapshotInput & { playCount?: number | null }>).playCount),
      pubdateText: formatPubdate((video as Readonly<CommandContract.TrackSnapshotInput & { pubdate?: number | null }>).pubdate),
      pageCount,
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
function renderLibraryTrackRows(_host: HTMLElement, state: Snapshot, videos: Videos, source: "favorites" | "playlist", playlistId: string, unavailable: Snapshot["library"]["unavailableBvids"], visual: LibraryDragVisual | null, handlers: LibraryDragHandlers, play: Play): void {
  const projection = source === "favorites" ? favoritesProjection ??= createProjection(state, source, play) : playlistProjection ??= createProjection(state, source, play);
  projection.videos = videos; projection.unavailable = unavailable; projection.play = play; projection.library = { playlistId, visual, handlers };
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
      const error = kind === "ranking" ? home.error : home.recommendationError;
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
  projectLibraryLists(state);
}
function initializeRootLists(): void { installRootListProjection(projectApplicationLists); }

export { initializeRootLists, renderLibraryTrackRows };
