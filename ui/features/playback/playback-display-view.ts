import type { PlaybackDisplaySnapshot, PlaybackSessionTrack } from "./playback-display-state.ts";
import { formatPlaybackTime } from "./playback-display-state.ts";
import type { PlaybackQueueSnapshot } from "./playback-queue-state.ts";
import { activeQueueTrack } from "./playback-queue-state.ts";
import type { PlaybackSessionState } from "./playback-session-state.ts";
import type { DeepReadonly } from "../../store/state-store.ts";

const audioQualityOptions = {
  highest: { label: "自动", description: "按可用的最高音质" },
  "192k": { label: "高品质", description: "AAC · 192 kbps" },
  "132k": { label: "标准", description: "AAC · 132 kbps" },
  "64k": { label: "省流", description: "AAC · 64 kbps" },
} satisfies Record<CommandContract.AudioQuality, { label: string; description: string }>;

const compatibilityQualityHint = "通过兼容通道播放，音质以实际为准";
const qualityByAudioId: Partial<Record<number, CommandContract.AudioQuality>> = { 30280: "192k", 30232: "132k", 30216: "64k" };

function projectAudioQualityLabel({ audioId, isFallback }: PlaybackDisplaySnapshot["audioQuality"]): string {
  if (isFallback) return "兼容";
  const quality = audioId === null ? undefined : qualityByAudioId[audioId];
  return quality ? audioQualityOptions[quality].label : "音质";
}

function projectPlaybackControls(queue: PlaybackQueueSnapshot, session: DeepReadonly<PlaybackSessionState>, favorites: ReadonlySet<string>) {
  const current = activeQueueTrack(queue), bvid = current?.bvid ?? "";
  const favorited = favorites.has(bvid.toLowerCase());
  const pageCount = session.currentPages.length, page = Math.min(queue.currentPageIndex + 1, pageCount);
  const pagesHidden = !current || pageCount <= 1;
  const loopLabel = queue.loopMode === "sequence" ? "关闭循环" : queue.loopMode === "list" ? "列表循环" : queue.loopMode === "single" ? "单曲循环" : null;
  return { bvid, hasCurrent: Boolean(current), favorited, favoriteDisabled: !bvid, favoriteTitle: favorited ? "取消收藏当前歌曲" : "收藏当前歌曲",
    favoriteText: favorited ? "♥" : "♡", immersiveFavoriteText: favorited ? "♥ 已收藏" : "♡ 收藏",
    queuePosition: `♪${current ? queue.currentIndex + 1 : 0}/${queue.queue.length}`, pagesHidden,
    pagesText: pagesHidden ? "" : `P${page}/${pageCount}`, pagesLabel: pagesHidden ? "查看分P" : `查看分P，当前第 ${page} 个，共 ${pageCount} 个`,
    loopLabel, loopMode: queue.loopMode, loopActive: queue.loopMode !== "sequence", shuffle: queue.shuffle };
}

function projectPlaybackProgress(state: PlaybackDisplaySnapshot) {
  const position = state.presentation.restoredPosition ?? state.progress.position;
  const max = state.presentation.restoredPosition !== null ? state.presentation.restoredMax : state.view.progressVersion ? state.progress.duration : 100;
  return { max, value: position, progress: `${max > 0 ? position / max * 100 : 0}%`,
    styled: state.view.progressVersion > 0 || state.presentation.restoredPosition !== null,
    currentTime: formatPlaybackTime(position), duration: state.presentation.duration };
}

function renderPlaybackMediaSession(state: PlaybackDisplaySnapshot, previous: PlaybackDisplaySnapshot | null, bindings: {
  setTrack(track: PlaybackSessionTrack | null): void;
  setPlaybackState(state: "none" | "paused" | "playing"): void;
  setPosition(position: PlaybackDisplaySnapshot["position"]): void;
}): void {
  if (state.view.trackVersion && state.view.trackVersion !== previous?.view.trackVersion) bindings.setTrack(state.track);
  if (state.view.sessionVersion && state.view.sessionVersion !== previous?.view.sessionVersion) bindings.setPlaybackState(state.sessionState);
  if (state.view.positionVersion && state.view.positionVersion !== previous?.view.positionVersion) bindings.setPosition(state.position);
}
export { audioQualityOptions, compatibilityQualityHint, projectAudioQualityLabel, projectPlaybackControls, projectPlaybackProgress, renderPlaybackMediaSession };
