import type { PlaybackMessagesSnapshot } from "./playback-messages-state.ts";

function projectPlaybackMessages(state: PlaybackMessagesSnapshot) {
  return { status: state.status, notice: state.notice.text, kind: state.notice.kind, visible: state.notice.visible, x: state.noticeX };
}
export { projectPlaybackMessages };
