import { refreshRootLists, setRootPlaylistList } from "./root-lists.ts";
import { isLibraryDragClickSuppressed } from "./library-state.ts";
import type { LibrarySnapshot } from "./library-state.ts";
import { favoritesList, playlistTracks, playlistsList } from "./player-dom.ts";
import type { LibraryDragHandlers, LibraryDragVisual, PlaylistRowModel } from "./track-list-model.ts";
import { renderLibraryTrackRows } from "./track-list-ui.ts";
import { getApplicationStore } from "./home.ts";
import { renderLibrarySnapshot } from "./library-view.ts";
import type { LibraryBindings } from "./library-view.ts";
import { currentPlayableTrack, playListItem, updateFavoriteButtons } from "./playback-core.ts";
import { getPlaybackMessagesActions } from "./playback-messages.ts";

let libraryMounted = false;
type DragKind = keyof LibrarySnapshot["drags"];
let libraryDragVisuals: Map<DragKind, LibraryDragVisual> | null = null;
let libraryRowsVersion: number | null = null;
let favoritesUnavailable: LibrarySnapshot["unavailableBvids"] | null = null;
let playlistsUnavailable: LibrarySnapshot["unavailableBvids"] | null = null;
let playlistCardInputs: readonly unknown[] | null = null;
let emptyLibraryTracks: readonly CommandContract.TrackSnapshotInput[] | null = null;

function setLibraryDragVisual(kind: DragKind, fields: Partial<LibraryDragVisual>): void {
  const before = libraryDragVisuals?.get(kind) ?? { sourceKey: null, targetKey: null, direction: null, touched: new Set<string>() };
  const touched = new Set(before.touched);
  if (fields.sourceKey) touched.add(fields.sourceKey);
  if (fields.targetKey) touched.add(fields.targetKey);
  libraryDragVisuals = new Map(libraryDragVisuals); libraryDragVisuals.set(kind, { ...before, ...fields, touched });
}
function finishLibraryDrag(kind: DragKind, save = false): void {
  if (libraryDragVisuals?.has(kind)) setLibraryDragVisual(kind, { sourceKey: null, targetKey: null, direction: null });
  getLibraryActions().finishDrag(kind, performance.now(), save);
}
function libraryDragHandlers(kind: DragKind, playlistId = ""): LibraryDragHandlers {
  return {
    capture(event) { if (isLibraryDragClickSuppressed(getLibrarySnapshot(), kind, performance.now())) { event.preventDefault(); event.stopImmediatePropagation(); } },
    start(event, index, key) {
      if (!event.dataTransfer) return;
      if (getLibrarySnapshot().drags[kind].saving) { event.preventDefault(); return; }
      setLibraryDragVisual(kind, { sourceKey: key, targetKey: null, direction: null });
      getLibraryActions().startDrag(kind, index, kind === "playlistItems" ? playlistId : undefined);
      event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index));
    },
    over(event, index, key) {
      if (!event.dataTransfer) return;
      const drag = getLibrarySnapshot().drags[kind];
      if (!libraryDragVisuals?.has(kind) || !drag.drag || drag.saving || kind === "playlistItems" && drag.drag.playlistId !== playlistId) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      setLibraryDragVisual(kind, { targetKey: index === drag.drag.index ? null : key, direction: index < drag.drag.index ? "before" : "after" });
      refreshRootLists();
    },
    leave(event, key) {
      if (libraryDragVisuals?.get(kind)?.targetKey === key && !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
        setLibraryDragVisual(kind, { targetKey: null, direction: null }); refreshRootLists();
      }
    },
    async drop(event, index) {
      const drag = getLibrarySnapshot().drags[kind];
      if (!drag.drag || drag.saving || kind === "playlistItems" && drag.drag.playlistId !== playlistId) return;
      const from = drag.drag.index; event.preventDefault(); event.stopPropagation(); finishLibraryDrag(kind, from !== index);
      if (from === index) return;
      try {
        const actions = getLibraryActions();
        if (kind === "favorites") await actions.reorderFavorites(from, index);
        else if (kind === "playlistItems") await actions.reorderPlaylistItems(playlistId, from, index);
        else await actions.reorderPlaylists(from, index);
      } catch (error) { console.warn(kind === "favorites" ? "favorite reorder failed:" : kind === "playlistItems" ? "playlist reorder failed:" : "playlist list reorder failed:", error); }
      finally { getLibraryActions().finishDragSave(kind); }
    },
    end() { finishLibraryDrag(kind); },
  };
}
function projectLibraryLists(state: ReturnType<ReturnType<typeof getApplicationStore>["getState"]>): void {
  const library = state.library;
  if (library.view.rowsVersion !== libraryRowsVersion) {
    libraryRowsVersion = library.view.rowsVersion;
    if (library.view.rowsKind === "all") { favoritesUnavailable = library.unavailableBvids; libraryDragVisuals = null; }
    else if (libraryDragVisuals) { libraryDragVisuals = new Map([...libraryDragVisuals].filter(([kind]) => kind === "favorites")); }
    playlistsUnavailable = library.unavailableBvids;
  }
  if (favoritesList) renderLibraryTrackRows(favoritesList, state, library.favorites, "favorites", "", favoritesUnavailable ?? library.unavailableBvids, libraryDragVisuals?.get("favorites") ?? null, libraryDragHandlers("favorites"), (index, selection) => {
    if (!isLibraryDragClickSuppressed(getLibrarySnapshot(), "favorites", performance.now())) playListItem("favorites", library.favorites, index, selection);
  });
  const selected = library.playlists.find(p => p.id === library.selectedPlaylistId) ?? library.playlists[0];
  if (playlistTracks) renderLibraryTrackRows(playlistTracks, state, selected?.items ?? (emptyLibraryTracks ??= []), "playlist", selected?.id ?? "", playlistsUnavailable ?? library.unavailableBvids, libraryDragVisuals?.get("playlistItems") ?? null, libraryDragHandlers("playlistItems", selected?.id), (index, selection) => {
    if (selected && !isLibraryDragClickSuppressed(getLibrarySnapshot(), "playlistItems", performance.now())) playListItem("playlist", selected.items, index, { playlistId: selected.id, ...(selection ?? {}) });
  });
  if (!playlistsList) return;
  const visual = libraryDragVisuals?.get("playlists"), inputs = [library.playlists, library.selectedPlaylistId, visual];
  if (playlistCardInputs && inputs.every((value, index) => Object.is(value, playlistCardInputs?.[index]))) return;
  playlistCardInputs = inputs;
  const handlers = libraryDragHandlers("playlists");
  const rows: PlaylistRowModel[] = library.playlists.map((playlist, index) => ({ key: playlist.id, name: playlist.name, count: playlist.items.length, selected: playlist.id === library.selectedPlaylistId, index, handlers, onChoose: () => getLibraryActions().choosePlaylist(playlist.id),
    dragClass: visual?.sourceKey === playlist.id ? "is-dragging" : visual?.targetKey === playlist.id ? "is-drop-" + visual.direction : visual?.touched.has(playlist.id) ? "" : undefined }));
  setRootPlaylistList(rows);
}

