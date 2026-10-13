import type { createApplicationStore } from "./app-state.ts";
import type { SearchSnapshot } from "./search-state.ts";
import type { LibraryDragHandlers, LibraryDragVisual, PageSelection, TrackRowModel } from "./track-list-model.ts";
import { formatPlayCount, formatPubdate } from "./track-utils.ts";
import { homeRankingList, searchResults } from "./player-dom.ts";
import { renderTrackList } from "./track-list-view.ts";
import { choosePlaylistAndAdd, removeTrackFromPlaylist, toggleFavorite } from "./library-ui.ts";
import { createTrackActivationSession, observeTrackRow, unobserveTrackRow } from "./video-pages.ts";

type Snapshot = ReturnType<ReturnType<typeof createApplicationStore>["getState"]>;
type Videos = readonly Readonly<CommandContract.TrackSnapshotInput>[];
type Play = (index: number, selection?: PageSelection) => void;
type RowSession = { index: number; playlistId: string; drag: LibraryDragHandlers | null; item: HTMLElement | null; button: HTMLButtonElement | null; activation: ReturnType<typeof createTrackActivationSession> | null; video: Readonly<CommandContract.TrackSnapshotInput>; play: (selection?: PageSelection) => void; callbacks: Pick<TrackRowModel, "onNodes" | "onClick" | "onDoubleClick" | "onBadge" | "onFavorite" | "onAdd" | "onRemove" | "onCapture" | "onDragStart" | "onDragOver" | "onDragLeave" | "onDrop" | "onDragEnd"> };
type Projection = { library?: { playlistId: string; visual: LibraryDragVisual | null; handlers: LibraryDragHandlers }; inputs: readonly unknown[]; generation: number; videos: Videos; source: string; skeleton: boolean; unavailable: Snapshot["library"]["unavailableBvids"]; play: Play; sessions: Map<string, RowSession> };
let homeProjection: Projection | null = null;
let searchProjection: Projection | null = null;
let favoritesProjection: Projection | null = null;
let playlistProjection: Projection | null = null;
let committedSearchVersion: number | null = null;

function createProjection(state: Snapshot, source: string, play: Play): Projection {
  return { inputs: [], generation: 0, videos: [], source, skeleton: false, unavailable: state.library.unavailableBvids, play, sessions: new Map() };
}
function projectRows(host: HTMLElement, projection: Projection, state: Snapshot, search: boolean): void {
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
      const current: RowSession = { index, playlistId: "", drag: null, item: null, button: null, activation: null, video, play: selection => projection.play(index, selection), callbacks: {
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
    const play = projection.play;
    session.play = selection => play(index, selection);
    session.activation?.update(video, session.play);
    const visual = projection.library?.visual;
    const dragClass = visual?.sourceKey === key ? "is-dragging" : visual?.targetKey === key ? "is-drop-" + visual.direction : "";
    return { key, index, search, video, draggable: projection.library ? true : undefined, showPlayCount: !projection.library, playlistId: projection.library?.playlistId, dragClass, active: index === activeIndex,
      playCountText: formatPlayCount((video as Readonly<CommandContract.TrackSnapshotInput & { playCount?: number | null }>).playCount),
      pubdateText: formatPubdate((video as Readonly<CommandContract.TrackSnapshotInput & { pubdate?: number | null }>).pubdate),
      pageCount: state.pages.videoPageCounts.get(video.bvid) ?? 0,
      favorited: state.library.favoriteBvids.has(video.bvid.toLowerCase()),
      unavailableReason: search ? "" : projection.unavailable.get(video.bvid.toLowerCase()) ?? "", ...session.callbacks };
  });
  renderTrackList(host, rows, projection.skeleton);
}
function renderHomeRows(state: Snapshot, videos: Videos, source: string, skeleton: boolean, play: Play): void {
  if (!homeRankingList) return;
  homeProjection ??= createProjection(state, source, play);
  if (videos !== homeProjection.videos || source !== homeProjection.source) homeProjection.generation++;
  homeProjection.videos = videos; homeProjection.source = source; homeProjection.skeleton = skeleton;
  homeProjection.unavailable = state.library.unavailableBvids; homeProjection.play = play;
  projectRows(homeRankingList, homeProjection, state, false);
}
function refreshHomeRows(state: Snapshot): void { if (homeRankingList && homeProjection) projectRows(homeRankingList, homeProjection, state, false); }
function renderSearchRows(state: Snapshot, search: SearchSnapshot, play: Play): void {
  searchProjection ??= createProjection(state, "search", play);
  if (!search.searchBusy && search.page === 1 && search.results !== searchProjection.videos && search.requestVersion !== committedSearchVersion) {
    searchProjection.generation++; committedSearchVersion = search.requestVersion;
  }
  searchProjection.videos = search.results; searchProjection.play = play;
  projectRows(searchResults, searchProjection, state, true);
}
function refreshSearchRows(state: Snapshot): void { if (searchProjection) projectRows(searchResults, searchProjection, state, true); }
function renderLibraryTrackRows(host: HTMLElement, state: Snapshot, videos: Videos, source: "favorites" | "playlist", playlistId: string, unavailable: Snapshot["library"]["unavailableBvids"], visual: LibraryDragVisual | null, handlers: LibraryDragHandlers, play: Play): void {
  const projection = source === "favorites" ? favoritesProjection ??= createProjection(state, source, play) : playlistProjection ??= createProjection(state, source, play);
  projection.videos = videos; projection.unavailable = unavailable; projection.play = play; projection.library = { playlistId, visual, handlers };
  projectRows(host, projection, state, false);
}
export { refreshHomeRows, refreshSearchRows, renderHomeRows, renderLibraryTrackRows, renderSearchRows };
