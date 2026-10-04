import { playbackNotice, result, resumePlayPauseButton } from "./player-dom.ts";

const SKIP_NOTICE_DURATION_MS = 3200;

let playbackNoticeTimer = null;

function clearPlaybackNotice() {
  if (playbackNoticeTimer !== null) {
    clearTimeout(playbackNoticeTimer);
    playbackNoticeTimer = null;
  }
  playbackNotice.classList.remove("is-visible");
  playbackNotice.textContent = "";
  window.dispatchEvent(new Event("bilibili-music-notice-change"));
}

function positionPlaybackNotice() {
  const pauseButton = resumePlayPauseButton.getBoundingClientRect();
  playbackNotice.style.setProperty("--playback-notice-x", `${pauseButton.left + pauseButton.width / 2}px`);
}

function initPlaybackNotice() {
positionPlaybackNotice();
new ResizeObserver(positionPlaybackNotice).observe(result);
}

function showPlaybackNotice(message, { persistent = false, kind = "error" } = {}) {
  positionPlaybackNotice();
  if (kind === "info" && playbackNotice.classList.contains("is-visible") &&
      playbackNotice.dataset.kind === "error") return;
  if (playbackNoticeTimer !== null) {
    clearTimeout(playbackNoticeTimer);
    playbackNoticeTimer = null;
  }
  playbackNotice.dataset.kind = kind;
  playbackNotice.textContent = message;
  playbackNotice.classList.add("is-visible");
  window.dispatchEvent(new Event("bilibili-music-notice-change"));
  if (!persistent) {
    playbackNoticeTimer = window.setTimeout(clearPlaybackNotice,
      kind === "info" ? 2000 : SKIP_NOTICE_DURATION_MS);
  }
}

export { clearPlaybackNotice, initPlaybackNotice, showPlaybackNotice };
