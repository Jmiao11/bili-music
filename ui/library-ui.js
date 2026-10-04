import { displayThumbnailUrl, escapeText, normalizeTrack, snapshotForLibrary, unavailableTrackLocations } from "./track-utils.ts";
import { invoke } from "./runtime-api.ts";
import { favoritesCount, favoritesList, favoritesStatus, libraryModal, libraryModalBody, libraryModalStatus, libraryModalSubtitle, libraryModalTitle, playlistActions, playlistMeta, playlistTitle, playlistTracks, playlistsList, playlistsStatus, purgeAppearanceStatus, purgeUnavailableTracksButton, status } from "./player-dom.js";
import { favoriteDragState, libraryState, playerState, playlistDragState, playlistListDragState } from "./player-state.js";
import { createTrackRow, currentPlayableTrack, playListItem, updateFavoriteButtons } from "./playback-core.js";

let favoriteImportVersion = 0;

function renderLibraryViews() {
  renderFavorites();
  renderPlaylists();
  updateFavoriteButtons();
  updateLibraryHighlights();
}

function isFavoriteDragClickSuppressed() {
  return favoriteDragState.drag !== null || performance.now() < favoriteDragState.suppressClickUntil;
}

function finishFavoriteDrag() {
  const drag = favoriteDragState.drag;
  drag?.row.classList.remove("is-dragging");
  drag?.target?.classList.remove("is-drop-before", "is-drop-after");
  favoriteDragState.drag = null;
  // Cover the post-drop click, including when another favorite operation re-renders the list.
  favoriteDragState.suppressClickUntil = performance.now() + 400;
}

function bindFavoriteDrag(row, index) {
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
  row.addEventListener("dragleave", (event) => {
    const drag = favoriteDragState.drag;
    if (drag?.target === row && !row.contains(event.relatedTarget)) {
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
      const items = await invoke("reorder_favorite", {
        fromIndex: drag.index,
        toIndex: index,
      });
      libraryState.favorites = items.map(normalizeTrack);
      libraryState.favoriteBvids = new Set(
        libraryState.favorites.map((item) => item.bvid.toLowerCase()),
      );
    } catch (error) {
      console.warn("favorite reorder failed:", error);
    } finally {
      favoriteDragState.saving = false;
      renderLibraryViews();
    }
  });
  row.addEventListener("dragend", finishFavoriteDrag);
}

function renderFavorites() {
  if (!favoritesList) {
    return;
  }
  if (favoriteDragState.drag) {
    finishFavoriteDrag();
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
    const row = createTrackRow(
      video,
      index,
      (targetIndex, pageSelection) => {
        // Guard the delayed single-click callback as well as the native click event.
        if (!isFavoriteDragClickSuppressed()) {
          playListItem("favorites", libraryState.favorites, targetIndex, pageSelection);
        }
      },
    );
    bindFavoriteDrag(row, index);
    favoritesList.append(row);
  }
}

function isPlaylistDragClickSuppressed() {
  return playlistDragState.drag !== null || performance.now() < playlistDragState.suppressClickUntil;
}

function finishPlaylistDrag() {
  const drag = playlistDragState.drag;
  drag?.row.classList.remove("is-dragging");
  drag?.target?.classList.remove("is-drop-before", "is-drop-after");
  playlistDragState.drag = null;
  // Cover the mouse click emitted after a native drop, including after a re-render.
  playlistDragState.suppressClickUntil = performance.now() + 400;
}

function bindPlaylistItemDrag(row, playlistId, index) {
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
  row.addEventListener("dragleave", (event) => {
    const drag = playlistDragState.drag;
    if (drag?.target === row && !row.contains(event.relatedTarget)) {
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
      libraryState.playlists = await invoke("reorder_playlist_item", {
        id: playlistId,
        fromIndex: drag.index,
        toIndex: index,
      });
    } catch (error) {
      console.warn("playlist reorder failed:", error);
    } finally {
      playlistDragState.saving = false;
      renderLibraryViews();
    }
  });
  row.addEventListener("dragend", finishPlaylistDrag);
}

function isPlaylistListDragClickSuppressed() {
  return playlistListDragState.drag !== null || performance.now() < playlistListDragState.suppressClickUntil;
}

