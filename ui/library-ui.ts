import { isLibraryDragClickSuppressed } from "./library-state.ts";
import type { LibrarySnapshot } from "./library-state.ts";
import { getApplicationStore } from "./home.ts";
import { renderLibraryHighlights, renderLibrarySnapshot } from "./library-view.ts";
import type { LibraryBindings } from "./library-view.ts";
import { createTrackRow, currentPlayableTrack, playListItem, updateFavoriteButtons } from "./playback-core.ts";

let libraryMounted = false;
let favoriteDragElements: { row: HTMLElement; target: HTMLElement | null } | null = null;
let playlistDragElements: { row: HTMLElement; target: HTMLElement | null } | null = null;
let playlistListDragElements: { row: HTMLElement; target: HTMLElement | null } | null = null;

function isFavoriteDragClickSuppressed(): boolean {
  return isLibraryDragClickSuppressed(getLibrarySnapshot(), "favorites", performance.now());
}

function finishFavoriteDrag(save = false): void {
  const elements = favoriteDragElements;
  elements?.row.classList.remove("is-dragging");
  elements?.target?.classList.remove("is-drop-before", "is-drop-after");
  favoriteDragElements = null;
  getLibraryActions().finishDrag("favorites", performance.now(), save);
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
    if (getLibrarySnapshot().drags.favorites.saving) {
      event.preventDefault();
      return;
    }
    favoriteDragElements = { row, target: null };
    getLibraryActions().startDrag("favorites", index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    const drag = getLibrarySnapshot().drags.favorites.drag;
    const elements = favoriteDragElements;
    if (!elements || !drag || getLibrarySnapshot().drags.favorites.saving) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    elements.target?.classList.remove("is-drop-before", "is-drop-after");
    elements.target = index === drag.index ? null : row;
    elements.target?.classList.add(index < drag.index ? "is-drop-before" : "is-drop-after");
  });
  row.addEventListener("dragleave", (event: DragEvent) => {
    const elements = favoriteDragElements;
    if (elements?.target === row && !row.contains(event.relatedTarget as Node | null)) {
      row.classList.remove("is-drop-before", "is-drop-after");
      elements.target = null;
    }
  });
  row.addEventListener("drop", async (event) => {
    const drag = getLibrarySnapshot().drags.favorites.drag;
    if (!drag || getLibrarySnapshot().drags.favorites.saving) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    finishFavoriteDrag(drag.index !== index);
    if (drag.index === index) {
      return;
    }
    try {
      // Retain the current order until persistence succeeds; failure needs no local undo.
      await getLibraryActions().reorderFavorites(drag.index, index);
    } catch (error) {
      console.warn("favorite reorder failed:", error);
    } finally {
      getLibraryActions().finishDragSave("favorites");
    }
  });
  row.addEventListener("dragend", () => finishFavoriteDrag());
}

function isPlaylistDragClickSuppressed(): boolean {
  return isLibraryDragClickSuppressed(getLibrarySnapshot(), "playlistItems", performance.now());
}

function finishPlaylistDrag(save = false): void {
  const elements = playlistDragElements;
  elements?.row.classList.remove("is-dragging");
  elements?.target?.classList.remove("is-drop-before", "is-drop-after");
  playlistDragElements = null;
  getLibraryActions().finishDrag("playlistItems", performance.now(), save);
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
    if (getLibrarySnapshot().drags.playlistItems.saving) {
      event.preventDefault();
      return;
    }
    playlistDragElements = { row, target: null };
    getLibraryActions().startDrag("playlistItems", index, playlistId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    const drag = getLibrarySnapshot().drags.playlistItems.drag;
    const elements = playlistDragElements;
    if (!elements || !drag || drag.playlistId !== playlistId || getLibrarySnapshot().drags.playlistItems.saving) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    elements.target?.classList.remove("is-drop-before", "is-drop-after");
    elements.target = index === drag.index ? null : row;
    elements.target?.classList.add(index < drag.index ? "is-drop-before" : "is-drop-after");
  });
  row.addEventListener("dragleave", (event: DragEvent) => {
    const elements = playlistDragElements;
    if (elements?.target === row && !row.contains(event.relatedTarget as Node | null)) {
      row.classList.remove("is-drop-before", "is-drop-after");
      elements.target = null;
    }
  });
  row.addEventListener("drop", async (event) => {
    const drag = getLibrarySnapshot().drags.playlistItems.drag;
    if (!drag || drag.playlistId !== playlistId || getLibrarySnapshot().drags.playlistItems.saving) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    finishPlaylistDrag(drag.index !== index);
    if (drag.index === index) {
      return;
    }
    try {
      // Keep the original order until persistence succeeds; failures need no local undo.
      await getLibraryActions().reorderPlaylistItems(playlistId, drag.index, index);
    } catch (error) {
      console.warn("playlist reorder failed:", error);
    } finally {
      getLibraryActions().finishDragSave("playlistItems");
    }
  });
  row.addEventListener("dragend", () => finishPlaylistDrag());
}

