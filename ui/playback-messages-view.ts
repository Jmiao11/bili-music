import { playbackNotice, status } from "./player-dom.ts";
import type { PlaybackMessagesSnapshot } from "./playback-messages-state.ts";

function renderPlaybackMessagesSnapshot(state: PlaybackMessagesSnapshot, previous: PlaybackMessagesSnapshot): void {
  if (state.statusVersion > previous.statusVersion) status.textContent = state.status;
  if (state.notice.version > previous.notice.version) {
    if (state.notice.visible) {
      if (state.notice.kind !== null) playbackNotice.dataset.kind = state.notice.kind;
      playbackNotice.textContent = state.notice.text;
      playbackNotice.classList.add("is-visible");
    } else {
      playbackNotice.classList.remove("is-visible");
      playbackNotice.textContent = state.notice.text;
    }
  }
}
export { renderPlaybackMessagesSnapshot };