function finishPlaylistListDrag() {
  const drag = playlistListDragState.drag;
  drag?.row.classList.remove("is-dragging");
  drag?.target?.classList.remove("is-drop-before", "is-drop-after");
  playlistListDragState.drag = null;
  // Keep the post-drop click suppressed even if the list has already been re-rendered.
  playlistListDragState.suppressClickUntil = performance.now() + 400;
}

function bindPlaylistDrag(row, index) {
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
  row.addEventListener("dragleave", (event) => {
    const drag = playlistListDragState.drag;
    if (drag?.target === row && !row.contains(event.relatedTarget)) {
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
      libraryState.playlists = await invoke("reorder_playlist", {
        fromIndex: drag.index,
        toIndex: index,
      });
    } catch (error) {
      console.warn("playlist list reorder failed:", error);
    } finally {
      playlistListDragState.saving = false;
      renderLibraryViews();
    }
  });
  row.addEventListener("dragend", finishPlaylistListDrag);
}

function renderPlaylists() {
  if (!playlistsList) {
    return;
  }
  if (playlistDragState.drag) {
    finishPlaylistDrag();
  }
  if (playlistListDragState.drag) {
    finishPlaylistListDrag();
  }
  playlistsList.replaceChildren();
  const selectedPlaylist =
    libraryState.playlists.find((playlist) => playlist.id === libraryState.selectedPlaylistId) ??
    libraryState.playlists[0] ??
    null;
  libraryState.selectedPlaylistId = selectedPlaylist?.id ?? "";

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
      libraryState.selectedPlaylistId = playlist.id;
      renderPlaylists();
    });
    item.append(button);
    bindPlaylistDrag(item, index);
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
    const row = createTrackRow(
      video,
      index,
      (targetIndex, pageSelection) => {
        // Also guard the delayed single-click callback scheduled before a drag started.
        if (!isPlaylistDragClickSuppressed()) {
          playListItem("playlist", selectedPlaylist.items, targetIndex, {
            playlistId: selectedPlaylist.id,
            ...(pageSelection ?? {}),
          });
        }
      },
      { playlistId: selectedPlaylist.id },
    );
    bindPlaylistItemDrag(row, selectedPlaylist.id, index);
    playlistTracks.append(row);
  }
}

