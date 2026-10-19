function collection(count = 25, id = 31): CommandContract.LibraryCollection {
  const items = Array.from({ length: count }, (_, i) => ({ bvid: `BV${String(i + 1).padStart(10, "0")}`, title: `曲目${i + 1}`, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: "1700000000000" }));
  return { collectionId: id, anchorBvid: items[0].bvid, title: "测试合集", thumbnailUrl: "", videoCount: count, addedAt: "1700000000000", snapshot: { fetchedAt: "1700000000000", items }, sourceStatus: "active" };
}
function collectionEntry(data = collection(), entryId = "reference-31"): CommandContract.LibraryEntry {
  return { kind: "collection", entryId, ...data };
}
function videoEntry(video: CommandContract.TrackSnapshot): CommandContract.LibraryEntry {
  return { kind: "video", entryId: `video:${video.bvid.toLowerCase()}`, video };
}
function collectionPage(snapshot = collection()): CommandContract.CollectionPage {
  return { items: snapshot.snapshot.items.slice(0, 20).map(item => ({ ...item, playCount: null, pubdate: null })), total: snapshot.videoCount, hasMore: snapshot.videoCount > 20, snapshot };
}
export { collection, collectionEntry, videoEntry, collectionPage };
