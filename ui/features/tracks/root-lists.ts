import { readApplicationStore } from "../../store/application-store.ts";
import { libraryFilterTerms } from "../library/library-entry.ts";
import type { ApplicationSnapshot, ApplicationStore } from "../../store/application-store.ts";
import type { PlaylistRowModel, TrackRowModel } from "./track-list-model.ts";

type TrackListModel = Readonly<{ kind: "tracks"; rows: readonly TrackRowModel[]; skeleton: boolean; total?: number }>;
type PlaylistListModel = Readonly<{ kind: "playlists"; rows: readonly PlaylistRowModel[] }>;
type TrackListTarget = "home" | "newSongs" | "forYou" | "search" | "favorites" | "playlist" | "playlistSearch" | "collection" | "recent" | "favoritesFiltered" | "playlistFiltered" | "recentFiltered";
type RootLists = Readonly<Record<TrackListTarget, TrackListModel> & { directories: PlaylistListModel }>;
let rootLists: RootLists | null = null;
let listProjection: ((snapshot: ApplicationSnapshot) => void) | null = null;
let refreshRoot: (() => void) | null = null;

function readRootLists(): RootLists {
  if (!rootLists) {
    const empty: TrackListModel = { kind: "tracks", rows: [], skeleton: false };
    rootLists = { home: empty, newSongs: empty, forYou: empty, search: empty, favorites: empty, playlist: empty, playlistSearch: empty, collection: empty, recent: empty, favoritesFiltered: empty, playlistFiltered: empty, recentFiltered: empty, directories: { kind: "playlists", rows: [] } };
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
function setRootTrackList(target: TrackListTarget, rows: readonly TrackRowModel[], skeleton: boolean, total?: number): void {
  const before = readRootLists();
  if (before[target].rows === rows && before[target].skeleton === skeleton && before[target].total === total) return;
  rootLists = { ...before, [target]: { kind: "tracks", rows, skeleton, ...(total === undefined ? {} : { total }) } };
}
function setRootPlaylistList(rows: readonly PlaylistRowModel[]): void {
  const before = readRootLists();
  if (before.directories.rows !== rows) rootLists = { ...before, directories: { kind: "playlists", rows } };
}

export { installRootListProjection, installRootRefresh, projectRootLists, refreshRootLists, setRootPlaylistList, setRootTrackList };
export type { PlaylistListModel, RootLists, TrackListModel, TrackListTarget };

const emptyFilter = { scope: "", draft: "", query: "", terms: [] as readonly string[], pauseLookups: false, firstRow: 0 };
let filter = emptyFilter;
let timer: number | undefined;
let cancelDrag: () => void;

function filterScope(state: ApplicationSnapshot): string {
  if (state.collection.active) return "";
  const view = state.settings.session.currentView;
  if (view === "favorites" || view === "recent") return view;
  return view === "playlists" ? state.library.view.playlistDetail ? "playlist:" + state.library.selectedPlaylistId : "playlists" : "";
}

function readLibraryFilter(state: ApplicationSnapshot) {
  return filter.scope === filterScope(state) ? filter : emptyFilter;
}

function installLibraryFilter(store: ApplicationStore, cancel: () => void): void {
  cancelDrag = cancel;
  store.subscribe(state => {
    if (filter.scope && filter.scope !== filterScope(state)) {
      window.clearTimeout(timer);
      filter = emptyFilter;
    }
  });
}

function setDraft(draft: string): void {
  const state = readApplicationStore().getState();
  const scope = filterScope(state);
  if (!scope) return;
  window.clearTimeout(timer);
  filter = { ...readLibraryFilter(state), scope, draft, pauseLookups: true };
  if (!draft.trim()) {
    filter = { ...filter, query: "", terms: emptyFilter.terms, firstRow: 0 };
  } else {
    timer = window.setTimeout(() => {
      const terms = libraryFilterTerms(draft);
      if (terms.length) cancelDrag();
      const viewport = document.querySelector<HTMLElement>(".library-search-view:not([hidden])");
      const firstRow = viewport ? visibleFilterStart(viewport) : 0;
      filter = { ...filter, query: draft.trim(), terms, firstRow };
      refreshRootLists();
    }, 100);
  }
  refreshRootLists();
}

function visibleFilterStart(viewport: HTMLElement): number {
  if (!viewport.scrollTop) return 0;
  const list = viewport.querySelector<HTMLElement>(".tracklist:not([hidden])");
  return list ? Math.max(0, Math.floor((viewport.getBoundingClientRect().top - list.getBoundingClientRect().top) / 44) - 12) : 0;
}

function scrollFilter(event: Event): void {
  const viewport = event.currentTarget;
  if (!(viewport instanceof HTMLElement)) return;
  const firstRow = visibleFilterStart(viewport);
  if (Math.abs(firstRow - filter.firstRow) < 8 && firstRow !== 0) return;
  if (firstRow === filter.firstRow) return;
  filter = { ...filter, firstRow };
  refreshRootLists();
}

const libraryFilterCallbacks = Object.freeze({ input: setDraft, clear: () => setDraft(""), scroll: scrollFilter });

function focusLibraryFilter(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.key.toLowerCase() !== "f") return false;
  const state = readApplicationStore().getState();
  if (!filterScope(state) || state.settings.session.panelOpen || state.library.session.open || state.pages.modal ||
      document.querySelector("#immersive-player.is-open")) return false;
  if (Object.values(state.settings.shortcutBindings).some(binding => binding && /^(?:ctrl|control|cmdorctrl|commandorcontrol)\+f$/i.test(binding.replace(/\s/g, "")))) return false;
  const input = document.querySelector<HTMLInputElement>(".view:not([hidden]) .library-filter-input");
  if (!input) return false;
  event.preventDefault();
  input.focus();
  return true;
}

export { focusLibraryFilter, installLibraryFilter, libraryFilterCallbacks, readLibraryFilter };