function updateLibraryHighlights() {
  if (favoritesList) {
    for (const button of favoritesList.querySelectorAll("button.track")) {
      const index = Number(button.dataset.libraryIndex);
      if (playerState.queueSource === "favorites" && index === playerState.currentIndex) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  }
  if (playlistTracks) {
    for (const button of playlistTracks.querySelectorAll("button.track")) {
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

async function loadLibrary() {
  try {
    const [favorites, playlists, unavailableTracks, disabledPages] = await Promise.all([
      invoke("list_favorites"),
      invoke("list_playlists"),
      invoke("list_unavailable_tracks").catch((error) => {
        console.warn("unavailable tracks load failed:", error);
        return [];
      }),
      invoke("list_disabled_pages").catch((error) => {
        console.warn("disabled pages load failed:", error);
        return {};
      }),
    ]);
    libraryState.favorites = favorites.map(normalizeTrack);
    libraryState.favoriteBvids = new Set(
      libraryState.favorites.map((track) => track.bvid.toLowerCase()),
    );
    libraryState.playlists = playlists.map((playlist) => ({
      ...playlist,
      items: (playlist.items ?? []).map(normalizeTrack),
    }));
    libraryState.unavailableBvids = new Map(
      unavailableTracks.map((item) => [item.bvid.toLowerCase(), item.reason]),
    );
    libraryState.disabledPages = new Map(
      Object.entries(disabledPages).map(([bvid, cids]) => [bvid.toLowerCase(), new Set(cids)]),
    );
    libraryState.loadError = "";
  } catch (error) {
    libraryState.favorites = [];
    libraryState.favoriteBvids = new Set();
    libraryState.playlists = [];
    libraryState.unavailableBvids = new Map();
    libraryState.disabledPages = new Map();
    libraryState.loadError = `本地资料库读取失败：${error}`;
    console.error("library load failed:", error);
  }
  renderLibraryViews();
}

async function toggleFavorite(video = currentPlayableTrack()) {
  const track = video ? snapshotForLibrary(video) : null;
  if (!track?.bvid) {
    status.textContent = "请先选择一首歌曲。";
    return;
  }
  try {
    const result = await invoke("toggle_favorite", { track });
    libraryState.favorites = result.items.map(normalizeTrack);
    libraryState.favoriteBvids = new Set(
      libraryState.favorites.map((item) => item.bvid.toLowerCase()),
    );
    renderLibraryViews();
    status.textContent = result.favorited ? "已加入收藏。" : "已取消收藏。";
    window.dispatchEvent(new CustomEvent("bilibili-music-favorite-change", {
      detail: { bvid: track.bvid, title: track.title, favorited: result.favorited },
    }));
    if (result.favorited) {
      window.dispatchEvent(new CustomEvent("bilibili-music-favorite", { detail: { bvid: track.bvid, title: track.title } }));
    }
  } catch (error) {
    status.textContent = `收藏操作失败：${error}`;
    window.dispatchEvent(new CustomEvent("bilibili-music-favorite-change", {
      detail: { bvid: track.bvid, title: track.title, failed: true },
    }));
  }
}

function openLibraryModal(title, subtitle) {
  favoriteImportVersion += 1;
  libraryModalTitle.textContent = title;
  libraryModalSubtitle.textContent = subtitle;
  libraryModalSubtitle.hidden = !subtitle;
  libraryModalBody.replaceChildren();
  libraryModalStatus.textContent = "";
  libraryModal.hidden = false;
  requestAnimationFrame(() => {
    libraryModal.classList.add("is-open");
    libraryModal.setAttribute("aria-hidden", "false");
  });
}

function closeLibraryModal() {
  favoriteImportVersion += 1;
  libraryModal.classList.remove("is-open");
  libraryModal.setAttribute("aria-hidden", "true");
}

function validatePlaylistName(name, { excludeId = "" } = {}) {
  const normalized = name.trim();
  if (!normalized) {
    return { ok: false, message: "歌单名不能为空。" };
  }
  const duplicated = libraryState.playlists.some(
    (playlist) =>
      playlist.id !== excludeId &&
      playlist.name.trim().toLocaleLowerCase() === normalized.toLocaleLowerCase(),
  );
  if (duplicated) {
    return { ok: false, message: "已存在同名歌单，请换个名字。" };
  }
  return { ok: true, name: normalized };
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

function createLibraryActions(primaryLabel, onPrimary, secondaryLabel = "取消") {
  const actions = document.createElement("div");
  const cancelButton = document.createElement("button");
  const primaryButton = document.createElement("button");
  actions.className = "library-modal-actions";
  cancelButton.type = "button";
  cancelButton.className = "small-button quiet";
  cancelButton.textContent = secondaryLabel;
  cancelButton.addEventListener("click", closeLibraryModal);
  primaryButton.type = "button";
  primaryButton.className = "secondary-button";
  primaryButton.textContent = primaryLabel;
  primaryButton.addEventListener("click", onPrimary);
  actions.append(cancelButton, primaryButton);
  return { actions, primaryButton };
}

async function openPurgeUnavailableTracksModal() {
  purgeUnavailableTracksButton.disabled = true;
  let unavailable;
  try {
    unavailable = await invoke("list_unavailable_tracks");
  } catch (error) {
    purgeAppearanceStatus.textContent = `读取失效曲目失败：${error}`;
    return;
  } finally {
    purgeUnavailableTracksButton.disabled = false;
  }

  openLibraryModal("清理失效曲目", "以下歌曲已无法播放，确认后会从收藏和所有歌单中移除。");

  if (unavailable.length === 0) {
    const empty = document.createElement("p");
    empty.className = "library-empty-copy";
    empty.textContent = "没有失效曲目。";
    libraryModalBody.append(empty);
    return;
  }

  const locations = unavailableTrackLocations(
    unavailable,
    libraryState.favorites,
    libraryState.playlists,
  );
  const snapshots = new Map();
  for (const track of libraryState.favorites) {
    snapshots.set(track.bvid.toLowerCase(), track);
  }
  for (const playlist of libraryState.playlists) {
    for (const track of playlist.items ?? []) {
      const key = track.bvid.toLowerCase();
      if (!snapshots.has(key)) snapshots.set(key, track);
    }
  }

  const list = document.createElement("div");
  list.className = "unavailable-purge-list";
  for (const item of unavailable) {
    const key = item.bvid.toLowerCase();
    const snapshot = snapshots.get(key);
    const row = document.createElement("div");
    const coverWrap = document.createElement("span");
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    const reason = document.createElement("span");
    const location = document.createElement("span");
    row.className = "unavailable-purge-item";
    coverWrap.className = "unavailable-purge-cover";
    copy.className = "unavailable-purge-copy";
    title.textContent = snapshot?.title || item.bvid;
    reason.className = "unavailable-purge-reason";
    reason.textContent = item.reason;
    location.className = "unavailable-purge-location";
    location.textContent = locations.get(key);

    if (snapshot?.thumbnailUrl) {
      const cover = document.createElement("img");
      cover.src = displayThumbnailUrl(snapshot.thumbnailUrl);
      cover.alt = "";
      cover.loading = "lazy";
      cover.referrerPolicy = "no-referrer";
      coverWrap.append(cover);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "cover-placeholder";
      coverWrap.append(placeholder);
    }

    copy.append(title, reason, location);
    row.append(coverWrap, copy);
    list.append(row);
  }

  const { actions, primaryButton } = createLibraryActions("全部清理", async () => {
    primaryButton.disabled = true;
    libraryModalStatus.textContent = "正在清理…";
    try {
      const result = await invoke("purge_unavailable_tracks");
      await loadLibrary();
      closeLibraryModal();
      purgeAppearanceStatus.textContent = `已清理 ${result.clearedMarks} 首失效曲目。`;
    } catch (error) {
      libraryModalStatus.textContent = `清理失效曲目失败：${error}`;
      primaryButton.disabled = false;
    }
  });
  libraryModalBody.append(list, actions);
  primaryButton.focus();
}

function showPlaylistNameDialog({ mode, playlist = null, track = null } = {}) {
  const isRename = mode === "rename";
  openLibraryModal(
    isRename ? "重命名歌单" : "新建歌单",
    isRename ? "换一个清晰的名字，方便之后找到。" : "创建后可以继续加入当前歌曲。",
  );

  const { field, input } = createNameField(isRename ? playlist?.name ?? "" : "");
  const { actions, primaryButton } = createLibraryActions(
    isRename ? "保存" : track ? "新建并加入" : "创建",
    async () => {
      const validation = validatePlaylistName(input.value, {
        excludeId: playlist?.id ?? "",
      });
      if (!validation.ok) {
        libraryModalStatus.textContent = validation.message;
        input.focus();
        return;
      }
      primaryButton.disabled = true;
      libraryModalStatus.textContent = isRename ? "正在保存…" : "正在创建…";
      try {
        if (isRename) {
          libraryState.playlists = await invoke("rename_playlist", {
            id: playlist.id,
            name: validation.name,
          });
        } else {
          const knownIds = new Set(libraryState.playlists.map((item) => item.id));
          libraryState.playlists = await invoke("create_playlist", {
            name: validation.name,
          });
          const created =
            libraryState.playlists.find((item) => !knownIds.has(item.id)) ??
            libraryState.playlists.at(-1);
          if (created) {
            libraryState.selectedPlaylistId = created.id;
            if (track) {
              libraryState.playlists = await invoke("add_to_playlist", {
                id: created.id,
                track,
              });
              status.textContent = `已加入歌单“${created.name}”。`;
            }
          }
        }
        renderLibraryViews();
        closeLibraryModal();
      } catch (error) {
        libraryModalStatus.textContent = `${isRename ? "改名" : "新建"}失败：${error}`;
      } finally {
        primaryButton.disabled = false;
      }
    },
  );
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      primaryButton.click();
    }
  });
  libraryModalBody.append(field, actions);
  input.focus();
  input.select();
}

function createPlaylist() {
  showPlaylistNameDialog({ mode: "create" });
}

function importFavoritePlaylist() {
  openLibraryModal("导入 B站收藏夹", "仅支持公开收藏夹，最多导入 200 个有效视频；失效或无法导入的条目将跳过。");
  const version = favoriteImportVersion;
  const active = () => version === favoriteImportVersion;
  const { field: linkField, input: linkInput } = createNameField();
  linkField.querySelector("span").textContent = "收藏夹链接";
  linkInput.maxLength = 4096;
  linkInput.placeholder = "https://space.bilibili.com/…/favlist?fid=…";
  const { field: nameField, input: nameInput } = createNameField();
  nameField.hidden = true;
  let firstPage = null;
  let busy = false;
  const { actions, primaryButton } = createLibraryActions("读取收藏夹", async () => {
    if (busy) return;
    busy = true;
    primaryButton.disabled = true;
    try {
      if (!firstPage) {
        linkInput.disabled = true;
        libraryModalStatus.textContent = "正在读取收藏夹第 1 页…";
        const result = await invoke("read_public_favorite_page", { link: linkInput.value, page: 1, existing: [] });
        if (!active()) return;
        firstPage = result;
        nameInput.value = Array.from(result.title).slice(0, 40).join("");
        nameField.hidden = false;
        primaryButton.textContent = "开始导入";
        libraryModalStatus.textContent = `收藏夹共 ${result.total} 条，可修改歌单名称后导入。${Array.from(result.title).length > 40 ? "标题较长，请确认缩短后的名称。" : ""}`;
        nameInput.focus();
        nameInput.select();
        return;
      }
      const validation = validatePlaylistName(nameInput.value);
      if (!validation.ok) {
        libraryModalStatus.textContent = validation.message;
        nameInput.focus();
        return;
      }
      nameInput.disabled = true;
      const tracks = [];
      let skipped = 0;
      let duplicates = 0;
      let scanned = 0;
      let page = 1;
      let result = firstPage;
      while (active()) {
        tracks.push(...result.items);
        skipped += result.skipped;
        duplicates += result.duplicates;
        scanned += result.scanned;
        libraryModalStatus.textContent = `已读取第 ${page} 页 · 已检查 ${scanned} 条 · 有效 ${tracks.length}/200 · 跳过 ${skipped} 条`;
        if (!result.hasMore) break;
        page += 1;
        result = await invoke("read_public_favorite_page", {
          link: linkInput.value, page, existing: tracks.map((track) => track.bvid),
        });
      }
      if (!active()) return;
      if (!tracks.length) {
        libraryModalStatus.textContent = `没有可导入的视频，已跳过 ${skipped} 条，未创建歌单。`;
        return;
      }
      libraryModalStatus.textContent = `正在保存 ${tracks.length} 条视频…`;
      const created = await invoke("create_imported_playlist", { name: validation.name, tracks });
      libraryState.playlists.push(created);
      libraryState.selectedPlaylistId = created.id;
      renderLibraryViews();
      const summary = `已创建“${created.name}”，导入 ${created.items.length} 条，跳过失效或无法导入 ${skipped} 条${duplicates ? `，去重 ${duplicates} 条` : ""}。${result.truncated ? "已达到 200 条上限，剩余内容未导入。" : ""}`;
      playlistsStatus.textContent = summary;
      if (active()) closeLibraryModal();
    } catch (error) {
      if (active()) {
        libraryModalStatus.textContent = `导入失败：${error}。未创建歌单，可重试。`;
        if (!firstPage) linkInput.disabled = false;
      }
    } finally {
      busy = false;
      if (active()) {
        primaryButton.disabled = false;
        nameInput.disabled = false;
      }
    }
  });
  for (const input of [linkInput, nameInput]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); primaryButton.click(); }
    });
  }
  libraryModalBody.append(linkField, nameField, actions);
  linkInput.focus();
}