function libraryBindings(): LibraryBindings {
  const actions = getApplicationStore().actions.library;
  return { choosePlaylist: actions.choosePlaylist, closeModal: actions.closeModal, submitName: actions.submitName, submitDelete: actions.submitDelete, submitChoose: actions.submitChoose, createAndAdd: actions.createAndAdd, submitImport: actions.submitImport, submitPurge: () => actions.submitPurge(), setModalName: actions.setModalName, setModalLink: actions.setModalLink };
}
function getLibraryActions() {
  getPlaybackMessagesActions();
  const store = getApplicationStore();
  if (!libraryMounted) {
    libraryMounted = true; let previous: LibrarySnapshot | null = null;
    const render = (state: ReturnType<typeof store.getState>) => {
      const before = previous; previous = state.library;
      if (state.library.view.rowsVersion !== before?.view.rowsVersion) {
        if (state.library.view.rowsKind === "all" && getLibrarySnapshot().drags.favorites.drag) finishLibraryDrag("favorites");
        if (getLibrarySnapshot().drags.playlistItems.drag) finishLibraryDrag("playlistItems");
        if (getLibrarySnapshot().drags.playlists.drag) finishLibraryDrag("playlists");
      }
      const bindings = libraryBindings();
      if (renderLibrarySnapshot(state.library, before, bindings)) updateFavoriteButtons();
    };
    store.subscribe(render); render(store.getState());
  }
  return store.actions.library;
}
function getLibrarySnapshot() { return getApplicationStore().getState().library; }
function renderLibraryViews(): void { getLibraryActions().refreshViews(); }
function loadLibrary(): Promise<void> { return getLibraryActions().loadLibrary(); }
async function toggleFavorite(video = currentPlayableTrack()) {
  const result = await getLibraryActions().toggleFavorite(video ?? null); if (!result) return;
  if ("failed" in result) {
    window.dispatchEvent(new CustomEvent("bilibili-music-favorite-change", { detail: { bvid: result.track.bvid, title: result.track.title, failed: true } }));
  } else {
    window.dispatchEvent(new CustomEvent("bilibili-music-favorite-change", { detail: { bvid: result.track.bvid, title: result.track.title, favorited: result.favorited } }));
    if (result.favorited) window.dispatchEvent(new CustomEvent("bilibili-music-favorite", { detail: { bvid: result.track.bvid, title: result.track.title } }));
  }
}
function toggleCurrentFavorite(): Promise<void> | undefined {
  const current = currentPlayableTrack();
  if (current) return toggleFavorite(current);
}
function closeLibraryModal(): void { getLibraryActions().closeModal(); }
function createPlaylist(): void { getLibraryActions().showName("create"); }
function renameSelectedPlaylist(): void { const p = getLibrarySnapshot().playlists.find(p => p.id === getLibrarySnapshot().selectedPlaylistId); if (p) getLibraryActions().showName("rename", p); }
function deleteSelectedPlaylist(): void { getLibraryActions().showDelete(); }
function choosePlaylistAndAdd(video = currentPlayableTrack()): void { getLibraryActions().showChoose(video ?? null); }
function importFavoritePlaylist(): void { getLibraryActions().showImport(); }
function openPurgeUnavailableTracksModal(): Promise<void> { return getLibraryActions().showPurge(); }
function removeTrackFromPlaylist(id: string, bvid: string): Promise<void> { return getLibraryActions().removeTrack(id, bvid); }
function markLibraryUnavailable(bvid: string, reason: string): void { getLibraryActions().markUnavailable(bvid, reason); }
function clearLibraryUnavailable(bvid: string): boolean { return getLibraryActions().clearUnavailable(bvid); }
function openLoudnessModal(): void { getLibraryActions().openModal("loudness", "响度归一化", ""); }

export { choosePlaylistAndAdd, clearLibraryUnavailable, closeLibraryModal, createPlaylist, deleteSelectedPlaylist, getLibrarySnapshot, importFavoritePlaylist, loadLibrary, markLibraryUnavailable, openLoudnessModal, openPurgeUnavailableTracksModal, projectLibraryLists, removeTrackFromPlaylist, renameSelectedPlaylist, renderLibraryViews, toggleCurrentFavorite, toggleFavorite };
