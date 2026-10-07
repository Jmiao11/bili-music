import type { LibrarySnapshot } from "./library-state.ts";
import { favoriteDragState, libraryState, playerState, playlistDragState, playlistListDragState } from "./player-state.ts";
import { getApplicationStore } from "./home.ts";
import { renderLibraryHighlights, renderLibrarySnapshot } from "./library-view.ts";
import type { LibraryBindings } from "./library-view.ts";
import { createTrackRow, currentPlayableTrack, playListItem, updateFavoriteButtons } from "./playback-core.ts";

let libraryMounted = false;

function isFavoriteDragClickSuppressed(): boolean {
  return favoriteDragState.drag !== null || performance.now() < favoriteDragState.suppressClickUntil;
}

function finishFavoriteDrag(): void {
  const drag = favoriteDragState.drag;
  drag?.row.classList.remove("is-dragging");
  drag?.target?.classList.remove("is-drop-before", "is-drop-after");
  favoriteDragState.drag = null;
  // Cover the post-drop click, including when another favorite operation re-renders the list.
  favoriteDragState.suppressClickUntil = performance.now() + 400;
}

function bindFavoriteDrag(row: HTMLElement, index: number): void {
  row.draggable = true;
  row.querySelectorAll("img").forEach((image) => { image.draggable = false; });
  for (const eventName of ["click", "dblclick"]) {
    row.addEventListener(eventName, (event) => {
      if (isFavoriteDragClickSuppressed()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }
  row.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) return;
    if (favoriteDragState.saving) {
      event.preventDefault();
      return;
    }
    favoriteDragState.drag = { index, row, target: null };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    const drag = favoriteDragState.drag;
    if (!drag || favoriteDragState.saving) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    drag.target?.classList.remove("is-drop-before", "is-drop-after");
    drag.target = index === drag.index ? null : row;
    drag.target?.classList.add(index < drag.index ? "is-drop-before" : "is-drop-after");
  });
  row.addEventListener("dragleave", (event: DragEvent) => {
    const drag = favoriteDragState.drag;
    if (drag?.target === row && !row.contains(event.relatedTarget as Node | null)) {
      row.classList.remove("is-drop-before", "is-drop-after");
      drag.target = null;
    }
  });
  row.addEventListener("drop", async (event) => {
    const drag = favoriteDragState.drag;
    if (!drag || favoriteDragState.saving) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    finishFavoriteDrag();
    if (drag.index === index) {
      return;
    }
    favoriteDragState.saving = true;
    try {
      // Retain the current order until persistence succeeds; failure needs no local undo.
      await getLibraryActions().reorderFavorites(drag.index, index);
    } catch (error) {
      console.warn("favorite reorder failed:", error);
    } finally {
      favoriteDragState.saving = false;
      renderLibraryViews();
    }
  });
  row.addEventListener("dragend", finishFavoriteDrag);
}

function isPlaylistDragClickSuppressed(): boolean {
  return playlistDragState.drag !== null || performance.now() < playlistDragState.suppressClickUntil;
}

function finishPlaylistDrag(): void {
  const drag = playlistDragState.drag;
  drag?.row.classList.remove("is-dragging");
  drag?.target?.classList.remove("is-drop-before", "is-drop-after");
  playlistDragState.drag = null;
  // Cover the mouse click emitted after a native drop, including after a re-render.
  playlistDragState.suppressClickUntil = performance.now() + 400;
}

function bindPlaylistItemDrag(row: HTMLElement, playlistId: string, index: number): void {
  row.draggable = true;
  row.querySelectorAll("img").forEach((image) => { image.draggable = false; });
  for (const eventName of ["click", "dblclick"]) {
    row.addEventListener(eventName, (event) => {
      if (isPlaylistDragClickSuppressed()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }
  row.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) return;
    if (playlistDragState.saving) {
      event.preventDefault();
      return;
    }
    playlistDragState.drag = { playlistId, index, row, target: null };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    const drag = playlistDragState.drag;
    if (!drag || drag.playlistId !== playlistId || playlistDragState.saving) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    drag.target?.classList.remove("is-drop-before", "is-drop-after");
    drag.target = index === drag.index ? null : row;
    drag.target?.classList.add(index < drag.index ? "is-drop-before" : "is-drop-after");
  });
  row.addEventListener("dragleave", (event: DragEvent) => {
    const drag = playlistDragState.drag;
    if (drag?.target === row && !row.contains(event.relatedTarget as Node | null)) {
      row.classList.remove("is-drop-before", "is-drop-after");
      drag.target = null;
    }
  });
  row.addEventListener("drop", async (event) => {
    const drag = playlistDragState.drag;
    if (!drag || drag.playlistId !== playlistId || playlistDragState.saving) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    finishPlaylistDrag();
    if (drag.index === index) {
      return;
    }
    playlistDragState.saving = true;
    try {
      // Keep the original order until persistence succeeds; failures need no local undo.
      await getLibraryActions().reorderPlaylistItems(playlistId, drag.index, index);
    } catch (error) {
      console.warn("playlist reorder failed:", error);
    } finally {
      playlistDragState.saving = false;
      renderLibraryViews();
    }
  });
  row.addEventListener("dragend", finishPlaylistDrag);
}

function isPlaylistListDragClickSuppressed(): boolean {
  return playlistListDragState.drag !== null || performance.now() < playlistListDragState.suppressClickUntil;
}

