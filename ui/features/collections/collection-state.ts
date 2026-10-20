import type { DeepReadonly } from "../../store/state-store.ts";
import { normalizeTrack } from "../../shared/track-utils.ts";
import { completeCollection } from "../library/library-entry.ts";

type VideoListSource = { kind: "collection"; bvid: string; id: number } | { kind: "uploader"; mid: number };
type CollectionReference = { entryId: string; playlistId: string | null };
type FullCollection = DeepReadonly<CommandContract.LibraryCollection>;
type CollectionState = {
  source: VideoListSource | null; reference: CollectionReference | null; fullSnapshot: FullCollection | null; usingSnapshot: boolean;
  active: boolean; title: string; total: number; items: ReturnType<typeof normalizeTrack>[];
  page: number; hasMore: boolean; loading: boolean; error: string; requestVersion: number;
  previousView: string; previousScroll: number;
  prompt: { bvid: string; summary: CommandContract.CollectionSummary } | null;
};
type CollectionSnapshot = DeepReadonly<CollectionState>;
type CollectionAdapter = { invoke: <K extends "get_collection_page">(command: K, ...args: CommandArguments<K>) => Promise<CommandMap[K]["result"]> };
type PersistSnapshot = (reference: CollectionReference, collection: FullCollection) => Promise<boolean>;
function initialCollectionState(): CollectionState {
  return { source: null, reference: null, fullSnapshot: null, usingSnapshot: false, active: false, title: "", total: 0, items: [], page: 0, hasMore: false, loading: false, error: "", requestVersion: 0, previousView: "home", previousScroll: 0, prompt: null };
}
function createCollectionActions(read: () => CollectionSnapshot, commit: (next: CollectionSnapshot) => void, adapter: CollectionAdapter, persist?: PersistSnapshot) {
  const update = (fields: Partial<CollectionSnapshot>) => commit({ ...read(), ...fields });
  const pending = new Map<number, Promise<CommandContract.CollectionPage>>();
  const current = (version: number) => version === read().requestVersion && read().active;
  function firstPage(source: Extract<VideoListSource, { kind: "collection" }>) {
    const existing = pending.get(source.id); if (existing) return existing;
    const request = adapter.invoke("get_collection_page", { bvid: source.bvid, collectionId: source.id, page: 1, refresh: true })
      .finally(() => { if (pending.get(source.id) === request) pending.delete(source.id); });
    pending.set(source.id, request); return request;
  }
  function setPrompt(bvid: string, summary: CommandContract.CollectionSummary | null): void {
    if (!summary && !read().prompt) return;
    update({ prompt: summary && summary.total > 1 ? { bvid, summary } : null });
  }
  async function resolveForPlayback(fallback: FullCollection, reference: CollectionReference | null, stillCurrent: () => boolean) {
    try {
      const result = await firstPage({ kind: "collection", bvid: fallback.anchorBvid, id: fallback.collectionId });
      if (!stillCurrent()) return null;
      const snapshot = result.snapshot;
      if (!snapshot || !completeCollection(snapshot, fallback.collectionId)) throw Error("合集详情未返回完整且匹配的列表");
      if (reference && persist) await persist(reference, snapshot);
      return stillCurrent() ? { snapshot, notice: "" } : null;
    } catch (error) {
      if (!stillCurrent()) return null;
      if (!completeCollection(fallback, fallback.collectionId)) throw Error("合集没有可用的完整快照");
      return { snapshot: fallback, notice: `${fallback.sourceStatus === "invalid" ? "合集来源已失效" : "来源无法校验"}，使用本地快照。${String(error)}` };
    }
  }
  function open(source: VideoListSource, title: string, total: number, previousView: string, previousScroll: number, fallback: FullCollection | null = null, reference: CollectionReference | null = null): void {
    update({ source, reference, fullSnapshot: fallback, usingSnapshot: !!fallback, title, total, active: true,
      items: fallback ? fallback.snapshot.items.slice(0, 20).map(normalizeTrack) : [], page: fallback ? 1 : 0,
      hasMore: fallback ? fallback.videoCount > 20 : true, loading: false, error: "", previousView, previousScroll, prompt: null, requestVersion: read().requestVersion + 1 });
    void refresh(false);
  }
  function close(): void { update({ active: false, source: null, reference: null, prompt: null, requestVersion: read().requestVersion + 1 }); }
  async function refresh(advanceVersion = true): Promise<void> {
    const state = read(); if (!state.active || state.source?.kind !== "collection") return;
    const version = state.requestVersion + (advanceVersion ? 1 : 0);
    update({ requestVersion: version, loading: true, error: "" });
    try {
      const result = await firstPage(state.source); if (!current(version)) return;
      const snapshot = result.snapshot ?? null;
      if (!snapshot && (state.fullSnapshot || state.reference)) throw Error("合集详情未返回完整且匹配的列表");
      if (snapshot && !completeCollection(snapshot, state.source.id)) throw Error("合集详情未返回完整且匹配的列表");
      if (snapshot && state.reference && persist) {
        const saved = await persist(state.reference, snapshot); if (!current(version)) return;
        if (!saved) { update({ loading: false, error: "原合集条目已移除，未替换快照。" }); return; }
      }
      const items = (snapshot ? snapshot.snapshot.items.slice(0, 20) : result.items).map(normalizeTrack);
      update({ fullSnapshot: snapshot, usingSnapshot: false, title: snapshot?.title ?? state.title, items, page: 1,
        total: snapshot?.videoCount ?? result.total, hasMore: snapshot ? snapshot.videoCount > items.length : result.hasMore && items.length > 0, loading: false });
    } catch (error) {
      if (!current(version)) return;
      const snapshot = read().fullSnapshot;
      update({ loading: false, usingSnapshot: !!snapshot,
        error: snapshot ? `${snapshot.sourceStatus === "invalid" ? "合集来源已失效" : "来源无法校验"}，使用本地快照。${String(error)}` : `合集加载失败：${String(error)}` });
    }
  }
  async function loadNextPage(beforeCommit?: (items: readonly CommandContract.SearchVideo[], version: number) => void): Promise<void> {
    const state = read(); if (!state.active || state.source?.kind !== "collection" || !state.hasMore || state.loading) return;
    const page = state.page + 1, version = state.requestVersion; update({ loading: true, ...(state.usingSnapshot ? {} : { error: "" }) });
    try {
      const result = state.fullSnapshot
        ? { items: state.fullSnapshot.snapshot.items.slice((page - 1) * 20, page * 20).map(normalizeTrack), total: state.fullSnapshot.videoCount, hasMore: page * 20 < state.fullSnapshot.videoCount }
        : await adapter.invoke("get_collection_page", { bvid: state.source.bvid, collectionId: state.source.id, page });
      if (!current(version)) return;
      const known = new Set(read().items.map(item => item.bvid.toLowerCase()));
      const unique = result.items.filter(item => { const key = item.bvid.toLowerCase(); if (!key || known.has(key)) return false; known.add(key); return true; });
      beforeCommit?.(unique, version);
      update({ items: [...read().items, ...unique.map(normalizeTrack)], page, total: result.total, hasMore: result.hasMore && unique.length > 0, loading: false });
    } catch (error) { if (current(version)) update({ loading: false, error: `合集加载失败：${String(error)}` }); }
  }
  function retry(): Promise<void> { return read().page && !read().usingSnapshot ? loadNextPage() : refresh(); }
  function chooseAnchor(bvid: string): void {
    const state = read(); if (state.loading || state.source?.kind !== "collection" || !state.fullSnapshot?.snapshot.items.some(item => item.bvid === bvid)) return;
    update({ source: { ...state.source, bvid } }); void refresh();
  }
  return { setPrompt, open, close, loadNextPage, refresh, retry, chooseAnchor, resolveForPlayback };
}
export { createCollectionActions, initialCollectionState };
export type { CollectionSnapshot, VideoListSource, CollectionReference };