function renameSelectedPlaylist() {
  const playlist = selectedPlaylist();
  if (!playlist) {
    return;
  }
  showPlaylistNameDialog({ mode: "rename", playlist });
}

function deleteSelectedPlaylist() {
  const playlist = selectedPlaylist();
  if (!playlist) {
    return;
  }
  openLibraryModal("删除歌单", `确认删除“${playlist.name}”？歌曲本身不会被删除。`);
  const message = document.createElement("p");
  message.className = "library-confirm-copy";
  message.textContent = "这个操作会移除歌单和其中的条目，之后需要重新创建。";
  const { actions, primaryButton } = createLibraryActions("删除", async () => {
    primaryButton.disabled = true;
    libraryModalStatus.textContent = "正在删除…";
    try {
      libraryState.playlists = await invoke("delete_playlist", { id: playlist.id });
      libraryState.selectedPlaylistId = libraryState.playlists[0]?.id ?? "";
      renderLibraryViews();
      closeLibraryModal();
    } catch (error) {
      libraryModalStatus.textContent = `删除失败：${error}`;
    } finally {
      primaryButton.disabled = false;
    }
  });
  primaryButton.classList.add("danger-action");
  libraryModalBody.append(message, actions);
}

function choosePlaylistAndAdd(video = currentPlayableTrack()) {
  const track = video ? snapshotForLibrary(video) : null;
  if (!track?.bvid) {
    status.textContent = "请先选择一首歌曲。";
    return;
  }
  openLibraryModal("加入歌单", "选择一个歌单，或新建后加入。");
  const list = document.createElement("div");
  list.className = "playlist-picker";

  if (libraryState.playlists.length === 0) {
    const empty = document.createElement("p");
    empty.className = "library-empty-copy";
    empty.textContent = "还没有歌单。先在下方新建一个，再把这首歌放进去。";
    list.append(empty);
  } else {
    const trackBvid = track.bvid.toLowerCase();
    for (const playlist of libraryState.playlists) {
      const alreadyIn = playlist.items.some(
        (item) => String(item?.bvid ?? "").toLowerCase() === trackBvid,
      );
      const button = document.createElement("button");
      button.type = "button";
      button.className = "playlist-choice";
      if (alreadyIn) {
        button.classList.add("is-added");
        button.setAttribute("aria-disabled", "true");
      }
      button.innerHTML = `<span>${escapeText(playlist.name)}</span><small>${alreadyIn ? "已添加 · " : ""}${playlist.items.length} 首</small>`;
      button.addEventListener("click", () => {
        if (alreadyIn) {
          libraryModalStatus.textContent = `该歌曲已在歌单“${playlist.name}”中，无需重复加入。`;
          return;
        }
        addTrackToPlaylist(playlist, track);
      });
      list.append(button);
    }
  }

  const divider = document.createElement("div");
  divider.className = "library-divider";
  divider.textContent = "新建歌单";
  const { field, input } = createNameField("");
  const { actions, primaryButton } = createLibraryActions("新建并加入", async () => {
    const validation = validatePlaylistName(input.value);
    if (!validation.ok) {
      libraryModalStatus.textContent = validation.message;
      input.focus();
      return;
    }
    primaryButton.disabled = true;
    libraryModalStatus.textContent = "正在创建…";
    try {
      const knownIds = new Set(libraryState.playlists.map((item) => item.id));
      libraryState.playlists = await invoke("create_playlist", { name: validation.name });
      const created =
        libraryState.playlists.find((item) => !knownIds.has(item.id)) ??
        libraryState.playlists.at(-1);
      if (created) {
        await addTrackToPlaylist(created, track);
      }
    } catch (error) {
      libraryModalStatus.textContent = `新建歌单失败：${error}`;
    } finally {
      primaryButton.disabled = false;
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      primaryButton.click();
    }
  });
  libraryModalBody.append(list, divider, field, actions);
}

