import type { PlaybackQueueSnapshot } from "./playback-queue-state.ts";

type QueueDrawerStage = Readonly<{ hidden: boolean; open: boolean; opening?: true; confirming?: true }>;
type Entry = PlaybackQueueSnapshot["queue"][number];
type QueueDrawerRow = Readonly<{ id: number; entry: Entry; active: boolean; memberIndex?: number }>;
function sameDisplay(a: Entry, b: Entry): boolean {
  if (a === b) return true;
  if (a.bvid !== b.bvid || a.entryId !== b.entryId || a.title !== b.title || a.uploader !== b.uploader ||
      a.thumbnailUrl !== b.thumbnailUrl || a.durationSeconds !== b.durationSeconds) return false;
  const x = a.collection, y = b.collection;
  return x === y || (!!x && !!y && x.data.title === y.data.title && x.data.videoCount === y.data.videoCount &&
    x.memberIndex === y.memberIndex && x.historyTrack?.bvid === y.historyTrack?.bvid &&
    x.historyTrack?.title === y.historyTrack?.title && x.data.snapshot.items === y.data.snapshot.items);
}
function createQueueDrawerProjection() {
  let previous: PlaybackQueueSnapshot | undefined, nextId = 0;
  let model: { rows: readonly QueueDrawerRow[]; stage: QueueDrawerStage; count: number; hasCurrent: boolean; shuffle: boolean };
  return (queue: PlaybackQueueSnapshot, stage: QueueDrawerStage) => {
    if (previous?.queue === queue.queue && previous.currentIndex === queue.currentIndex) {
      if (model.stage !== stage || model.shuffle !== queue.shuffle) model = { ...model, stage, shuffle: queue.shuffle };
      return model;
    }
    if (previous?.queue === queue.queue) {
      const rows = model.rows.slice();
      for (const i of [previous.currentIndex, queue.currentIndex]) {
        if (rows[i]) rows[i] = { ...rows[i], active: i === queue.currentIndex };
      }
      previous = queue;
      return model = { ...model, rows, stage, shuffle: queue.shuffle, hasCurrent: queue.currentIndex >= 0 };
    }
    const old = model?.rows ?? [], byEntry = new Map<Entry, QueueDrawerRow>();
    previous?.queue.forEach((entry, index) => { if (!byEntry.has(entry)) byEntry.set(entry, old[index]); });
    const claimed = new Set<number>(), seen = new Set<Entry>();
    const matches = queue.queue.map(entry => {
      if (seen.has(entry)) return null; // Repeated references represent separate occurrences.
      seen.add(entry);
      const row = byEntry.get(entry);
      if (row) claimed.add(row.id);
      return row;
    });
    const rows = queue.queue.map((entry, i) => {
      let match = matches[i];
      const peer = old[i];
      if (match === undefined && peer && !claimed.has(peer.id) && (entry.entryId && peer.entry.entryId
        ? entry.entryId === peer.entry.entryId : entry.bvid.toLowerCase() === peer.entry.bvid.toLowerCase())) match = peer;
      const active = i === queue.currentIndex;
      if (match && match.active === active && sameDisplay(match.entry, entry)) return match;
      const group = entry.collection;
      const memberIndex = group?.historyTrack ? group.data.snapshot.items.findIndex(member => member.bvid === group.historyTrack?.bvid) : group?.memberIndex;
      return { id: match?.id ?? ++nextId, entry, active, memberIndex };
    });
    previous = queue;
    return model = { rows, stage, count: rows.length, shuffle: queue.shuffle, hasCurrent: queue.currentIndex >= 0 };
  };
}
export { createQueueDrawerProjection };
export type { QueueDrawerStage, QueueDrawerRow };
export type QueueDrawerView = ReturnType<ReturnType<typeof createQueueDrawerProjection>>;
