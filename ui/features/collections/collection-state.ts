import type { DeepReadonly } from "../../store/state-store.ts";
import { normalizeTrack } from "../../shared/track-utils.ts";

type VideoListSource = { kind: "collection"; bvid: string; id: number } | { kind: "uploader"; mid: number };
type CollectionState = {
  source: VideoListSource | null;
  active: boolean; title: string; total: number; items: ReturnType<typeof normalizeTrack>[];
  page: number; hasMore: boolean; loading: boolean; error: string; requestVersion: number;
  previousView: string; previousScroll: number;
  prompt: { bvid: string; summary: CommandContract.CollectionSummary } | null;
};
type CollectionSnapshot = DeepReadonly<CollectionState>;
type CollectionAdapter = { invoke: <K extends "get_collection_page">(command: K, ...args: CommandArguments<K>) => Promise<CommandMap[K]["result"]> };

function initialCollectionState(): CollectionState {
  return { source: null, active: false, title: "", total: 0, items: [], page: 0, hasMore: false, loading: false, error: "", requestVersion: 0, previousView: "home", previousScroll: 0, prompt: null };
}

function createCollectionActions(read: () => CollectionSnapshot, commit: (next: CollectionSnapshot) => void, adapter: CollectionAdapter) {
  const update = (fields: Partial<CollectionSnapshot>) => commit({ ...read(), ...fields });
  function setPrompt(bvid: string, summary: CommandContract.CollectionSummary | null): void {
    if (!summary && !read().prompt) return;
    update({ prompt: summary && summary.total > 1 ? { bvid, summary } : null });
  }
  function open(source: VideoListSource, title: string, total: number, previousView: string, previousScroll: number): void {
    update({ source, title, total, active: true, items: [], page: 0, hasMore: true, loading: false, error: "", previousView, previousScroll, prompt: null, requestVersion: read().requestVersion + 1 });
    void loadNextPage();
  }
  function close(): void { update({ active: false, source: null, prompt: null, requestVersion: read().requestVersion + 1 }); }
  async function loadNextPage(beforeCommit?: (items: readonly CommandContract.SearchVideo[], version: number) => void): Promise<void> {
    const state = read();
    if (!state.active || !state.source || !state.hasMore || state.loading) return;
    if (state.source.kind !== "collection") return;
    const page = state.page + 1, version = state.requestVersion;
    update({ loading: true, error: "" });
    try {
      const result = await adapter.invoke("get_collection_page", { bvid: state.source.bvid, collectionId: state.source.id, page });
      if (version !== read().requestVersion || !read().active) return;
      const known = new Set(read().items.map(item => item.bvid));
      const unique = result.items.filter(item => {
        if (!item.bvid || known.has(item.bvid)) return false;
        known.add(item.bvid); return true;
      });
      beforeCommit?.(unique, version);
      const items = unique.map(normalizeTrack);
      update({ items: [...read().items, ...items], page, total: result.total, hasMore: result.hasMore && items.length > 0, loading: false });
    } catch (error) {
      if (version !== read().requestVersion || !read().active) return;
      update({ loading: false, error: `合集加载失败：${String(error)}` });
    }
  }
  return { setPrompt, open, close, loadNextPage };
}

export { createCollectionActions, initialCollectionState };
export type { CollectionSnapshot, VideoListSource };