function finishPlaylistListDrag(): void {
  const drag = playlistListDragState.drag;
  drag?.row.classList.remove("is-dragging");
  drag?.target?.classList.remove("is-drop-before", "is-drop-after");
  playlistListDragState.drag = null;
  // Keep the post-drop click suppressed even if the list has already been re-rendered.
  playlistListDragState.suppressClickUntil = performance.now() + 400;
}

function bindPlaylistDrag(row: HTMLElement, index: number): void {
  row.draggable = true;
  for (const eventName of ["click", "dblclick"]) {
    row.addEventListener(eventName, (event) => {
      if (isPlaylistListDragClickSuppressed()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }
  row.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) return;
    if (playlistListDragState.saving) {
      event.preventDefault();
      return;
    }
    playlistListDragState.drag = { index, row, target: null };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    const drag = playlistListDragState.drag;
    if (!drag || playlistListDragState.saving) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    drag.target?.classList.remove("is-drop-before", "is-drop-after");
    drag.target = index === drag.index ? null : row;
    drag.target?.classList.add(index < drag.index ? "is-drop-before" : "is-drop-after");
  });
  row.addEventListener("dragleave", (event: DragEvent) => {
    const drag = playlistListDragState.drag;
    if (drag?.target === row && !row.contains(event.relatedTarget as Node | null)) {
      row.classList.remove("is-drop-before", "is-drop-after");
      drag.target = null;
    }
  });
  row.addEventListener("drop", async (event) => {
    const drag = playlistListDragState.drag;
    if (!drag || playlistListDragState.saving) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    finishPlaylistListDrag();
    if (drag.index === index) {
      return;
    }
    playlistListDragState.saving = true;
    try {
      // Preserve selectedPlaylistId and the visible order until persistence succeeds.
      await getLibraryActions().reorderPlaylists(drag.index, index);
    } catch (error) {
      console.warn("playlist list reorder failed:", error);
    } finally {
      playlistListDragState.saving = false;
      renderLibraryViews();
    }
  });
  row.addEventListener("dragend", finishPlaylistListDrag);
}


function libraryBindings(): LibraryBindings {
  const actions = getApplicationStore().actions.library;
  return { createTrackRow, playListItem, readPlayer: () => playerState, bindFavoriteDrag, bindPlaylistItemDrag, bindPlaylistDrag, isFavoriteDragClickSuppressed, isPlaylistDragClickSuppressed,
    choosePlaylist: actions.choosePlaylist, closeModal: actions.closeModal, submitName: actions.submitName, submitDelete: actions.submitDelete, submitChoose: actions.submitChoose, createAndAdd: actions.createAndAdd, submitImport: actions.submitImport, submitPurge: () => actions.submitPurge(acceptDisabledPages), setModalName: actions.setModalName, setModalLink: actions.setModalLink };
}
function getLibraryActions() {
  const store = getApplicationStore();
  if (!libraryMounted) {
    libraryMounted = true; let previous: LibrarySnapshot | null = null;
    const render = (state: ReturnType<typeof store.getState>) => {
      const before = previous; previous = state.library;
      if (state.library.view.rowsVersion !== before?.view.rowsVersion) {
        if (state.library.view.rowsKind === "all" && favoriteDragState.drag) finishFavoriteDrag();
        if (playlistDragState.drag) finishPlaylistDrag();
        if (playlistListDragState.drag) finishPlaylistListDrag();
      }
      const bindings = libraryBindings();
      if (renderLibrarySnapshot(state.library, before, bindings)) { updateFavoriteButtons(); renderLibraryHighlights(state.library, bindings); }
    };
    store.subscribe(render); render(store.getState());
  }
  return store.actions.library;
}
function getLibrarySnapshot() { return getApplicationStore().getState().library; }
function renderLibraryViews(): void { getLibraryActions().refreshViews(); }
function updateLibraryHighlights(): void { renderLibraryHighlights(getLibrarySnapshot(), libraryBindings()); }
function acceptDisabledPages(pages: CommandMap["list_disabled_pages"]["result"]): void {
  libraryState.disabledPages = new Map(Object.entries(pages).map(([bvid, cids]) => [bvid.toLowerCase(), new Set(cids)]));
}
function loadLibrary(): Promise<void> { return getLibraryActions().loadLibrary(acceptDisabledPages); }
async function toggleFavorite(video = currentPlayableTrack()) {
  const result = await getLibraryActions().toggleFavorite(video ?? null); if (!result) return;
  if ("failed" in result) {
    window.dispatchEvent(new CustomEvent("bilibili-music-favorite-change", { detail: { bvid: result.track.bvid, title: result.track.title, failed: true } }));
  } else {
    window.dispatchEvent(new CustomEvent("bilibili-music-favorite-change", { detail: { bvid: result.track.bvid, title: result.track.title, favorited: result.favorited } }));
    if (result.favorited) window.dispatchEvent(new CustomEvent("bilibili-music-favorite", { detail: { bvid: result.track.bvid, title: result.track.title } }));
  }
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

export { choosePlaylistAndAdd, clearLibraryUnavailable, closeLibraryModal, createPlaylist, deleteSelectedPlaylist, getLibrarySnapshot, importFavoritePlaylist, loadLibrary, markLibraryUnavailable,  openLoudnessModal, openPurgeUnavailableTracksModal, removeTrackFromPlaylist, renameSelectedPlaylist, renderLibraryViews, toggleFavorite, updateLibraryHighlights };
