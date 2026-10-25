type TrackColumn = "uploader" | "plays" | "duration";
type TrackColumnWidths = Record<TrackColumn, number>;
const TRACK_COLUMNS_KEY = "bilibili-music.track-columns";
const TRACK_COLUMN_DEFAULTS: Readonly<TrackColumnWidths> = { uploader: 160, plays: 80, duration: 72 };
const TRACK_COLUMN_LIMITS = { uploader: [100, 320], plays: [64, 120], duration: [56, 100] } as const;
function parseTrackColumnWidths(value: string | null): TrackColumnWidths {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (!parsed || typeof parsed !== "object") return { ...TRACK_COLUMN_DEFAULTS };
    const widths = parsed as Record<string, unknown>;
    for (const column of Object.keys(TRACK_COLUMN_LIMITS) as TrackColumn[]) {
      const width = widths[column], [min, max] = TRACK_COLUMN_LIMITS[column];
      if (typeof width !== "number" || !Number.isFinite(width) || width < min || width > max) return { ...TRACK_COLUMN_DEFAULTS };
    }
    return { uploader: widths.uploader as number, plays: widths.plays as number, duration: widths.duration as number };
  } catch { return { ...TRACK_COLUMN_DEFAULTS }; }
}
function resizeTrackColumn(column: TrackColumn, width: number): number {
  const [min, max] = TRACK_COLUMN_LIMITS[column];
  return Number.isFinite(width) ? Math.max(min, Math.min(max, width)) : TRACK_COLUMN_DEFAULTS[column];
}
export { TRACK_COLUMNS_KEY, TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, parseTrackColumnWidths, resizeTrackColumn };
export type { TrackColumn, TrackColumnWidths };
