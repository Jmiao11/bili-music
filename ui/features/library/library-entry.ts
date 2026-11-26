import { normalizeTrack } from "../../shared/track-utils.ts";
import type { DeepReadonly } from "../../store/state-store.ts";

type Entry = DeepReadonly<CommandContract.LibraryEntry>;
type CollectionEntry = Extract<Entry, { kind: "collection" }>;

function normalizeLibraryEntry(entry: Entry | DeepReadonly<CommandContract.TrackSnapshot>): Entry {
  if ("kind" in entry && entry.kind === "collection") return entry;
  const video = normalizeTrack("video" in entry ? entry.video : entry);
  return { kind: "video", entryId: "entryId" in entry ? entry.entryId : `video:${video.bvid.toLowerCase()}`, video };
}
function libraryVideos(entries: readonly Entry[]) { return entries.flatMap(entry => entry.kind === "video" ? [entry.video] : []); }
function libraryVideoBvids(entries: readonly Entry[]) { return new Set(libraryVideos(entries).map(video => video.bvid.toLowerCase())); }
function sameCollection(entry: Entry, id: number): boolean { return entry.kind === "collection" && entry.collectionId === id; }
function collectionInput(collection: DeepReadonly<CommandContract.LibraryCollection>): CommandContract.LibraryCollection {
  return { ...collection, snapshot: { ...collection.snapshot, items: collection.snapshot.items.map(item => ({ ...item })) } };
}
function completeCollection(collection: DeepReadonly<CommandContract.LibraryCollection>, id: number): boolean {
  return collection.collectionId === id && collection.videoCount > 0 && collection.videoCount === collection.snapshot.items.length
    && collection.snapshot.items.every(item => /^BV[a-z0-9]{10}$/i.test(item.bvid))
    && new Set(collection.snapshot.items.map(item => item.bvid.toLowerCase())).size === collection.videoCount;
}

export { normalizeLibraryEntry, libraryVideos, libraryVideoBvids, sameCollection, collectionInput, completeCollection };
export type { CollectionEntry };

type TitlePart = Readonly<{ text: string; match: boolean }>;

const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
const localLibraryArtwork = (url: string) => url.startsWith("data:") ? url : "";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function libraryFilterTerms(value: string): readonly string[] {
  return [...new Set(normalize(value).trim().split(/\s+/u).filter(Boolean))];
}

function matchesLibraryTerms(terms: readonly string[], ...fields: string[]): boolean {
  const text = fields.map(normalize);
  return terms.every(term => text.some(field => field.includes(term)));
}

function libraryEntryMatch(entry: Readonly<{
  kind: "video";
  video: Readonly<Pick<CommandContract.TrackSnapshot, "title" | "uploader">>;
}> | Readonly<{
  kind: "collection";
  title: string;
  snapshot: Readonly<{items: readonly Readonly<Pick<CommandContract.TrackSnapshot, "title">>[]}>;
}>, terms: readonly string[], playlistName?: string): number {
  if (entry.kind === "video") {
    return matchesLibraryTerms(terms, entry.video.title, entry.video.uploader, playlistName ?? "") ? 0 : -1;
  }
  if (matchesLibraryTerms(terms, entry.title)) return 0;
  if (playlistName === undefined) return -1;
  const count = entry.snapshot.items.filter(item => matchesLibraryTerms(terms, item.title)).length;
  return count || -1;
}

function libraryTitleParts(title: string, terms: readonly string[]): readonly TitlePart[] | undefined {
  const normalized = normalize(title);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    for (let index = normalized.indexOf(term); index >= 0; index = normalized.indexOf(term, index + 1)) {
      ranges.push([index, index + term.length]);
    }
  }
  if (!ranges.length) return undefined;
  if (title.normalize("NFKC") !== title || normalized.length !== title.length) {
    const starts: number[] = [], ends: number[] = [];
    for (const { segment, index } of segmenter.segment(title)) {
      for (let unit = 0; unit < normalize(segment).length; unit++) {
        starts.push(index);
        ends.push(index + segment.length);
      }
    }
    for (const range of ranges) {
      range[0] = starts[range[0]] ?? title.length;
      range[1] = ends[range[1] - 1] ?? title.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  const parts: TitlePart[] = [];
  let end = 0;
  for (const [start, next] of merged) {
    if (start > end) parts.push({ text: title.slice(end, start), match: false });
    parts.push({ text: title.slice(start, next), match: true });
    end = next;
  }
  if (end < title.length) parts.push({ text: title.slice(end), match: false });
  return parts;
}

export { libraryEntryMatch, libraryFilterTerms, libraryTitleParts, localLibraryArtwork, matchesLibraryTerms };
export type { TitlePart };
