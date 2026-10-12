import { escapeText, unavailableTrackLocations } from "./track-utils.ts";
import type { LibrarySnapshot } from "./library-state.ts";
import { favoritesCount, favoritesList, favoritesStatus, libraryModal, libraryModalBody, libraryModalStatus, libraryModalSubtitle, libraryModalTitle, playlistActions, playlistMeta, playlistTitle, playlistTracks, playlistsList, playlistsStatus, purgeAppearanceStatus, purgeUnavailableTracksButton } from "./player-dom.ts";
import LibraryModalBody from "./components/LibraryModalBody.vue";
import { createSyncRegion } from "./vue/sync-region.ts";

type PageSelection = { startPage?: CommandContract.VideoPage; pages?: CommandContract.VideoPage[] };
type LibraryBindings = {
  createTrackRow(video: CommandContract.TrackSnapshotInput, index: number, play: (index: number, selection?: PageSelection) => void, options?: { playlistId?: string }): HTMLElement;
  playListItem(source: string, items: readonly CommandContract.TrackSnapshotInput[], index: number, selection?: PageSelection & { playlistId?: string }): void;
  readPlayer(): { queueSource: string; queuePlaylistId: string | null; currentIndex: number };
  bindFavoriteDrag(row: HTMLElement, index: number): void; bindPlaylistItemDrag(row: HTMLElement, id: string, index: number): void; bindPlaylistDrag(row: HTMLElement, index: number): void;
  isFavoriteDragClickSuppressed(): boolean; isPlaylistDragClickSuppressed(): boolean;
  choosePlaylist(id: string): void; closeModal(): void; submitName(name: string): Promise<void>; submitDelete(): Promise<void>; submitChoose(id: string): Promise<void>; createAndAdd(name: string): Promise<void>; submitImport(link: string, name: string): Promise<void>; submitPurge(): Promise<void>;
  setModalName(name: string): void; setModalLink(link: string): void;
};
let libraryModalRegion: ReturnType<typeof createSyncRegion> | null = null;
let libraryModalRegionKey = 0;
const libraryModalPrimarySelector = ".library-modal-actions > .secondary-button";
const libraryModalNameSelector = ".library-name-field:last-of-type input";
const libraryModalLinkSelector = ".library-name-field:first-of-type input";


function renderFavorites(libraryState: LibrarySnapshot, bindings: LibraryBindings): void {
  if (!favoritesList) {
    return;
  }
  favoritesList.replaceChildren();
  favoritesCount.textContent = `${libraryState.favorites.length} 首`;
  if (libraryState.loadError) {
    favoritesStatus.textContent = libraryState.loadError;
    return;
  }
  favoritesStatus.textContent = libraryState.favorites.length
    ? "点击歌曲即可从收藏开始播放。"
    : "收藏的歌曲会显示在这里。";
  for (const [index, video] of libraryState.favorites.entries()) {
    const row = bindings.createTrackRow(
      video,
      index,
      (targetIndex, pageSelection) => {
        // Guard the delayed single-click callback as well as the native click event.
        if (!bindings.isFavoriteDragClickSuppressed()) {
          bindings.playListItem("favorites", libraryState.favorites, targetIndex, pageSelection);
        }
      },
    );
    bindings.bindFavoriteDrag(row, index);
    favoritesList.append(row);
  }
}

function renderPlaylists(libraryState: LibrarySnapshot, bindings: LibraryBindings): void {
  if (!playlistsList) {
    return;
  }
  playlistsList.replaceChildren();
  const selectedPlaylist =
    libraryState.playlists.find((playlist) => playlist.id === libraryState.selectedPlaylistId) ??
    libraryState.playlists[0] ??
    null;

  playlistsStatus.textContent = libraryState.playlists.length
    ? `${libraryState.playlists.length} 个歌单`
    : "还没有歌单。";

  for (const [index, playlist] of libraryState.playlists.entries()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "playlist-card";
    button.classList.toggle("is-selected", playlist.id === libraryState.selectedPlaylistId);
    button.dataset.playlistId = playlist.id;
    button.innerHTML = `<span>${escapeText(playlist.name)}</span><small>${playlist.items.length} 首</small>`;
    button.addEventListener("click", () => {
      bindings.choosePlaylist(playlist.id);
    });
    item.append(button);
    bindings.bindPlaylistDrag(item, index);
    playlistsList.append(item);
  }

  playlistTracks.replaceChildren();
  playlistActions.hidden = !selectedPlaylist;
  if (!selectedPlaylist) {
    playlistTitle.textContent = "选择一个歌单";
    playlistMeta.textContent = "歌单里的歌曲会显示在这里。";
    return;
  }

  playlistTitle.textContent = selectedPlaylist.name;
  playlistMeta.textContent = `${selectedPlaylist.items.length} 首歌曲`;
  for (const [index, video] of selectedPlaylist.items.entries()) {
    const row = bindings.createTrackRow(
      video,
      index,
      (targetIndex, pageSelection) => {
        // Also guard the delayed single-click callback scheduled before a drag started.
        if (!bindings.isPlaylistDragClickSuppressed()) {
          bindings.playListItem("playlist", selectedPlaylist.items, targetIndex, {
            playlistId: selectedPlaylist.id,
            ...(pageSelection ?? {}),
          });
        }
      },
      { playlistId: selectedPlaylist.id },
    );
    bindings.bindPlaylistItemDrag(row, selectedPlaylist.id, index);
    playlistTracks.append(row);
  }
}

