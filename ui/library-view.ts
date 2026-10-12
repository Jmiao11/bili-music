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
type ModalControls = { primary?: HTMLButtonElement; input?: HTMLInputElement; linkInput?: HTMLInputElement; nameField?: HTMLElement };
let libraryModalControls: ModalControls | null = null;
let libraryModalRegion: ReturnType<typeof createSyncRegion> | null = null;
let libraryModalRegionKey = 0;
const libraryModalPrimarySelector = ".library-modal-actions > .secondary-button";
function isVueModal(kind: LibrarySnapshot["session"]["kind"]): kind is "delete" | "loudness" | "purge" { return kind === "delete" || kind === "loudness" || kind === "purge"; }

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


function createNameField(initialValue = "") {
  const field = document.createElement("label");
  const label = document.createElement("span");
  const input = document.createElement("input");
  field.className = "library-name-field";
  label.textContent = "歌单名称";
  input.type = "text";
  input.maxLength = 40;
  input.value = initialValue;
  input.placeholder = "输入歌单名称";
  field.append(label, input);
  return { field, input };
}

function createLibraryButtons(primaryLabel: string, onPrimary: () => void, bindings: LibraryBindings, secondaryLabel: string = "取消") {
  const actions = document.createElement("div");
  const cancelButton = document.createElement("button");
  const primaryButton = document.createElement("button");
  actions.className = "library-modal-actions";
  cancelButton.type = "button";
  cancelButton.className = "small-button quiet";
  cancelButton.textContent = secondaryLabel;
  cancelButton.addEventListener("click", bindings.closeModal);
  primaryButton.type = "button";
  primaryButton.className = "secondary-button";
  primaryButton.textContent = primaryLabel;
  primaryButton.addEventListener("click", onPrimary);
  actions.append(cancelButton, primaryButton);
  return { actions, primaryButton };
}


