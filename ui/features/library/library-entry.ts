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
