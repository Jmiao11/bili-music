import type { PlaybackQueueSnapshot } from "./playback-queue-state.ts";

type QueueDrawerStage = Readonly<{ hidden: boolean; open: boolean }>;
type QueueDrawerRow = Readonly<{ index: number; entry: PlaybackQueueSnapshot["queue"][number]; active: boolean }>;
function createQueueDrawerProjection() {
  let previous: PlaybackQueueSnapshot | undefined, projectionStage: QueueDrawerStage | undefined;
  let model: { rows: readonly QueueDrawerRow[]; stage: QueueDrawerStage; count: number };
  return (queue: PlaybackQueueSnapshot, nextStage: QueueDrawerStage) => {
    if (previous?.queue === queue.queue && previous.currentIndex === queue.currentIndex && projectionStage === nextStage) return model;
    const rows = queue.queue.map((entry, index) => {
      const active = index === queue.currentIndex, old = model?.rows[index];
      return old?.entry === entry && old.active === active ? old : { index, entry, active };
    });
    previous = queue; projectionStage = nextStage;
    return model = { rows, stage: nextStage, count: queue.queue.length };
  };
}
export { createQueueDrawerProjection };
export type { QueueDrawerStage, QueueDrawerRow };
export type QueueDrawerView = ReturnType<ReturnType<typeof createQueueDrawerProjection>>;
