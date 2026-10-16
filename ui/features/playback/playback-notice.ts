import { playbackBarNode, resumePlayPauseButton } from "../../platform/main-window-refs.ts";
import { getPlaybackMessages, getPlaybackMessagesActions } from "./playback-messages.ts";

const SKIP_NOTICE_DURATION_MS: number = 3200;

let playbackNoticeTimer: ReturnType<typeof window.setTimeout> | null = null;

function clearPlaybackNotice(): void {
  if (playbackNoticeTimer !== null) {
    clearTimeout(playbackNoticeTimer);
    playbackNoticeTimer = null;
  }
  getPlaybackMessagesActions().clearNotice();
  window.dispatchEvent(new Event("bilibili-music-notice-change"));
}

function positionPlaybackNotice(): void {
  const pauseButton = resumePlayPauseButton.getBoundingClientRect();
  getPlaybackMessagesActions().positionNotice(pauseButton.left + pauseButton.width / 2);
}

function initPlaybackNotice(): void {
positionPlaybackNotice();
new ResizeObserver(positionPlaybackNotice).observe(playbackBarNode);
}

function showPlaybackNotice(message: string, { persistent = false, kind = "error" }: { persistent?: boolean; kind?: "error" | "info" } = {}): void {
  positionPlaybackNotice();
  const notice = getPlaybackMessages().notice;
  if (kind === "info" && notice.visible && notice.kind === "error") return;
  if (playbackNoticeTimer !== null) {
    clearTimeout(playbackNoticeTimer);
    playbackNoticeTimer = null;
  }
  getPlaybackMessagesActions().showNotice(message, kind);
  window.dispatchEvent(new Event("bilibili-music-notice-change"));
  if (!persistent) {
    playbackNoticeTimer = window.setTimeout(clearPlaybackNotice,
      kind === "info" ? 2000 : SKIP_NOTICE_DURATION_MS);
  }
}

export { clearPlaybackNotice, initPlaybackNotice, showPlaybackNotice };
