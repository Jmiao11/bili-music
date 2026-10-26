import { shallowReactive } from "vue";
import { TRACK_COLUMNS_KEY, TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, parseTrackColumnWidths, resizeTrackColumn, trackColumnCapacities } from "../features/tracks/track-column-state.ts";
import type { TrackColumn } from "../features/tracks/track-column-state.ts";

const trackColumnWidths = shallowReactive({ ...TRACK_COLUMN_DEFAULTS });
const trackColumnDrag = shallowReactive<{ column: TrackColumn | null }>({ column: null });
let drag: { id: number; x: number; width: number; column: TrackColumn; header: HTMLElement; layout?: typeof trackColumnWidths; maximum?: number; pair?: { title: number; uploader: number; changed?: boolean } } | null = null;
let lastPress: { header: HTMLElement; column: TrackColumn; time: number; x: number; y: number } | null = null;
function applyWidths(widths = trackColumnWidths): void {
  const title = widths.title;
  document.documentElement.style.setProperty("--track-title-width", title === "auto" ? "100%" : `${title}px`);
  const capacities = trackColumnCapacities(widths);
  for (const column of ["uploader", "pages", "plays", "duration"] as const) {
    document.documentElement.style.setProperty(`--track-${column}-width`, `${widths[column]}px`);
    document.documentElement.style.setProperty(`--track-${column}-capacity`, String(capacities[column]));
  }
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
  if (drag.pair && drag.layout) {
    const start = drag.pair;
    const delta = Math.max(Math.max(240 - start.title, start.uploader - 320), Math.min(start.uploader - 100, event.clientX - drag.x));
    drag.layout.title = start.title + delta; drag.layout.uploader = start.uploader - delta;
    if (delta !== 0) start.changed = true;
    trackColumnWidths.title = drag.layout.title;
    if (start.changed) trackColumnWidths.uploader = drag.layout.uploader;
    applyWidths(drag.layout); return;
  }
  const width = Math.min(drag.maximum ?? Infinity, resizeTrackColumn(drag.column, drag.width + event.clientX - drag.x));
  trackColumnWidths[drag.column] = width;
  if (drag.layout) { drag.layout[drag.column] = width; applyWidths(drag.layout); }
  else applyWidths();
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
  // An explicit pair resize saves the fitted layout so release cannot refit other boundaries.
  if (current.pair?.changed && current.layout) {
    for (const column of ["title","uploader","pages","plays","duration"] as const) {
      const width = current.layout[column];
      if (typeof width === "number" && width >= TRACK_COLUMN_LIMITS[column][0]) trackColumnWidths[column] = width;
    }
  }
  applyWidths(); saveWidths();
}
const trackColumnCallbacks = Object.freeze({
  pointerdown(event: PointerEvent): void {
    const column = handleColumn(event);
    if (!column || event.button !== 0 || !event.isPrimary || drag) return;
    const header = event.currentTarget as HTMLElement;
    // PointerEvent.detail is zero in browsers; count stationary presses at this delegated port.
    if (lastPress?.header === header && lastPress.column === column && event.timeStamp - lastPress.time <= 400 && Math.abs(event.clientX - lastPress.x) <= 3 && Math.abs(event.clientY - lastPress.y) <= 3) {
      lastPress = null;
      if (column === "title") { trackColumnWidths.title = "auto"; }
      else trackColumnWidths[column] = TRACK_COLUMN_DEFAULTS[column];
      applyWidths(); saveWidths(); return;
    }
    lastPress = { header, column, time: event.timeStamp, x: event.clientX, y: event.clientY };
    const handle = (event.target as Element).closest<HTMLElement>("[data-track-column]");
    if (!handle?.parentElement) return;
    const line = handle.getBoundingClientRect(), cell = handle.parentElement.getBoundingClientRect();
    header.setPointerCapture(event.pointerId);
    const saved = trackColumnWidths[column];
    drag = { id: event.pointerId, x: line.width ? line.left + line.width / 2 : event.clientX, width: saved === "auto" ? cell.width || 240 : saved, column, header };
    const titleCell = header.querySelector<HTMLElement>(".column-title"), titleWidth = titleCell?.getBoundingClientRect().width ?? 0;
    if (titleWidth > 0) {
      const widthOf = (name: string) => header.querySelector<HTMLElement>(".column-" + name)?.getBoundingClientRect().width ?? 0;
      const layout = { title: titleWidth, uploader: widthOf("uploader"), pages: widthOf("pages"), plays: widthOf("play"), duration: widthOf("duration") };
      trackColumnWidths.title = titleWidth;
      drag.layout = layout; drag.width = layout[column];
      if (column === "title") drag.pair = {title:titleWidth,uploader:layout.uploader};
      else drag.maximum = Math.min(TRACK_COLUMN_LIMITS[column][1], drag.width + widthOf("spacer"));
      applyWidths(layout);
    }
    trackColumnDrag.column = column;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("lostpointercapture", finish);
  },
  keydown(event: KeyboardEvent): void {
    const column = handleColumn(event);
    if (!column || drag || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const saved = trackColumnWidths[column];
    const width = saved === "auto" ? (event.target as HTMLElement).parentElement?.getBoundingClientRect().width || 240 : saved;
    event.preventDefault(); resize(column, width + (event.key === "ArrowRight" ? 8 : -8)); saveWidths();
  },
});
export { initializeTrackColumns, trackColumnWidths, trackColumnDrag, trackColumnCallbacks };