function renderModalContent(state: LibrarySnapshot, bindings: LibraryBindings): ModalControls {
  const modal = state.session;
  if (isVueModal(modal.kind)) return {};
  if (modal.kind === "generic") return {};
  const { field, input } = createNameField(modal.data.name ?? "");
  input.addEventListener("input", () => bindings.setModalName(input.value));
  if (modal.kind === "favoriteImport") {
    const { field: linkField, input: linkInput } = createNameField(); const label = linkField.querySelector("span"); if (label) label.textContent = "收藏夹链接";
    linkInput.maxLength = 4096; linkInput.placeholder = "https://space.bilibili.com/…/favlist?fid=…"; field.hidden = true;
    linkInput.addEventListener("input", () => bindings.setModalLink(linkInput.value));
    const { actions, primaryButton } = createLibraryButtons("读取收藏夹", () => bindings.submitImport(linkInput.value, input.value), bindings);
    for (const node of [input, linkInput]) node.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); primaryButton.click(); } });
    libraryModalBody.append(linkField, field, actions); linkInput.focus(); return { primary: primaryButton, input, linkInput, nameField: field };
  }
  if (modal.kind === "name") {
    const { actions, primaryButton } = createLibraryButtons(modal.data.mode === "rename" ? "保存" : modal.data.track ? "新建并加入" : "创建", () => bindings.submitName(input.value), bindings);
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); primaryButton.click(); } });
    libraryModalBody.append(field, actions); input.focus(); input.select(); return { primary: primaryButton, input };
  }
  const list = document.createElement("div"); list.className = "playlist-picker"; const track = modal.data.track;
  if (state.playlists.length === 0) { const empty = document.createElement("p"); empty.className = "library-empty-copy"; empty.textContent = "还没有歌单。先在下方新建一个，再把这首歌放进去。"; list.append(empty); }
  else for (const playlist of state.playlists) {
    const alreadyIn = playlist.items.some(item => String(item?.bvid ?? "").toLowerCase() === track?.bvid.toLowerCase());
    const button = document.createElement("button"); button.type = "button"; button.className = "playlist-choice";
    if (alreadyIn) { button.classList.add("is-added"); button.setAttribute("aria-disabled", "true"); }
    button.innerHTML = `<span>${escapeText(playlist.name)}</span><small>${alreadyIn ? "已添加 · " : ""}${playlist.items.length} 首</small>`;
    button.addEventListener("click", () => bindings.submitChoose(playlist.id)); list.append(button);
  }
  const divider = document.createElement("div"); divider.className = "library-divider"; divider.textContent = "新建歌单";
  const { actions, primaryButton } = createLibraryButtons("新建并加入", () => bindings.createAndAdd(input.value), bindings);
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); primaryButton.click(); } });
  libraryModalBody.append(list, divider, field, actions); return { primary: primaryButton, input };
}
function renderLibrarySnapshot(state: LibrarySnapshot, previous: LibrarySnapshot | null, bindings: LibraryBindings): boolean {
  let rendered = false;
  if (state.view.rowsVersion !== null && state.view.rowsVersion !== previous?.view.rowsVersion) { if (state.view.rowsKind === "all") renderFavorites(state, bindings); renderPlaylists(state, bindings); rendered = state.view.rowsKind === "all"; }
  const modal = state.session;
  if (modal.version !== previous?.session.version && modal.open) {
    libraryModalTitle.textContent = modal.title; libraryModalSubtitle.textContent = modal.subtitle; libraryModalSubtitle.hidden = !modal.subtitle;
    if (!isVueModal(modal.kind) && libraryModalRegion) { libraryModalRegion.unmount(); libraryModalRegion = null; }
    if (!libraryModalRegion) libraryModalBody.replaceChildren();
    if (isVueModal(modal.kind)) {
      libraryModalRegion ??= createSyncRegion(libraryModalBody, LibraryModalBody);
      libraryModalRegionKey = modal.version;
    }
    libraryModalStatus.textContent = ""; libraryModal.hidden = false;
    requestAnimationFrame(() => { libraryModal.classList.add("is-open"); libraryModal.setAttribute("aria-hidden", "false"); });
    libraryModalControls = renderModalContent(state, bindings);
  } else if (previous?.session.open && !modal.open) { libraryModal.classList.remove("is-open"); libraryModal.setAttribute("aria-hidden", "true"); }
  if (libraryModalRegion && isVueModal(modal.kind)) {
    libraryModalRegion.update({ key: libraryModalRegionKey, kind: modal.kind, busy: modal.busy, primaryLabel: modal.data.primaryLabel,
      unavailable: modal.data.unavailable ?? [], locations: unavailableTrackLocations(modal.data.unavailable ?? [], state.favorites, state.playlists), favorites: state.favorites, playlists: state.playlists,
      onClose: bindings.closeModal, onSubmitDelete: bindings.submitDelete, onSubmitPurge: bindings.submitPurge });
    if (modal.open && modal.version !== previous?.session.version && (modal.kind === "loudness" || modal.kind === "purge" && (modal.data.unavailable?.length ?? 0) > 0)) {
      libraryModalBody.querySelector<HTMLButtonElement>(libraryModalPrimarySelector)?.focus();
    }
  }
  if (modal !== previous?.session) {
    if (modal.status !== previous?.session.status || modal.open && modal.version !== previous?.session.version) libraryModalStatus.textContent = modal.status;
    const controls = libraryModalControls ?? {};
    if (controls.primary) { controls.primary.disabled = modal.busy; if (modal.data.primaryLabel) controls.primary.textContent = modal.data.primaryLabel; }
    if (controls.linkInput) controls.linkInput.disabled = !!modal.data.linkDisabled;
    if (controls.nameField) controls.nameField.hidden = !modal.data.nameVisible;
    if (controls.input) {
      if (modal.data.name !== previous?.session.data.name && controls.input.value !== modal.data.name) controls.input.value = modal.data.name ?? "";
      if (modal.kind === "favoriteImport") controls.input.disabled = modal.busy && !!modal.data.firstPage;
      if (modal.data.focusName !== previous?.session.data.focusName && modal.data.focusName) { controls.input.focus(); controls.input.select(); }
    }
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
