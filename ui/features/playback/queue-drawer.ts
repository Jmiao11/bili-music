import { readApplicationStore } from "../../store/application-store.ts";
import { readShellStages } from "../../app/shell-stages.ts";
import { refreshPresentation } from "../../app/presentation-refresh.ts";
import { queueDrawerRefs, resumePlayPauseButton } from "../../platform/main-window-refs.ts";
import { trapFocus } from "../../shared/focus-trap.ts";
import type { QueueDrawerStage, QueueDrawerView } from "./queue-drawer-view.ts";

let stage: QueueDrawerStage = { hidden: true, open: false }, frame = 0;
let play: ((index: number) => void) | undefined;
let removeEntry: ((index: number) => void) | undefined;
let clearQueue: (() => void) | undefined;
let saveOrder: (() => void) | undefined;
let lastIdentity = "";
let centerOnOpen = false;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function close(): void {
  cancelAnimationFrame(frame); frame = 0;
  const wasOpen = stage.open;
  document.removeEventListener("keydown", keydown, true);
  stage = { hidden: !wasOpen || reducedMotion(), open: false }; refreshPresentation();
  const button = queueDrawerRefs.button;
  (button?.disabled ? resumePlayPauseButton : button)?.focus({ preventScroll: true });
}
function openClear(): void {
  if (!stage.open || !readApplicationStore().getState().playbackQueue.queue.length) return;
  stage = { ...stage, confirming: true }; refreshPresentation();
  queueDrawerRefs.confirm?.querySelector<HTMLButtonElement>(".queue-clear-cancel")?.focus({ preventScroll: true });
}
function dismissClear(): void {
  stage = { hidden: false, open: true }; refreshPresentation();
  const button = queueDrawerRefs.clear;
  (button?.disabled ? queueDrawerRefs.close : button)?.focus({ preventScroll: true });
}
function confirmClear(): void {
  if (!stage.confirming) return;
  clearQueue?.();
  dismissClear();
}
function keydown(event: KeyboardEvent): void {
  const modals = readShellStages();
  const display = readApplicationStore().getState().playbackDisplay;
  if (!display.presentation.immersiveHidden || display.audioQualityMenu || !modals.settings.hidden || !modals.library.hidden || !modals.pages.hidden) return;
  if (stage.confirming && queueDrawerRefs.confirm) trapFocus(event, queueDrawerRefs.confirm);
  if (event.key !== "Escape") return;
  event.preventDefault(); event.stopPropagation();
  if (stage.confirming) dismissClear(); else close();
}
function toggle(): void {
  if (!stage.hidden && (stage.open || frame !== 0)) { close(); return; }
  if (!readApplicationStore().getState().playbackQueue.queue.length) return;
  cancelAnimationFrame(frame);
  stage = { hidden: false, open: false, opening: true }; refreshPresentation();
  document.addEventListener("keydown", keydown, true);
  frame = requestAnimationFrame(() => {
    frame = 0; stage = { hidden: false, open: true }; lastIdentity = ""; centerOnOpen = true; refreshPresentation();
    queueDrawerRefs.close?.focus({ preventScroll: true });
  });
}
function transition(event: TransitionEvent): void {
  if (event.target !== queueDrawerRefs.drawer || event.propertyName !== "transform") return;
  if (stage.open) return;
  stage = { hidden: true, open: false }; refreshPresentation();
}
function syncQueueDrawer(view: QueueDrawerView): void {
  if (!stage.open) return;
  const block = centerOnOpen ? "center" : "nearest"; centerOnOpen = false;
  const current = view.rows.find(row => row.active);
  const identity = current ? `${current.id}:${current.entry.collection?.memberIndex ?? ""}:${current.entry.collection?.historyTrack?.bvid ?? current.entry.collection?.data.snapshot.items[current.entry.collection.memberIndex]?.bvid ?? ""}` : "";
  if (identity === lastIdentity) return;
  lastIdentity = identity;
  queueDrawerRefs.list?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block, behavior: reducedMotion() ? "auto" : "smooth" });
}
function dispose(): void { cancelAnimationFrame(frame); frame = 0; document.removeEventListener("keydown", keydown, true); stage = { hidden: true, open: false }; lastIdentity = ""; centerOnOpen = false; }
const queueDrawerCallbacks = Object.freeze({ toggle, close, transition, dispose, openClear, dismissClear, confirmClear, move(from: number, to: number) {
  if (readApplicationStore().actions.playbackQueue.moveParent(from, to)) saveOrder?.();
}, remove(index: number) {
  const list = queueDrawerRefs.list;
  const row = list?.children[index];
  const restore = row?.contains(document.activeElement);
  const removedCurrent = readApplicationStore().getState().playbackQueue.currentIndex === index;
  removeEntry?.(index);
  if (!restore || row?.isConnected) return;
  const current = readApplicationStore().getState().playbackQueue.currentIndex;
  const position = removedCurrent && current >= 0 ? current : index;
  const next = list?.children[position] ?? list?.children[position - 1];
  const remove = next?.querySelector<HTMLButtonElement>(".queue-parent:not(.is-current) .queue-remove");
  const target = remove ?? next?.querySelector<HTMLButtonElement>(".queue-track") ?? queueDrawerRefs.close;
  // Focusing the play button reveals the sibling remove button for keyboard navigation.
  if (target?.matches(".queue-remove")) next?.querySelector<HTMLButtonElement>(".queue-track")?.focus({ preventScroll: true });
  target?.focus({ preventScroll: true });
  if (target && list && next) {
    const bounds = list.getBoundingClientRect(), item = target.getBoundingClientRect();
    if (item.top < bounds.top || item.bottom > bounds.bottom) target.scrollIntoView({ block: "nearest" });
  }
}, choose(index: number) {
  if (index !== readApplicationStore().getState().playbackQueue.currentIndex) play?.(index);
} });
function installQueueDrawerPlayback(handler: (index: number) => void, remove: (index: number) => void, clear: () => void, save: () => void): void { saveOrder = save; play = handler; removeEntry = remove; clearQueue = clear; }
function readQueueDrawerStage(): QueueDrawerStage { return stage; }
export { queueDrawerCallbacks, installQueueDrawerPlayback, readQueueDrawerStage, syncQueueDrawer };
