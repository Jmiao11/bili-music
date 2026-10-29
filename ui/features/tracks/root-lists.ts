import type { ApplicationSnapshot } from "../../store/application-store.ts";
import type { PlaylistRowModel, TrackRowModel } from "./track-list-model.ts";

type TrackListModel = Readonly<{ kind: "tracks"; rows: readonly TrackRowModel[]; skeleton: boolean }>;
type PlaylistListModel = Readonly<{ kind: "playlists"; rows: readonly PlaylistRowModel[] }>;
type TrackListTarget = "home" | "search" | "favorites" | "playlist" | "collection" | "recent";
type RootLists = Readonly<Record<TrackListTarget, TrackListModel> & { directories: PlaylistListModel }>;
let rootLists: RootLists | null = null;
let listProjection: ((snapshot: ApplicationSnapshot) => void) | null = null;
let refreshRoot: (() => void) | null = null;

function readRootLists(): RootLists {
  if (!rootLists) {
    const empty: TrackListModel = { kind: "tracks", rows: [], skeleton: false };
    rootLists = { home: empty, search: empty, favorites: empty, playlist: empty, collection: empty, recent: empty, directories: { kind: "playlists", rows: [] } };
  }
  return rootLists;
}
function projectRootLists(snapshot: ApplicationSnapshot): RootLists {
  listProjection?.(snapshot);
  return readRootLists();
}
function installRootListProjection(project: (snapshot: ApplicationSnapshot) => void): void {
  if (listProjection) throw new Error("Root list projection already installed");
  listProjection = project;
}
function installRootRefresh(refresh: () => void): void { refreshRoot = refresh; }
function refreshRootLists(): void {
  if (!refreshRoot) throw new Error("Application root must mount before list interaction");
  refreshRoot();
}
function setRootTrackList(target: TrackListTarget, rows: readonly TrackRowModel[], skeleton: boolean): void {
  const before = readRootLists();
  if (before[target].rows === rows && before[target].skeleton === skeleton) return;
  rootLists = { ...before, [target]: { kind: "tracks", rows, skeleton } };
}
function setRootPlaylistList(rows: readonly PlaylistRowModel[]): void {
  const before = readRootLists();
  if (before.directories.rows !== rows) rootLists = { ...before, directories: { kind: "playlists", rows } };
}

export { installRootListProjection, installRootRefresh, projectRootLists, refreshRootLists, setRootPlaylistList, setRootTrackList };
export type { PlaylistListModel, RootLists, TrackListModel, TrackListTarget };
