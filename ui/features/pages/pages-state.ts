import type { DeepReadonly } from "../../store/state-store.ts";
import { normalizeVideoPage } from "../../shared/track-utils.ts";

type PagesState = {
  videoPageCounts: Map<string, number>;
  videoPagesByBvid: Map<string, { videos: number; pages: CommandContract.VideoPage[] }>;
  queries: Map<string, { phase: "queued" | "active" | "failed"; changedAt: number }>;
  requestVersion: number;
  statusBeforeLoad: string | null;
  modal: { video: CommandContract.TrackSnapshotInput; videos: number; pages: CommandContract.VideoPage[]; error: string; version: number } | null;
  view: { badges: { bvid: string } | null; status: { text: string | null } | null };
};
type PagesSnapshot = DeepReadonly<PagesState>;
function initialPagesState(): PagesState { return { videoPageCounts: new Map(), videoPagesByBvid: new Map(), queries: new Map(), requestVersion: 0, statusBeforeLoad: null, modal: null, view: { badges: null, status: null } }; }
function pagesWithDisabledError(state: PagesSnapshot, bvid: string, error: string | null): PagesSnapshot {
  return state.modal?.video.bvid.toLowerCase() === bvid.toLowerCase() ? { ...state, modal: { ...state.modal, error: error ?? state.modal.error } } : state;
}
function createPagesActions(read: () => PagesSnapshot, commit: (next: PagesSnapshot) => void) {
  const update = (fields: Partial<PagesSnapshot>, view: Partial<PagesSnapshot["view"]> = {}) => commit({ ...read(), ...fields, view: Object.keys(view).length ? { ...read().view, ...view } : read().view });
  function metadata(bvid: string, value: Pick<CommandContract.VideoMeta, "videos" | "pages">) {
    const videos = Math.max(0, Math.round(Number(value?.videos) || 0));
    const pages = (Array.isArray(value?.pages) ? value.pages : []).map(normalizeVideoPage).filter(page => page.cid > 0);
    let videoPageCounts = read().videoPageCounts, videoPagesByBvid = read().videoPagesByBvid;
    if (videoPageCounts.get(bvid) !== videos) { const counts = new Map(videoPageCounts); counts.set(bvid, videos); videoPageCounts = counts; }
    if (videos >= 1 && pages.length) { const cache = new Map(videoPagesByBvid); cache.set(bvid, { videos, pages }); videoPagesByBvid = cache; }
    return { videos, pages, videoPageCounts, videoPagesByBvid };
  }
  function remember(bvid: string, value: Pick<CommandContract.VideoMeta, "videos" | "pages">) { const data = metadata(bvid, value); update({ videoPageCounts: data.videoPageCounts, videoPagesByBvid: data.videoPagesByBvid }, { badges: { bvid } }); return { videos: data.videos, pages: data.pages }; }
  function query(bvid: string, phase: "queued" | "active" | "failed" | null, now: number): void {
    const queries = new Map(read().queries); if (phase) queries.set(bvid, { phase, changedAt: now }); else if (queries.get(bvid)?.phase !== "failed") queries.delete(bvid); update({ queries });
  }
  function dropQueued(bvid: string, now: number): void { if (read().queries.get(bvid)?.phase === "queued") query(bvid, null, now); }
  function finishLookup(bvid: string, value: Pick<CommandContract.VideoMeta, "videos" | "pages"> | null, now: number): void {
    const queries = new Map(read().queries); if (value) queries.delete(bvid); else queries.set(bvid, { phase: "failed", changedAt: now });
    const data = value ? metadata(bvid, value) : null;
    update({ queries, ...(data ? { videoPageCounts: data.videoPageCounts, videoPagesByBvid: data.videoPagesByBvid } : {}) }, data ? { badges: { bvid } } : {});
  }
  function open(video: CommandContract.TrackSnapshotInput, videos: number, pages: readonly CommandContract.VideoPage[]): void {
    update({ modal: { video: { ...video }, videos, pages: pages.map(page => ({ ...page })), error: "", version: (read().modal?.version ?? 0) + 1 } });
  }
  function beginModalQuery(capturedStatus: string | null): number {
    const requestVersion = read().requestVersion + 1;
    update({ requestVersion, statusBeforeLoad: read().statusBeforeLoad === null ? capturedStatus : read().statusBeforeLoad }, { status: { text: "正在获取分P信息…" } }); return requestVersion;
  }
  function finishModalQuery(version: number, video: CommandContract.TrackSnapshotInput, value: Pick<CommandContract.VideoMeta, "videos" | "pages"> | null): void {
    if (version !== read().requestVersion) return;
    if (!value) { update({ statusBeforeLoad: null }, { status: { text: "获取分P信息失败" } }); return; }
    const data = metadata(video.bvid, value);
    update({ videoPageCounts: data.videoPageCounts, videoPagesByBvid: data.videoPagesByBvid, statusBeforeLoad: null,
      ...(data.videos > 1 ? { modal: { video: { ...video }, videos: data.videos, pages: data.pages, error: "", version: (read().modal?.version ?? 0) + 1 } } : {}),
    }, { badges: { bvid: video.bvid }, status: { text: data.videos <= 1 ? "该视频只有一个分P" : read().statusBeforeLoad } });
  }
  function showSinglePage(): void { update({}, { status: { text: "该视频只有一个分P" } }); }
  function close(): void { update({ modal: null }); }
  return { remember, query, dropQueued, finishLookup, open, beginModalQuery, finishModalQuery, showSinglePage, close };
}
export { createPagesActions, initialPagesState, pagesWithDisabledError };
export type { PagesSnapshot };