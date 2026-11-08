import { readApplicationStore } from "../../store/application-store.ts";
import { readShellStages } from "../../app/shell-stages.ts";
import { refreshPresentation } from "../../app/presentation-refresh.ts";
import { queueDrawerRefs } from "../../platform/main-window-refs.ts";
import type { QueueDrawerStage, QueueDrawerView } from "./queue-drawer-view.ts";

let stage: QueueDrawerStage = { hidden: true, open: false }, frame = 0;
let play: ((index: number) => void) | undefined;
let lastIdentity = "";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function close(): void {
  cancelAnimationFrame(frame); frame = 0;
  const wasOpen = stage.open;
  document.removeEventListener("keydown", keydown, true);
  stage = { hidden: !wasOpen || reducedMotion(), open: false }; refreshPresentation();
  queueDrawerRefs.button?.focus({ preventScroll: true });
}
function keydown(event: KeyboardEvent): void {
  const modals = readShellStages();
  if (event.key !== "Escape" || !modals.settings.hidden || !modals.library.hidden || !modals.pages.hidden) return;
  event.preventDefault(); event.stopPropagation(); close();
}
function toggle(): void {
  if (!stage.hidden && (stage.open || frame !== 0)) { close(); return; }
  if (!readApplicationStore().getState().playbackQueue.queue.length) return;
  cancelAnimationFrame(frame);
  stage = { hidden: false, open: false }; refreshPresentation();
  document.addEventListener("keydown", keydown, true);
  frame = requestAnimationFrame(() => {
    frame = 0; stage = { hidden: false, open: true }; lastIdentity = ""; refreshPresentation();
    queueDrawerRefs.close?.focus({ preventScroll: true });
  });
}
function transition(event: TransitionEvent): void {
  if (event.target !== queueDrawerRefs.drawer || event.propertyName !== "transform" || stage.open) return;
  stage = { hidden: true, open: false }; refreshPresentation();
}
function syncQueueDrawer(view: QueueDrawerView): void {
  if (!stage.open) return;
  const current = view.rows.find(row => row.active);
  const identity = current ? `${current.index}:${current.entry.entryId ?? current.entry.bvid}:${current.entry.collection?.memberIndex ?? ""}:${current.entry.collection?.historyTrack?.bvid ?? current.entry.collection?.data.snapshot.items[current.entry.collection.memberIndex]?.bvid ?? ""}` : "";
  if (identity === lastIdentity) return;
  lastIdentity = identity;
  queueDrawerRefs.list?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
}
function dispose(): void { cancelAnimationFrame(frame); frame = 0; document.removeEventListener("keydown", keydown, true); stage = { hidden: true, open: false }; lastIdentity = ""; }
const queueDrawerCallbacks = Object.freeze({ toggle, close, transition, dispose, choose(index: number) {
  if (index !== readApplicationStore().getState().playbackQueue.currentIndex) play?.(index);
} });
function installQueueDrawerPlayback(handler: (index: number) => void): void { play = handler; }
function readQueueDrawerStage(): QueueDrawerStage { return stage; }
export { queueDrawerCallbacks, installQueueDrawerPlayback, readQueueDrawerStage, syncQueueDrawer };
