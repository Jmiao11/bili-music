import type { DeepReadonly } from "./state-store.ts";
import { normalizeTrack, snapshotForLibrary } from "./track-utils.ts";

type LibraryCommand = "list_favorites" | "list_playlists" | "list_unavailable_tracks" | "list_disabled_pages" | "toggle_favorite" | "create_playlist" | "rename_playlist" | "delete_playlist" | "add_to_playlist" | "remove_from_playlist" | "reorder_favorite" | "reorder_playlist_item" | "reorder_playlist" | "read_public_favorite_page" | "create_imported_playlist" | "purge_unavailable_tracks" | "set_page_disabled" | "clear_disabled_pages";
type LibraryAdapter = { invoke: <K extends LibraryCommand>(command: K, ...args: CommandArguments<K>) => Promise<CommandMap[K]["result"]>; report: (level: "warn" | "error", message: string, error: unknown) => void };
type ModalKind = "generic" | "name" | "delete" | "choose" | "favoriteImport" | "purge" | "loudness";
type LibraryDragKind = "favorites" | "playlistItems" | "playlists";
type LibraryDragState = { drag: { index: number; playlistId?: string } | null; saving: boolean; suppressClickUntil: number };
type LibraryState = {
  disabledPages: Map<string, Set<number>>; disabledPagePending: Map<string, number | null>;
  drags: Record<LibraryDragKind, LibraryDragState>;
  favorites: CommandContract.TrackSnapshot[]; favoriteBvids: Set<string>; playlists: CommandContract.Playlist[]; selectedPlaylistId: string; unavailableBvids: Map<string, string>; loadError: string;
  session: { kind: ModalKind; open: boolean; title: string; subtitle: string; version: number; busy: boolean; status: string;
    data: { mode?: string; playlist?: CommandContract.Playlist | null; track?: CommandContract.TrackSnapshotInput | null; unavailable?: CommandMap["list_unavailable_tracks"]["result"]; firstPage?: CommandMap["read_public_favorite_page"]["result"] | null; name?: string; link?: string; nameVisible?: boolean; linkDisabled?: boolean; focusName?: number; primaryLabel?: string } };
  view: { rowsVersion: number | null; rowsKind: "all" | "playlists"; playbackVersion: number; playbackStatus: string | null; playlistsStatus: string | null; purgeStatus: string | null; purgeBusy: boolean | null };
};
type LibrarySnapshot = DeepReadonly<LibraryState>;
function initialLibraryState(): LibraryState {
  return { disabledPages: new Map(), disabledPagePending: new Map(), drags: { favorites: { drag: null, saving: false, suppressClickUntil: 0 }, playlistItems: { drag: null, saving: false, suppressClickUntil: 0 }, playlists: { drag: null, saving: false, suppressClickUntil: 0 } }, favorites: [], favoriteBvids: new Set(), playlists: [], selectedPlaylistId: "", unavailableBvids: new Map(), loadError: "",
    session: { kind: "generic", open: false, title: "", subtitle: "", version: 0, busy: false, status: "", data: {} },
    view: { rowsVersion: null, rowsKind: "all", playbackVersion: 0, playbackStatus: null, playlistsStatus: null, purgeStatus: null, purgeBusy: null } };
}
function isLibraryDragClickSuppressed(state: LibrarySnapshot, kind: LibraryDragKind, now: number): boolean { return state.drags[kind].drag !== null || now < state.drags[kind].suppressClickUntil; }
function createLibraryActions(read: () => LibrarySnapshot, commit: (next: LibrarySnapshot, disabledResult?: { bvid: string; error: string | null }) => void, adapter: LibraryAdapter) {
  const update = (fields: Partial<LibrarySnapshot>, view: Partial<LibrarySnapshot["view"]> = {}) => {
    const current = read(); const next = { ...current, ...fields, view: Object.keys(view).length ? { ...current.view, ...view, ...(Object.hasOwn(view, "playbackStatus") ? { playbackVersion: current.view.playbackVersion + 1 } : {}) } : current.view };
    if (fields.playlists || fields.selectedPlaylistId !== undefined) next.selectedPlaylistId = next.playlists.find(p => p.id === next.selectedPlaylistId)?.id ?? next.playlists[0]?.id ?? "";
    commit(next);
  };
  const refreshFields = (rowsKind: "all" | "playlists" = "all") => ({ rowsVersion: (read().view.rowsVersion ?? 0) + 1, rowsKind, playlistsStatus: null });
  const refresh = (kind: "all" | "playlists" = "all") => update({}, refreshFields(kind));
  const modal = (fields: Partial<LibrarySnapshot["session"]>) => update({ session: { ...read().session, ...fields } });
  const modalData = (fields: Partial<LibrarySnapshot["session"]["data"]>) => modal({ data: { ...read().session.data, ...fields } });
  function openedSession(kind: ModalKind, title: string, subtitle: string, data: LibrarySnapshot["session"]["data"] = {}) {
    return { ...read().session, kind, title, subtitle, data, open: true, version: read().session.version + 1, busy: false, status: "" };
  }
  function open(kind: ModalKind, title: string, subtitle: string, data: LibrarySnapshot["session"]["data"] = {}): void { update({ session: openedSession(kind, title, subtitle, data) }); }
  const finishedSession = () => ({ ...read().session, open: false, busy: false, version: read().session.version + 1 });
  function finish(fields: Partial<LibrarySnapshot>, view: Partial<LibrarySnapshot["view"]> = {}): void { update({ ...fields, session: finishedSession() }, { ...refreshFields(), ...view }); }
  function close(): void { modal({ open: false, version: read().session.version + 1 }); }
  function validateName(name: string, { excludeId = "" }: { excludeId?: string } = {}): { ok: false; message: string } | { ok: true; name: string } {
    const normalized = name.trim();
    if (!normalized) return { ok: false, message: "歌单名不能为空。" };
    if (read().playlists.some(p => p.id !== excludeId && p.name.trim().toLocaleLowerCase() === normalized.toLocaleLowerCase())) return { ok: false, message: "已存在同名歌单，请换个名字。" };
    return { ok: true, name: normalized };
  }
  function validateModalName(name: string, excludeId = "") {
    const result = validateName(name, { excludeId });
    if (!result.ok) { modal({ status: result.message, data: { ...read().session.data, focusName: (read().session.data.focusName ?? 0) + 1 } }); }
    return result;
  }
  async function readLibrary(onDisabledPages: (pages: CommandMap["list_disabled_pages"]["result"]) => void = () => {}): Promise<Partial<LibrarySnapshot>> {
    try {
      const [favorites, playlists, unavailable, disabled] = await Promise.all([
        adapter.invoke("list_favorites"), adapter.invoke("list_playlists"),
        adapter.invoke("list_unavailable_tracks").catch(error => { adapter.report("warn", "unavailable tracks load failed:", error); return []; }),
        adapter.invoke("list_disabled_pages").catch(error => { adapter.report("warn", "disabled pages load failed:", error); return {}; }),
      ]);
      onDisabledPages(disabled);
      const items = favorites.map(normalizeTrack);
      return { disabledPages: new Map(Object.entries(disabled).map(([bvid, cids]) => [bvid.toLowerCase(), new Set(cids)])), favorites: items, favoriteBvids: new Set(items.map(t => t.bvid.toLowerCase())), playlists: playlists.map(p => ({ ...p, items: (p.items ?? []).map(normalizeTrack) })), unavailableBvids: new Map(unavailable.map(t => [t.bvid.toLowerCase(), t.reason])), loadError: "" };
    } catch (error) {
      onDisabledPages({});
      adapter.report("error", "library load failed:", error);
      return { disabledPages: new Map(), favorites: [], favoriteBvids: new Set(), playlists: [], unavailableBvids: new Map(), loadError: `本地资料库读取失败：${error}` };
    }
  }
  async function load(onDisabledPages: Parameters<typeof readLibrary>[0] = () => {}): Promise<void> { update(await readLibrary(onDisabledPages), refreshFields()); }
  async function toggle(video: CommandContract.TrackSnapshotInput | null) {
    const track = video ? snapshotForLibrary(video) : null;
    if (!track?.bvid) { update({}, { playbackStatus: "请先选择一首歌曲。" }); return null; }
    try {
      const result = await adapter.invoke("toggle_favorite", { track }); const favorites = result.items.map(normalizeTrack);
      update({ favorites, favoriteBvids: new Set(favorites.map(t => t.bvid.toLowerCase())) }, { ...refreshFields(), playbackStatus: result.favorited ? "已加入收藏。" : "已取消收藏。" });
      return { track, favorited: result.favorited };
    } catch (error) { update({}, { playbackStatus: `收藏操作失败：${error}` }); return { track, failed: true as const }; }
  }
  function choosePlaylist(id: string): void { update({ selectedPlaylistId: id }, refreshFields("playlists")); }
  function markUnavailable(bvid: string, reason: string): void { const values = new Map(read().unavailableBvids); values.set(bvid.toLowerCase(), reason); update({ unavailableBvids: values }); }
  function clearUnavailable(bvid: string): boolean { if (!read().unavailableBvids.has(bvid.toLowerCase())) return false; const values = new Map(read().unavailableBvids); values.delete(bvid.toLowerCase()); update({ unavailableBvids: values }); return true; }
  function showName(mode: string, playlist: LibrarySnapshot["playlists"][number] | null = null, track: LibrarySnapshot["session"]["data"]["track"] = null): void {
    open("name", mode === "rename" ? "重命名歌单" : "新建歌单", mode === "rename" ? "换一个清晰的名字，方便之后找到。" : "创建后可以继续加入当前歌曲。", { mode, playlist, track, name: mode === "rename" ? playlist?.name ?? "" : "" });
  }
  async function submitName(name: string): Promise<void> {
    const { mode, playlist, track } = read().session.data; const rename = mode === "rename";
    const validation = validateModalName(name, playlist?.id); if (!validation.ok) return;
    const version = read().session.version; modal({ busy: true, status: rename ? "正在保存…" : "正在创建…" });
    try {
      if (rename) { if (!playlist) return; finish({ playlists: await adapter.invoke("rename_playlist", { id: playlist.id, name: validation.name }) }); }
      else {
        const known = new Set(read().playlists.map(p => p.id)); const playlists = await adapter.invoke("create_playlist", { name: validation.name });
        const created = playlists.find(p => !known.has(p.id)) ?? playlists.at(-1);
        if (created && track) {
          update({ playlists, selectedPlaylistId: created.id });
          finish({ playlists: await adapter.invoke("add_to_playlist", { id: created.id, track }) }, { playbackStatus: `已加入歌单“${created.name}”。` });
        } else finish({ playlists, ...(created ? { selectedPlaylistId: created.id } : {}) });
      }
    } catch (error) { modal({ ...(read().session.version === version || !read().session.open ? { busy: false } : {}), status: `${rename ? "改名" : "新建"}失败：${error}` }); }
    finally { if (read().session.busy && (read().session.version === version || !read().session.open)) modal({ busy: false }); }
  }
  function showDelete(): void { const p = read().playlists.find(p => p.id === read().selectedPlaylistId); if (p) open("delete", "删除歌单", `确认删除“${p.name}”？歌曲本身不会被删除。`, { playlist: p }); }
  async function submitDelete(): Promise<void> {
    const p = read().session.data.playlist; if (!p) return; const version = read().session.version;
    modal({ busy: true, status: "正在删除…" });
    try { const playlists = await adapter.invoke("delete_playlist", { id: p.id }); finish({ playlists, selectedPlaylistId: playlists[0]?.id ?? "" }); }
    catch (error) { modal({ ...(read().session.version === version || !read().session.open ? { busy: false } : {}), status: `删除失败：${error}` }); }
    finally { if (read().session.busy && (read().session.version === version || !read().session.open)) modal({ busy: false }); }
  }
  function showChoose(video: CommandContract.TrackSnapshotInput | null): void {
    const track = video ? snapshotForLibrary(video) : null;
    if (!track?.bvid) { update({}, { playbackStatus: "请先选择一首歌曲。" }); return; }
    open("choose", "加入歌单", "选择一个歌单，或新建后加入。", { track, name: "" });
  }
  async function addTrack(playlist: LibrarySnapshot["playlists"][number], track: CommandContract.TrackSnapshotInput, playlists?: LibrarySnapshot["playlists"], version = read().session.version): Promise<void> {
    update({ ...(playlists ? { playlists } : {}), session: { ...read().session, status: `正在加入“${playlist.name}”…` } });
    try { finish({ playlists: await adapter.invoke("add_to_playlist", { id: playlist.id, track }), selectedPlaylistId: playlist.id }, { playbackStatus: `已加入歌单“${playlist.name}”。` }); }
    catch (error) { modal({ ...(playlists && (read().session.version === version || !read().session.open) ? { busy: false } : {}), status: String(error).includes("歌曲已在歌单") ? `${error}` : `加入歌单失败：${error}` }); }
  }
  async function submitChoose(id: string): Promise<void> {
    const p = read().playlists.find(p => p.id === id), track = read().session.data.track; if (!p || !track) return;
    if (p.items.some(t => t.bvid.toLowerCase() === track.bvid.toLowerCase())) { modal({ status: `该歌曲已在歌单“${p.name}”中，无需重复加入。` }); return; }
    await addTrack(p, track);
  }
  async function createAndAdd(name: string): Promise<void> {
    const track = read().session.data.track; if (!track) return; const validation = validateModalName(name); if (!validation.ok) return;
    const version = read().session.version; modal({ busy: true, status: "正在创建…" });
    try { const known = new Set(read().playlists.map(p => p.id)); const playlists = await adapter.invoke("create_playlist", { name: validation.name }); const p = playlists.find(p => !known.has(p.id)) ?? playlists.at(-1); if (p) await addTrack(p, track, playlists, version); else update({ playlists, session: { ...read().session, busy: false } }); }
    catch (error) { modal({ ...(read().session.version === version || !read().session.open ? { busy: false } : {}), status: `新建歌单失败：${error}` }); }
    finally { if (read().session.version === version || !read().session.open) modal({ busy: false }); }
  }
  async function removeTrack(id: string, bvid: string): Promise<void> { try { update({ playlists: await adapter.invoke("remove_from_playlist", { id, bvid }) }, refreshFields()); } catch (error) { update({}, { playlistsStatus: `移除失败：${error}` }); } }
  function showImport(): void { open("favoriteImport", "导入 B站收藏夹", "仅支持公开收藏夹，最多导入 200 个有效视频；失效或无法导入的条目将跳过。", { firstPage: null, name: "", link: "", nameVisible: false, linkDisabled: false, primaryLabel: "读取收藏夹" }); }
  async function submitImport(link: string, name: string): Promise<void> {
    if (read().session.busy) return;
    const version = read().session.version, active = () => version === read().session.version;
    let firstPage = read().session.data.firstPage;
    try {
      if (!firstPage) {
        modal({ busy: true, status: "正在读取收藏夹第 1 页…", data: { ...read().session.data, link, linkDisabled: true } });
        const result = await adapter.invoke("read_public_favorite_page", { link, page: 1, existing: [] }); if (!active()) return;
        firstPage = result; modal({ busy: false, status: `收藏夹共 ${result.total} 条，可修改歌单名称后导入。${Array.from(result.title).length > 40 ? "标题较长，请确认缩短后的名称。" : ""}`, data: { ...read().session.data, firstPage: result, name: Array.from(result.title).slice(0, 40).join(""), nameVisible: true, focusName: (read().session.data.focusName ?? 0) + 1, primaryLabel: "开始导入" } }); return;
      }
      const validation = validateModalName(name); if (!validation.ok) return;
      const tracks: CommandContract.TrackSnapshotInput[] = []; let skipped = 0, duplicates = 0, scanned = 0, page = 1, result = firstPage;
      while (active()) {
        tracks.push(...result.items); skipped += result.skipped; duplicates += result.duplicates; scanned += result.scanned;
        if (!result.hasMore) break;
        modal({ busy: true, status: `已读取第 ${page} 页 · 已检查 ${scanned} 条 · 有效 ${tracks.length}/200 · 跳过 ${skipped} 条` }); page += 1;
        result = await adapter.invoke("read_public_favorite_page", { link, page, existing: tracks.map(t => t.bvid) });
      }
      if (!active()) return;
      if (!tracks.length) { modal({ busy: false, status: `没有可导入的视频，已跳过 ${skipped} 条，未创建歌单。` }); return; }
      modal({ busy: true, status: `正在保存 ${tracks.length} 条视频…` });
      const created = await adapter.invoke("create_imported_playlist", { name: validation.name, tracks });
      update({ playlists: [...read().playlists, created], selectedPlaylistId: created.id, ...(active() ? { session: finishedSession() } : read().session.version === version + 1 && !read().session.open ? { session: { ...read().session, busy: false } } : {}) }, { ...refreshFields(), playlistsStatus: `已创建“${created.name}”，导入 ${created.items.length} 条，跳过失效或无法导入 ${skipped} 条${duplicates ? `，去重 ${duplicates} 条` : ""}。${result.truncated ? "已达到 200 条上限，剩余内容未导入。" : ""}` });
    } catch (error) { if (active()) modal({ busy: false, status: `导入失败：${error}。未创建歌单，可重试。`, data: { ...read().session.data, ...(!firstPage ? { linkDisabled: false } : {}) } }); }
    finally { if (read().session.busy && (active() || read().session.version === version + 1 && !read().session.open)) modal({ busy: false }); }
  }
  async function showPurge(): Promise<void> {
    update({}, { purgeBusy: true }); let unavailable;
    try { unavailable = await adapter.invoke("list_unavailable_tracks"); }
    catch (error) { update({}, { purgeBusy: false, purgeStatus: `读取失效曲目失败：${error}` }); return; }
    update({ session: openedSession("purge", "清理失效曲目", "以下歌曲已无法播放，确认后会从收藏和所有歌单中移除。", { unavailable }) }, { purgeBusy: false });
  }
  async function submitPurge(onDisabledPages: Parameters<typeof load>[0] = () => {}): Promise<void> {
    const version = read().session.version; modal({ busy: true, status: "正在清理…" });
    try { const result = await adapter.invoke("purge_unavailable_tracks"); const fields = await readLibrary(onDisabledPages); update({ ...fields, session: finishedSession() }, { ...refreshFields(), purgeStatus: `已清理 ${result.clearedMarks} 首失效曲目。` }); }
    catch (error) { modal({ ...(read().session.version === version || !read().session.open ? { busy: false } : {}), status: `清理失效曲目失败：${error}` }); }
  }
  function startDrag(kind: LibraryDragKind, index: number, playlistId?: string): boolean {
    if (read().drags[kind].saving) return false;
    update({ drags: { ...read().drags, [kind]: { ...read().drags[kind], drag: { index, ...(playlistId === undefined ? {} : { playlistId }) } } } }); return true;
  }
  function finishDrag(kind: LibraryDragKind, now: number, save = false): void { update({ drags: { ...read().drags, [kind]: { ...read().drags[kind], drag: null, saving: save || read().drags[kind].saving, suppressClickUntil: now + 400 } } }); }
  function beginDragSave(kind: LibraryDragKind): boolean {
    if (read().drags[kind].saving) return false;
    update({ drags: { ...read().drags, [kind]: { ...read().drags[kind], saving: true } } }); return true;
  }
  function finishDragSave(kind: LibraryDragKind): void {
    if (!read().drags[kind].saving) return;
    update({ drags: { ...read().drags, [kind]: { ...read().drags[kind], saving: false } } }, refreshFields());
  }
  async function persistOrder(kind: LibraryDragKind, request: () => Promise<Partial<LibrarySnapshot>>): Promise<void> {
    try {
      const fields = await request();
      if (read().drags[kind].saving) update({ ...fields, drags: { ...read().drags, [kind]: { ...read().drags[kind], saving: false } } }, refreshFields());
      else update(fields);
    } catch (error) { finishDragSave(kind); throw error; }
  }
  function reorderFavorites(fromIndex: number, toIndex: number): Promise<void> { return persistOrder("favorites", async () => { const favorites = (await adapter.invoke("reorder_favorite", { fromIndex, toIndex })).map(normalizeTrack); return { favorites, favoriteBvids: new Set(favorites.map(t => t.bvid.toLowerCase())) }; }); }
  function reorderPlaylistItems(id: string, fromIndex: number, toIndex: number): Promise<void> { return persistOrder("playlistItems", async () => ({ playlists: await adapter.invoke("reorder_playlist_item", { id, fromIndex, toIndex }) })); }
  function reorderPlaylists(fromIndex: number, toIndex: number): Promise<void> { return persistOrder("playlists", async () => ({ playlists: await adapter.invoke("reorder_playlist", { fromIndex, toIndex }) })); }
  async function saveDisabledPages(bvid: string, cid: number | null, disabled = false): Promise<void> {
    const key = bvid.toLowerCase(); if (read().disabledPagePending.has(key)) return;
    const before = new Set(read().disabledPages.get(key) ?? []), after = new Set(before);
    if (cid === null) after.clear(); else if (disabled) after.add(cid); else after.delete(cid);
    const preferences = new Map(read().disabledPages), pending = new Map(read().disabledPagePending);
    if (after.size) preferences.set(key, after); else preferences.delete(key); pending.set(key, cid);
    commit({ ...read(), disabledPages: preferences, disabledPagePending: pending }, { bvid, error: "" });
    let errorText = "";
    try { if (cid === null) await adapter.invoke("clear_disabled_pages", { bvid }); else await adapter.invoke("set_page_disabled", { bvid, cid, disabled }); }
    catch (error) { errorText = `保存分P设置失败：${error}`; }
    const values = new Map(read().disabledPages), completed = new Map(read().disabledPagePending); completed.delete(key);
    if (errorText) { if (before.size) values.set(key, before); else values.delete(key); }
    commit({ ...read(), disabledPages: errorText ? values : read().disabledPages, disabledPagePending: completed }, { bvid, error: errorText || null });
  }
  return { changeDisabledPages: saveDisabledPages, beginDragSave, finishDrag, finishDragSave, startDrag, choosePlaylist, clearUnavailable, closeModal: close, createAndAdd, loadLibrary: load, markUnavailable, openModal: open, refreshViews: () => refresh(), removeTrack, reorderFavorites, reorderPlaylistItems, reorderPlaylists, setModalName: (name: string) => modalData({ name }), setModalLink: (link: string) => modalData({ link }), showChoose, showDelete, showImport, showName, showPurge, submitChoose, submitDelete, submitImport, submitName, submitPurge, toggleFavorite: toggle, validatePlaylistName: validateName };
}

export { createLibraryActions, initialLibraryState, isLibraryDragClickSuppressed };
export type { LibraryCommand, LibrarySnapshot };
