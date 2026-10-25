import { shallowReactive } from "vue";
import { TRACK_COLUMNS_KEY, TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, parseTrackColumnWidths, resizeTrackColumn } from "../features/tracks/track-column-state.ts";
import type { TrackColumn } from "../features/tracks/track-column-state.ts";

const trackColumnWidths = shallowReactive({ ...TRACK_COLUMN_DEFAULTS });
const trackColumnDrag = shallowReactive<{ column: TrackColumn | null }>({ column: null });
let drag: { id: number; x: number; width: number; column: TrackColumn; header: HTMLElement } | null = null;
let lastPress: { header: HTMLElement; column: TrackColumn; time: number; x: number; y: number } | null = null;
function applyWidths(): void {
  for (const column of Object.keys(TRACK_COLUMN_LIMITS) as TrackColumn[]) document.documentElement.style.setProperty(`--track-${column}-width`, `${trackColumnWidths[column]}px`);
}
function initializeTrackColumns(): void {
  try { Object.assign(trackColumnWidths, parseTrackColumnWidths(localStorage.getItem(TRACK_COLUMNS_KEY))); }
  catch { Object.assign(trackColumnWidths, TRACK_COLUMN_DEFAULTS); }
  applyWidths();
}
function saveWidths(): void {
  try { localStorage.setItem(TRACK_COLUMNS_KEY, JSON.stringify(trackColumnWidths)); }
  catch (error) { console.warn("track column preference save failed:", error); }
}
function handleColumn(event: Event): TrackColumn | null {
  if (!(event.target instanceof Element)) return null;
  const handle = event.target.closest<HTMLElement>("[data-track-column]"), header = event.currentTarget;
  const column = handle?.dataset.trackColumn;
  return header instanceof HTMLElement && handle && header.contains(handle) && column && Object.hasOwn(TRACK_COLUMN_LIMITS, column) ? column as TrackColumn : null;
}
function resize(column: TrackColumn, width: number): void {
  trackColumnWidths[column] = resizeTrackColumn(column, width); applyWidths();
}
function move(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return;
  if (lastPress && (Math.abs(event.clientX - lastPress.x) > 3 || Math.abs(event.clientY - lastPress.y) > 3)) lastPress = null;
  resize(drag.column, drag.width + drag.x - event.clientX);
}
function finish(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return;
  const current = drag; drag = null;
  trackColumnDrag.column = null;
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointerup", finish);
  window.removeEventListener("pointercancel", finish);
  window.removeEventListener("lostpointercapture", finish);
  if (current.header.hasPointerCapture(current.id)) current.header.releasePointerCapture(current.id);
  saveWidths();
}
const trackColumnCallbacks = Object.freeze({
  pointerdown(event: PointerEvent): void {
    const column = handleColumn(event);
    if (!column || event.button !== 0 || !event.isPrimary || drag) return;
    const header = event.currentTarget as HTMLElement;
    // PointerEvent.detail is zero in browsers; count stationary presses at this delegated port.
    if (lastPress?.header === header && lastPress.column === column && event.timeStamp - lastPress.time <= 400 && Math.abs(event.clientX - lastPress.x) <= 3 && Math.abs(event.clientY - lastPress.y) <= 3) {
      lastPress = null; resize(column, TRACK_COLUMN_DEFAULTS[column]); saveWidths(); return;
    }
    lastPress = { header, column, time: event.timeStamp, x: event.clientX, y: event.clientY };
    header.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, width: trackColumnWidths[column], column, header };
    trackColumnDrag.column = column;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("lostpointercapture", finish);
  },
  keydown(event: KeyboardEvent): void {
    const column = handleColumn(event);
    if (!column || drag || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); resize(column, trackColumnWidths[column] + (event.key === "ArrowRight" ? 8 : -8)); saveWidths();
  },
});
export { initializeTrackColumns, trackColumnWidths, trackColumnDrag, trackColumnCallbacks };