async function addTrackToPlaylist(playlist, track) {
  libraryModalStatus.textContent = `正在加入“${playlist.name}”…`;
  try {
    libraryState.playlists = await invoke("add_to_playlist", {
      id: playlist.id,
      track,
    });
    libraryState.selectedPlaylistId = playlist.id;
    renderLibraryViews();
    status.textContent = `已加入歌单“${playlist.name}”。`;
    closeLibraryModal();
  } catch (error) {
    // 后端重复检测兑底（例如弹窗打开期间歌单已在别处被更新）。
    libraryModalStatus.textContent = String(error).includes("歌曲已在歌单")
      ? `${error}`
      : `加入歌单失败：${error}`;
  }
}

async function removeTrackFromPlaylist(id, bvid) {
  try {
    libraryState.playlists = await invoke("remove_from_playlist", { id, bvid });
    renderLibraryViews();
  } catch (error) {
    playlistsStatus.textContent = `移除失败：${error}`;
  }
}

function selectedPlaylist() {
  return libraryState.playlists.find(
    (playlist) => playlist.id === libraryState.selectedPlaylistId,
  );
}

export { choosePlaylistAndAdd, closeLibraryModal, createPlaylist, deleteSelectedPlaylist, importFavoritePlaylist, loadLibrary, openLibraryModal, openPurgeUnavailableTracksModal, removeTrackFromPlaylist, renameSelectedPlaylist, renderLibraryViews, toggleFavorite, updateLibraryHighlights };
