import type { PlaybackDisplaySnapshot, PlaybackSessionTrack } from "./playback-display-state.ts";
import { formatPlaybackTime } from "./playback-display-state.ts";
import type { PlaybackQueueSnapshot } from "./playback-queue-state.ts";
import type { PlaybackSessionState } from "./playback-session-state.ts";
import type { DeepReadonly } from "../../store/state-store.ts";

function projectPlaybackControls(queue: PlaybackQueueSnapshot, session: DeepReadonly<PlaybackSessionState>, favorites: ReadonlySet<string>) {
  const current = queue.queue[queue.currentIndex], bvid = current?.bvid ?? "";
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
  setPosition(position: NonNullable<PlaybackDisplaySnapshot["position"]>): void;
}): void {
  if (state.view.trackVersion && state.view.trackVersion !== previous?.view.trackVersion) bindings.setTrack(state.track);
  if (state.view.sessionVersion && state.view.sessionVersion !== previous?.view.sessionVersion) bindings.setPlaybackState(state.sessionState);
  if (state.view.positionVersion && state.view.positionVersion !== previous?.view.positionVersion && state.position) bindings.setPosition(state.position);
}
export { projectPlaybackControls, projectPlaybackProgress, renderPlaybackMediaSession };
