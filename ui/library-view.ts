import { unavailableTrackLocations } from "./track-utils.ts";
import type { LibrarySnapshot } from "./library-state.ts";
import { favoritesCount, favoritesList, favoritesStatus, libraryModal, libraryModalBody, libraryModalStatus, libraryModalSubtitle, libraryModalTitle, playlistActions, playlistMeta, playlistTitle, playlistsList, playlistsStatus, purgeAppearanceStatus, purgeUnavailableTracksButton } from "./player-dom.ts";
import LibraryModalBody from "./components/LibraryModalBody.vue";
import { createSyncRegion } from "./vue/sync-region.ts";
import { trapFocus } from "./focus-trap.ts";

type PageSelection = { startPage?: CommandContract.VideoPage; pages?: CommandContract.VideoPage[] };
type LibraryBindings = {
  choosePlaylist(id: string): void; closeModal(): void; submitName(name: string): Promise<void>; submitDelete(): Promise<void>; submitChoose(id: string): Promise<void>; createAndAdd(name: string): Promise<void>; submitImport(link: string, name: string): Promise<void>; submitPurge(): Promise<void>;
  setModalName(name: string): void; setModalLink(link: string): void;
};
let libraryModalRegion: ReturnType<typeof createSyncRegion> | null = null;
let libraryModalRegionKey = 0;
let libraryModalReturnFocus: HTMLElement | null = null;
let libraryModalFrame: number | null = null;
const libraryModalPrimarySelector = ".library-modal-actions > .secondary-button";
const libraryModalNameSelector = ".library-name-field:last-of-type input";
const libraryModalLinkSelector = ".library-name-field:first-of-type input";


function renderFavorites(libraryState: LibrarySnapshot): void {
  if (!favoritesList) {
    return;
  }
  favoritesCount.textContent = `${libraryState.favorites.length} 首`;
  if (libraryState.loadError) {
    favoritesStatus.textContent = libraryState.loadError;
    return;
  }
  favoritesStatus.textContent = libraryState.favorites.length
    ? "点击歌曲即可从收藏开始播放。"
    : "收藏的歌曲会显示在这里。";

}

function renderPlaylists(libraryState: LibrarySnapshot): void {
  if (!playlistsList) {
    return;
  }
  const selectedPlaylist =
    libraryState.playlists.find((playlist) => playlist.id === libraryState.selectedPlaylistId) ??
    libraryState.playlists[0] ??
    null;

  playlistsStatus.textContent = libraryState.playlists.length
    ? `${libraryState.playlists.length} 个歌单`
    : "还没有歌单。";



  playlistActions.hidden = !selectedPlaylist;
  if (!selectedPlaylist) {
    playlistTitle.textContent = "选择一个歌单";
    playlistMeta.textContent = "歌单里的歌曲会显示在这里。";
    return;
  }

  playlistTitle.textContent = selectedPlaylist.name;
  playlistMeta.textContent = `${selectedPlaylist.items.length} 首歌曲`;

}

function renderLibrarySnapshot(state: LibrarySnapshot, previous: LibrarySnapshot | null, bindings: LibraryBindings): boolean {
  let rendered = false;
  if (state.session.open && !previous?.session.open) libraryModalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (state.view.rowsVersion !== null && state.view.rowsVersion !== previous?.view.rowsVersion) { if (state.view.rowsKind === "all") renderFavorites(state); renderPlaylists(state); rendered = state.view.rowsKind === "all"; }
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
    if (libraryModalFrame !== null) cancelAnimationFrame(libraryModalFrame);
    libraryModalFrame = requestAnimationFrame(() => { libraryModalFrame = null; libraryModal.classList.add("is-open"); libraryModal.setAttribute("aria-hidden", "false"); });
  } else if (previous?.session.open && !modal.open) {
    if (libraryModalFrame !== null) { cancelAnimationFrame(libraryModalFrame); libraryModalFrame = null; }
    libraryModal.classList.remove("is-open"); libraryModal.setAttribute("aria-hidden", "true");
    if (libraryModalReturnFocus?.isConnected) libraryModalReturnFocus.focus({ preventScroll: true });
    libraryModalReturnFocus = null;
  }
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
function keepFocusInLibraryModal(event: KeyboardEvent): void { trapFocus(event, libraryModal); }
function finishLibraryModalTransition(event: TransitionEvent): void {
  if (event.target === libraryModal && !libraryModal.classList.contains("is-open")) libraryModal.hidden = true;
}

export { finishLibraryModalTransition, keepFocusInLibraryModal, renderLibrarySnapshot };
export type { LibraryBindings };
