function playbackFailureMessage(error: unknown, isPage: boolean = false): string {
  const subject = isPage ? "该分P" : "该视频";
  let message = "";
  try {
    message = String(error);
  } catch {
    // An unusual error object must not hide the playback failure notice.
  }

  if (message.includes("all pages disabled by user")) {
    return "该视频的分P都已设为不想听";
  }
  if (
    message.includes("failed with code 62002") ||
    message.includes("failed with code -404") ||
    message.includes("failed with code -403")
  ) {
    return `${subject}已被删除或设为私密`;
  }
  if (
    message.includes("no data.dash.audio") ||
    message.includes("dash.audio is empty") ||
    message.includes("no browser-playable AAC") ||
    message.includes("durl fallback unavailable") ||
    message.includes("durl stream is not MP4")
  ) {
    return `${subject}没有可播放的音频`;
  }
  if (
    message.includes("Bilibili rejected the cookie") ||
    message.includes("Bilibili cookie file not found") ||
    message.includes("Bilibili cookie is invalid") ||
    message.includes("Bilibili cookie has expired") ||
    message.includes("failed to read Bilibili cookie file")
  ) {
    return "yt-dlp 的登录凭证已失效";
  }
  if (
    message.includes("failed probe") ||
    message.includes("probe request failed") ||
    message.includes("probe returned") ||
    message.includes("HTTP 412") ||
    message.includes("request failed")
  ) {
    return "音频源暂时连不上";
  }
  return `${subject}无法播放`;
}

function unavailableTrackReason(error: unknown): string {
  const message = playbackFailureMessage(error);
  return message.includes("已被删除") || message.includes("没有可播放的音频")
    ? message
    : "";
}

function unavailableTrackLocations(unavailable: readonly CommandContract.UnavailableTrack[], favorites: readonly CommandContract.TrackSnapshot[], playlists: readonly CommandContract.Playlist[]): Map<string, string> {
  const result = new Map();
  for (const item of unavailable) {
    const key = item.bvid.toLowerCase();
    const locations = [];
    if (favorites.some((track) => track.bvid.toLowerCase() === key)) {
      locations.push("收藏");
    }
    for (const playlist of playlists) {
      if ((playlist.items ?? []).some((track) => track.bvid.toLowerCase() === key)) {
        locations.push(`歌单《${playlist.name}》`);
      }
    }
    result.set(key, locations.length ? locations.join("、") : "不在收藏或歌单中");
  }
  return result;
}

function isBvId(value: string): boolean {
  return /^BV[0-9A-Za-z]{10}$/i.test(value.trim());
}

function shouldOpenPastedBvPages(pending, eventBvid: unknown, currentBvid: unknown, requestVersion: number, pageCount: number): boolean {
  const bvid = String(pending?.bvid ?? "").toLowerCase();
  return Boolean(
    bvid && bvid === String(eventBvid ?? "").toLowerCase() &&
    bvid === String(currentBvid ?? "").toLowerCase() &&
    pending.requestVersion === requestVersion && pageCount > 1
  );
}

function displayThumbnailUrl(url: string): string {
  if (!url) {
    return "";
  }
  return url
    .replace(/^\/\//, "https://")
    .replace(/@[^/?#]*(?=([?#]|$))/, "");
}

function normalizeTrack(video): CommandContract.SearchVideo & CommandContract.TrackSnapshot {
  const playCount = Number(video?.playCount);
  const pubdate = Number(video?.pubdate);
  return {
    bvid: String(video?.bvid ?? "").trim(),
    title: String(video?.title ?? video?.bvid ?? "未命名视频"),
    uploader: String(video?.uploader ?? "未知 UP 主"),
    thumbnailUrl: displayThumbnailUrl(video?.thumbnailUrl ?? ""),
    durationSeconds: Math.max(0, Math.round(Number(video?.durationSeconds) || 0)),
    playCount:
      video?.playCount === null || video?.playCount === undefined || !Number.isFinite(playCount) || playCount < 0
        ? null
        : Math.round(playCount),
    pubdate:
      video?.pubdate === null || video?.pubdate === undefined || !Number.isFinite(pubdate) || pubdate < 0
        ? null
        : Math.round(pubdate),
    addedAt: video?.addedAt ?? "",
  };
}

function snapshotForLibrary(video): CommandContract.TrackSnapshotInput {
  const track = normalizeTrack(video);
  return {
    bvid: track.bvid,
    title: track.title,
    uploader: track.uploader,
    thumbnailUrl: track.thumbnailUrl,
    durationSeconds: track.durationSeconds,
  };
}

function normalizeVideoPage(page, index: number): CommandContract.VideoPage {
  return {
    page: Math.max(1, Math.round(Number(page?.page) || index + 1)),
    cid: Number(page?.cid) || 0,
    part: String(page?.part ?? "").trim(),
    durationSeconds: Math.max(
      0,
      Math.round(Number(page?.durationSeconds ?? page?.duration) || 0),
    ),
  };
}

function buildDisplayTrack(video, info, page) {
  const base = normalizeTrack(video);
  if (!page) {
    return null;
  }
  return {
    bvid: base.bvid,
    title: page.part || info.title || base.title,
    uploader: info.uploader || base.uploader,
    thumbnailUrl: displayThumbnailUrl(info.thumbnailUrl || base.thumbnailUrl),
    durationSeconds: page.durationSeconds || Math.round(Number(info.durationSeconds) || 0),
    hasCurrent: true,
  };
}

function playbackTrackSnapshot(video): CommandContract.TrackSnapshot {
  return {
    ...snapshotForLibrary(video),
    addedAt: String(video?.addedAt ?? ""),
  };
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatPlayCount(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return "—";
  }
  if (number >= 100_000_000) {
    return `${(number / 100_000_000).toFixed(1)}亿`;
  }
  if (number >= 10_000) {
    return `${(number / 10_000).toFixed(1)}万`;
  }
  return String(Math.round(number));
}

function formatPubdate(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    return "—";
  }
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function escapeText(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}


export { buildDisplayTrack, displayThumbnailUrl, escapeText, formatDuration, formatPlayCount, formatPubdate, isBvId, normalizeTrack, normalizeVideoPage, playbackFailureMessage, playbackTrackSnapshot, shouldOpenPastedBvPages, snapshotForLibrary, unavailableTrackLocations, unavailableTrackReason };