function isPlaylistListDragClickSuppressed(): boolean {
  return isLibraryDragClickSuppressed(getLibrarySnapshot(), "playlists", performance.now());
}

function finishPlaylistListDrag(save = false): void {
  const elements = playlistListDragElements;
  elements?.row.classList.remove("is-dragging");
  elements?.target?.classList.remove("is-drop-before", "is-drop-after");
  playlistListDragElements = null;
  getLibraryActions().finishDrag("playlists", performance.now(), save);
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
    if (getLibrarySnapshot().drags.playlists.saving) {
      event.preventDefault();
      return;
    }
    playlistListDragElements = { row, target: null };
    getLibraryActions().startDrag("playlists", index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    const drag = getLibrarySnapshot().drags.playlists.drag;
    const elements = playlistListDragElements;
    if (!elements || !drag || getLibrarySnapshot().drags.playlists.saving) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    elements.target?.classList.remove("is-drop-before", "is-drop-after");
    elements.target = index === drag.index ? null : row;
    elements.target?.classList.add(index < drag.index ? "is-drop-before" : "is-drop-after");
  });
  row.addEventListener("dragleave", (event: DragEvent) => {
    const elements = playlistListDragElements;
    if (elements?.target === row && !row.contains(event.relatedTarget as Node | null)) {
      row.classList.remove("is-drop-before", "is-drop-after");
      elements.target = null;
    }
  });
  row.addEventListener("drop", async (event) => {
    const drag = getLibrarySnapshot().drags.playlists.drag;
    if (!drag || getLibrarySnapshot().drags.playlists.saving) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    finishPlaylistListDrag(drag.index !== index);
    if (drag.index === index) {
      return;
    }
    try {
      // Preserve selectedPlaylistId and the visible order until persistence succeeds.
      await getLibraryActions().reorderPlaylists(drag.index, index);
    } catch (error) {
      console.warn("playlist list reorder failed:", error);
    } finally {
      getLibraryActions().finishDragSave("playlists");
    }
  });
  row.addEventListener("dragend", () => finishPlaylistListDrag());
}


function libraryBindings(): LibraryBindings {
  const actions = getApplicationStore().actions.library;
  return { createTrackRow, playListItem, readPlayer: () => { const queue = getApplicationStore().getState().playbackQueue; return { queueSource: queue.queueSource, queuePlaylistId: queue.playlistId, currentIndex: queue.currentIndex }; }, bindFavoriteDrag, bindPlaylistItemDrag, bindPlaylistDrag, isFavoriteDragClickSuppressed, isPlaylistDragClickSuppressed,
    choosePlaylist: actions.choosePlaylist, closeModal: actions.closeModal, submitName: actions.submitName, submitDelete: actions.submitDelete, submitChoose: actions.submitChoose, createAndAdd: actions.createAndAdd, submitImport: actions.submitImport, submitPurge: () => actions.submitPurge(), setModalName: actions.setModalName, setModalLink: actions.setModalLink };
}
function getLibraryActions() {
  const store = getApplicationStore();
  if (!libraryMounted) {
    libraryMounted = true; let previous: LibrarySnapshot | null = null;
    const render = (state: ReturnType<typeof store.getState>) => {
      const before = previous; previous = state.library;
      if (state.library.view.rowsVersion !== before?.view.rowsVersion) {
        if (state.library.view.rowsKind === "all" && getLibrarySnapshot().drags.favorites.drag) finishFavoriteDrag();
        if (getLibrarySnapshot().drags.playlistItems.drag) finishPlaylistDrag();
        if (getLibrarySnapshot().drags.playlists.drag) finishPlaylistListDrag();
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

export { choosePlaylistAndAdd, clearLibraryUnavailable, closeLibraryModal, createPlaylist, deleteSelectedPlaylist, getLibrarySnapshot, importFavoritePlaylist, loadLibrary, markLibraryUnavailable, openLoudnessModal, openPurgeUnavailableTracksModal, removeTrackFromPlaylist, renameSelectedPlaylist, renderLibraryViews, toggleFavorite, updateLibraryHighlights };