function renderLibraryHighlights(libraryState: LibrarySnapshot, bindings: LibraryBindings): void {
  const playerState = bindings.readPlayer();
  if (favoritesList) {
    for (const button of favoritesList.querySelectorAll<HTMLButtonElement>("button.track")) {
      const index = Number(button.dataset.libraryIndex);
      if (playerState.queueSource === "favorites" && index === playerState.currentIndex) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  }
  if (playlistTracks) {
    for (const button of playlistTracks.querySelectorAll<HTMLButtonElement>("button.track")) {
      const index = Number(button.dataset.libraryIndex);
      if (
        playerState.queueSource === "playlist" &&
        playerState.queuePlaylistId === libraryState.selectedPlaylistId &&
        index === playerState.currentIndex
      ) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  }
}


function renderLibrarySnapshot(state: LibrarySnapshot, previous: LibrarySnapshot | null, bindings: LibraryBindings): boolean {
  let rendered = false;
  if (state.view.rowsVersion !== null && state.view.rowsVersion !== previous?.view.rowsVersion) { if (state.view.rowsKind === "all") renderFavorites(state, bindings); renderPlaylists(state, bindings); rendered = state.view.rowsKind === "all"; }
  const modal = state.session;
  if (modal.version !== previous?.session.version && modal.open) {
    libraryModalTitle.textContent = modal.title; libraryModalSubtitle.textContent = modal.subtitle; libraryModalSubtitle.hidden = !modal.subtitle;
    if (modal.kind === "generic" && libraryModalRegion) { libraryModalRegion.unmount(); libraryModalRegion = null; }
    if (!libraryModalRegion) libraryModalBody.replaceChildren();
    if (modal.kind !== "generic") {
      libraryModalRegion ??= createSyncRegion(libraryModalBody, LibraryModalBody);
      libraryModalRegionKey = modal.version;
    }
    libraryModalStatus.textContent = ""; libraryModal.hidden = false;
    requestAnimationFrame(() => { libraryModal.classList.add("is-open"); libraryModal.setAttribute("aria-hidden", "false"); });
  } else if (previous?.session.open && !modal.open) { libraryModal.classList.remove("is-open"); libraryModal.setAttribute("aria-hidden", "true"); }
  if (libraryModalRegion && modal.kind !== "generic") {
    libraryModalRegion.update({ key: libraryModalRegionKey, kind: modal.kind, busy: modal.busy, primaryLabel: modal.data.primaryLabel, data: modal.data,
      unavailable: modal.data.unavailable ?? [], locations: unavailableTrackLocations(modal.data.unavailable ?? [], state.favorites, state.playlists), favorites: state.favorites, playlists: state.playlists,
      onClose: bindings.closeModal, onSubmitDelete: bindings.submitDelete, onSubmitPurge: bindings.submitPurge,
      onName: bindings.setModalName, onLink: bindings.setModalLink, onSubmitName: bindings.submitName, onSubmitChoose: bindings.submitChoose, onCreateAndAdd: bindings.createAndAdd, onSubmitImport: bindings.submitImport });
    if (modal.open && modal.version !== previous?.session.version && (modal.kind === "loudness" || modal.kind === "purge" && (modal.data.unavailable?.length ?? 0) > 0)) {
      libraryModalBody.querySelector<HTMLButtonElement>(libraryModalPrimarySelector)?.focus();
    }
  }
  const nameInput = libraryModalBody.querySelector<HTMLInputElement>(libraryModalNameSelector);
  if (modal.open && modal.version !== previous?.session.version) {
    if (modal.kind === "name") { nameInput?.focus(); nameInput?.select(); }
    if (modal.kind === "favoriteImport") libraryModalBody.querySelector<HTMLInputElement>(libraryModalLinkSelector)?.focus();
  }
  if (modal !== previous?.session) {
    if (modal.status !== previous?.session.status || modal.open && modal.version !== previous?.session.version) libraryModalStatus.textContent = modal.status;
    if (modal.data.focusName !== previous?.session.data.focusName && modal.data.focusName) { nameInput?.focus(); nameInput?.select(); }
  }
  if (state.view.playlistsStatus !== null && state.view.playlistsStatus !== previous?.view.playlistsStatus) playlistsStatus.textContent = state.view.playlistsStatus;
  if (state.view.purgeStatus !== null && state.view.purgeStatus !== previous?.view.purgeStatus) purgeAppearanceStatus.textContent = state.view.purgeStatus;
  if (state.view.purgeBusy !== null && state.view.purgeBusy !== previous?.view.purgeBusy) purgeUnavailableTracksButton.disabled = state.view.purgeBusy;
  return rendered;
}
function finishLibraryModalTransition(event: TransitionEvent): void {
  if (event.target === libraryModal && !libraryModal.classList.contains("is-open")) libraryModal.hidden = true;
}

export { finishLibraryModalTransition, renderLibraryHighlights, renderLibrarySnapshot };
export type { LibraryBindings };
