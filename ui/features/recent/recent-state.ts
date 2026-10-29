import type { DeepReadonly } from "../../store/state-store.ts";

type RecentState = {
  items: CommandContract.PlayHistoryItem[]; cached: ReadonlySet<string>; online: boolean;
  now: number; loading: boolean; error: string;
};
type RecentSnapshot = DeepReadonly<RecentState>;
type RecentAdapter = { invoke: <K extends "get_play_history" | "check_audio_cache">(command: K, ...args: CommandArguments<K>) => Promise<CommandMap[K]["result"]> };

function initialRecentState(): RecentState { return { items: [], cached: new Set(), online: true, now: 0, loading: false, error: "" }; }
function recentItems(items: readonly CommandContract.PlayHistoryItem[]): CommandContract.PlayHistoryItem[] {
  const seen = new Set<string>();
  return [...items].sort((a, b) => Number(b.lastPlayedAt) - Number(a.lastPlayedAt)).filter(item => {
    const key = item.bvid.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 200);
}
function formatPlayedAt(timestamp: string, now: Date): string {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return "—";
  const pad = (value: number) => String(value).padStart(2, "0");
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, now)) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  return sameDay(date, yesterday) ? "昨天" : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function recentPage(item: Readonly<CommandContract.PlayHistoryItem> | undefined): CommandContract.VideoPage | null {
  return item?.lastCid && Number.isSafeInteger(item.lastCid) && item.lastCid > 0
    ? { cid: item.lastCid, page: item.lastPage || 1, part: item.lastPartName || item.title, durationSeconds: item.durationSeconds } : null;
}
function createRecentActions(read: () => RecentSnapshot, commit: (next: RecentSnapshot) => void, adapter: RecentAdapter) {
  let loadVersion = 0, cacheVersion = 0;
  const update = (fields: Partial<RecentSnapshot>) => commit({ ...read(), ...fields });
  async function refreshCache(quality: CommandContract.AudioQuality): Promise<void> {
    const version = ++cacheVersion, items = read().items;
    update({ cached: new Set() });
    const tracks = items.flatMap(item => item.lastCid ? [{ bvid: item.bvid, cid: item.lastCid }] : []);
    if (!tracks.length) return;
    try {
      const hits = await adapter.invoke("check_audio_cache", { tracks, quality });
      if (version !== cacheVersion || items !== read().items) return;
      update({ cached: new Set(tracks.filter((_, i) => hits[i] === true).map(track => track.bvid.toLowerCase())) });
    } catch { /* 查询失败时不声称可离线播放。 */ }
  }
  async function load(quality: () => CommandContract.AudioQuality, now: number): Promise<void> {
    const version = ++loadVersion; ++cacheVersion;
    update({ now, loading: true, error: "", cached: new Set() });
    try {
      const items = recentItems(await adapter.invoke("get_play_history"));
      if (version !== loadVersion) return;
      update({ items, loading: false });
      await refreshCache(quality());
    } catch {
      if (version === loadVersion) update({ loading: false, error: "播放记录读取失败，请重新进入页面重试。" });
    }
  }
  function connectivity(online: boolean): void { if (read().online !== online) update({ online }); }
  return { load, refreshCache, connectivity };
}
export { initialRecentState, createRecentActions, recentItems, formatPlayedAt, recentPage };
export type { RecentSnapshot };
