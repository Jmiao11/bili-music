import { displayThumbnailUrl } from "../../shared/track-utils.ts";

const tones = ["coral", "teal", "purple", "green"] as const;
type CoverTone = "pink" | "blue" | typeof tones[number];

function playlistTone(id: string): CoverTone {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}

type CoverTrack = Readonly<{ key: string; url: string; width?: number; height?: number }>;

function coverWindow<T>(items: readonly T[], start: number, read: (item: T) => CoverTrack): CoverTrack[] {
  return Array.from({ length: Math.min(items.length, 10) }, (_, offset) =>
    read(items[(Math.max(0, start) + offset) % items.length]));
}

function coverTier(side: number, ratio: number): number {
  const pixels = side * ratio;
  return pixels <= 320 ? 320 : pixels <= 480 ? 480 : 720;
}

function coverCandidates(tracks: readonly CoverTrack[], tier: number): CoverTrack[] {
  const seen = new Set<string>();
  const result: CoverTrack[] = [];
  for (const track of tracks) {
    const url = track.url.trim().replace(/^\/\//, "https://");
    if (!url) continue;
    const end = url.search(/[?#]/);
    const path = displayThumbnailUrl(end < 0 ? url : url.slice(0, end));
    const identity = path.replace(/^https?:\/\//i, "//");
    if (seen.has(identity)) continue;
    seen.add(identity);
    const size = track.width && track.height ? Math.min(tier, track.width, track.height) : tier;
    const thumbnail = /^https?:\/\/i\d+\.hdslb\.com\//i.test(path)
      ? path + `@${size}w_${size}h_1c.webp` + (end < 0 ? "" : url.slice(end)) : url;
    result.push({ key: track.key, url: thumbnail });
  }
  return result;
}

function coverSlots(candidates: readonly CoverTrack[], failed: ReadonlySet<string>): CoverTrack[] {
  return candidates.filter(track => !failed.has(track.url)).slice(0, 3);
}

export { coverWindow, coverTier, coverCandidates, coverSlots, playlistTone };
export type { CoverTone, CoverTrack };
