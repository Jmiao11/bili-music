type TrackColumn = "title" | "uploader" | "pages" | "plays" | "duration";
type TrackColumnWidths = { title: number | "auto"; uploader: number; pages: number; plays: number; duration: number };
const TRACK_COLUMNS_KEY = "bilibili-music.track-columns";
const TRACK_COLUMN_DEFAULTS: Readonly<TrackColumnWidths> = { title: "auto", uploader: 160, pages: 72, plays: 80, duration: 72 };
const TRACK_COLUMN_LIMITS = { title: [240, Number.MAX_SAFE_INTEGER], uploader: [100, 320], pages: [56, 120], plays: [64, 120], duration: [56, 100] } as const;
function parseTrackColumnWidths(value: string | null): TrackColumnWidths {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...TRACK_COLUMN_DEFAULTS };
    const widths = parsed as Record<string, unknown>, result = { ...TRACK_COLUMN_DEFAULTS };
    for (const column of Object.keys(TRACK_COLUMN_LIMITS) as TrackColumn[]) {
      const width = Object.hasOwn(widths, column) ? widths[column] : (column === "title" || column === "pages" ? TRACK_COLUMN_DEFAULTS[column] : undefined);
      if (column === "title" && width === "auto") continue;
      const [min, max] = TRACK_COLUMN_LIMITS[column];
      if (typeof width !== "number" || !Number.isFinite(width) || width < min || width > max) return { ...TRACK_COLUMN_DEFAULTS };
      result[column] = width;
    }
    return result;
  } catch { return { ...TRACK_COLUMN_DEFAULTS }; }
}
function resizeTrackColumn(column: TrackColumn, width: number): number {
  const [min, max] = TRACK_COLUMN_LIMITS[column];
  return Number.isFinite(width) ? Math.max(min, Math.min(max, width)) : column === "title" ? 240 : TRACK_COLUMN_DEFAULTS[column];
}
function trackColumnCapacities(widths: Readonly<TrackColumnWidths>) {
  return { uploader: widths.uploader - TRACK_COLUMN_LIMITS.uploader[0], pages: widths.pages - TRACK_COLUMN_LIMITS.pages[0], plays: widths.plays - TRACK_COLUMN_LIMITS.plays[0], duration: widths.duration - TRACK_COLUMN_LIMITS.duration[0] };
}
export { trackColumnCapacities, TRACK_COLUMNS_KEY, TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, parseTrackColumnWidths, resizeTrackColumn };
export type { TrackColumn, TrackColumnWidths };
