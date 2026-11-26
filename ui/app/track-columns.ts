import { shallowReactive } from "vue";
import { TRACK_COLUMNS_KEY, TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, parseTrackColumnWidths, resizeTrackColumn } from "../features/tracks/track-column-state.ts";
import type { ResizableTrackColumn } from "../features/tracks/track-column-state.ts";

const trackColumnWidths = shallowReactive({ ...TRACK_COLUMN_DEFAULTS });
const trackColumnDrag = shallowReactive<{ column: ResizableTrackColumn | null }>({ column: null });
type ColumnTarget = { column: ResizableTrackColumn; header: HTMLElement; cell: HTMLElement; minimum: number };
let drag: (ColumnTarget & { id: number; x: number; width: number; preferred: number }) | null = null;
let lastPress: { header: HTMLElement; column: ResizableTrackColumn; time: number; x: number; y: number } | null = null;
function applyWidth(column: ResizableTrackColumn): void {
  const widths = trackColumnWidths;
  document.documentElement.style.setProperty(`--track-${column}-width`, `${widths[column]}px`);
}
function initializeTrackColumns(): void {
  try { Object.assign(trackColumnWidths, parseTrackColumnWidths(localStorage.getItem(TRACK_COLUMNS_KEY))); }
  catch { Object.assign(trackColumnWidths, TRACK_COLUMN_DEFAULTS); }
  for (const column of ["uploader", "pages", "plays", "duration"] as const) applyWidth(column);
}
function saveWidths(): void {
  try { localStorage.setItem(TRACK_COLUMNS_KEY, JSON.stringify(trackColumnWidths)); }
  catch (error) { console.warn("track column preference save failed:", error); }
}
function handleColumn(event: Event): ColumnTarget | null {
  if (!(event.target instanceof Element)) return null;
  const handle = event.target.closest<HTMLElement>("[data-track-column]"), header = event.currentTarget;
  const column = handle?.dataset.trackColumn;
  if (!(header instanceof HTMLElement) || !handle?.parentElement || !header.contains(handle) || !column || column === "title" || !Object.hasOwn(TRACK_COLUMN_LIMITS, column)) return null;
  return { column: column as ResizableTrackColumn, header, cell: handle.parentElement, minimum: Number(handle.getAttribute("aria-valuemin")) };
}
function resize(column: ResizableTrackColumn, width: number, minimum: number): void {
  trackColumnWidths[column] = Math.max(minimum, resizeTrackColumn(column, width));
  applyWidth(column);
}
function saveFittedWidth({ column, cell, minimum }: ColumnTarget): void {
  const visibleWidth = cell.getBoundingClientRect().width;
  if (visibleWidth && visibleWidth < trackColumnWidths[column]) resize(column, visibleWidth, minimum);
  saveWidths();
}
function move(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return;
  if (lastPress && (Math.abs(event.clientX - lastPress.x) > 3 || Math.abs(event.clientY - lastPress.y) > 3)) lastPress = null;
  const delta = drag.x - event.clientX;
  resize(drag.column, delta === 0 ? drag.preferred : drag.width + delta, drag.minimum);
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
  if (trackColumnWidths[current.column] !== current.preferred) saveFittedWidth(current);
}
const trackColumnCallbacks = Object.freeze({
  pointerdown(event: PointerEvent): void {
    const target = handleColumn(event);
    if (!target || event.button !== 0 || !event.isPrimary || drag) return;
    const { column, header, cell } = target;
    // PointerEvent.detail is zero in browsers; count stationary presses at this delegated port.
    if (lastPress?.header === header && lastPress.column === column && event.timeStamp - lastPress.time <= 400 && Math.abs(event.clientX - lastPress.x) <= 3 && Math.abs(event.clientY - lastPress.y) <= 3) {
      lastPress = null;
      resize(column, TRACK_COLUMN_DEFAULTS[column], target.minimum); saveWidths(); return;
    }
    lastPress = { header, column, time: event.timeStamp, x: event.clientX, y: event.clientY };
    header.setPointerCapture(event.pointerId);
    const preferred = trackColumnWidths[column];
    drag = { ...target, id: event.pointerId, x: event.clientX, width: cell.getBoundingClientRect().width || preferred, preferred };
    trackColumnDrag.column = column;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("lostpointercapture", finish);
  },
  keydown(event: KeyboardEvent): void {
    const target = handleColumn(event);
    if (!target || drag || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const { column, cell, minimum } = target;
    const width = cell.getBoundingClientRect().width || trackColumnWidths[column];
    event.preventDefault();
    resize(column, width + (event.key === "ArrowRight" ? 8 : -8), minimum);
    saveFittedWidth(target);
  },
});
export { initializeTrackColumns, trackColumnWidths, trackColumnDrag, trackColumnCallbacks };
