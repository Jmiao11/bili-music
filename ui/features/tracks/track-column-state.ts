type TrackColumn = "title" | "uploader" | "pages" | "plays" | "duration";
type ResizableTrackColumn = Exclude<TrackColumn, "title">;
type TrackColumnWidths = { title: number | "auto"; uploader: number; pages: number; plays: number; duration: number };
const TRACK_COLUMNS_KEY = "bilibili-music.track-columns";
const TRACK_COLUMN_DEFAULTS: Readonly<TrackColumnWidths> = { title: "auto", uploader: 160, pages: 72, plays: 80, duration: 72 };
const TRACK_COLUMN_LIMITS = { title: [240, Number.MAX_SAFE_INTEGER], uploader: [80, 320], pages: [48, 120], plays: [64, 120], duration: [56, 100] } as const;
const RECENT_PLAY_TIME_MIN = 72;
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
function resizeTrackColumn(column: ResizableTrackColumn, width: number): number {
  const [min, max] = TRACK_COLUMN_LIMITS[column];
  return Number.isFinite(width) ? Math.max(min, Math.min(max, width)) : TRACK_COLUMN_DEFAULTS[column];
}
export { TRACK_COLUMNS_KEY, TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, RECENT_PLAY_TIME_MIN, parseTrackColumnWidths, resizeTrackColumn };
export type { ResizableTrackColumn, TrackColumnWidths };
