import type { DeepReadonly } from "./state-store.ts";

type PlaybackMessagesState = {
  status: string; statusVersion: number; noticeX: number | null;
  notice: { text: string; kind: "error" | "info" | null; visible: boolean; version: number };
};
type PlaybackMessagesSnapshot = DeepReadonly<PlaybackMessagesState>;
function initialPlaybackMessagesState(): PlaybackMessagesState {
  return { status: "", statusVersion: 0, noticeX: null, notice: { text: "", kind: null, visible: false, version: 0 } };
}
function messagesWithStatus(state: PlaybackMessagesSnapshot, text: string): PlaybackMessagesSnapshot {
  return { ...state, status: text, statusVersion: state.statusVersion + 1 };
}
function createPlaybackMessagesActions(read: () => PlaybackMessagesSnapshot, commit: (next: PlaybackMessagesSnapshot) => void) {
  function setStatus(text: string): void { commit(messagesWithStatus(read(), text)); }
  function showNotice(text: string, kind: "error" | "info"): boolean {
    const state = read();
    if (kind === "info" && state.notice.visible && state.notice.kind === "error") return false;
    commit({ ...state, notice: { text, kind, visible: true, version: state.notice.version + 1 } });
    return true;
  }
  function clearNotice(): void {
    const state = read();
    commit({ ...state, notice: { ...state.notice, text: "", visible: false, version: state.notice.version + 1 } });
  }
  function positionNotice(noticeX: number): void { if (read().noticeX !== noticeX) commit({ ...read(), noticeX }); }
  return { setStatus, showNotice, clearNotice, positionNotice };
}
export { createPlaybackMessagesActions, initialPlaybackMessagesState, messagesWithStatus };
export type { PlaybackMessagesSnapshot };
