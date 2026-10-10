import { getApplicationStore } from "./home.ts";
import { renderPlaybackMessagesSnapshot } from "./playback-messages-view.ts";

let mounted = false;
function getPlaybackMessagesActions() {
  const store = getApplicationStore();
  if (!mounted) {
    mounted = true;
    let rendered = store.getState().playbackMessages;
    store.subscribe(state => {
      const next = state.playbackMessages, previous = rendered;
      rendered = { ...rendered,
        ...(next.statusVersion > rendered.statusVersion ? { status: next.status, statusVersion: next.statusVersion } : {}),
        ...(next.notice.version > rendered.notice.version ? { notice: next.notice } : {}) };
      renderPlaybackMessagesSnapshot(next, previous);
    });
    renderPlaybackMessagesSnapshot(rendered, rendered);
  }
  return store.actions.playbackMessages;
}
function setPlaybackStatus(text: string): void { getPlaybackMessagesActions().setStatus(text); }
function getPlaybackMessages() { getPlaybackMessagesActions(); return getApplicationStore().getState().playbackMessages; }
export { getPlaybackMessages, getPlaybackMessagesActions, setPlaybackStatus };
