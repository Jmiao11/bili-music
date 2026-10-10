import { getApplicationStore } from "./home.ts";
import { toggleCurrentFavorite } from "./library-ui.ts";
import { getPlaybackCommands } from "./appearance.ts";
import { selectMiniPlayerSnapshot } from "./playback-mini-view.ts";

function subscribeMiniPlayerTheme(listener: () => void) {
  const store = getApplicationStore();
  let settings = store.getState().settings;
  let previous = selectMiniPlayerSnapshot(store.getState());
  return store.subscribe(state => {
    if (state.settings === settings) return;
    settings = state.settings;
    const next = selectMiniPlayerSnapshot(state);
    if (next.theme === previous.theme && next.accent.r === previous.accent.r && next.accent.g === previous.accent.g && next.accent.b === previous.accent.b) return;
    previous = next;
    listener();
  });
}

function installMiniPlayerBridge() {
  // shortcut: classic 宿主仅调用这些端口，state-9 移除桥接。
  const commands = getPlaybackCommands();
  window.bilibiliMusicMiniHost = Object.freeze({
    getSnapshot: () => selectMiniPlayerSnapshot(getApplicationStore().getState()),
    subscribeTheme: subscribeMiniPlayerTheme,
    previous: commands.previous, togglePlayPause: commands.togglePlayPause, next: commands.next,
    toggleFavorite: toggleCurrentFavorite,
  } satisfies Window["bilibiliMusicMiniHost"]);
}
export { installMiniPlayerBridge };
