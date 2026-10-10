import { getApplicationStore } from "./home.ts";
import { toggleCurrentFavorite } from "./library-ui.ts";
import { getPlaybackCommands } from "./appearance.ts";
import { selectMiniPlayerSnapshot } from "./playback-mini-view.ts";

function installMiniPlayerBridge() {
  // shortcut: classic 宿主仅调用这些端口，state-9 移除桥接。
  const commands = getPlaybackCommands();
  window.bilibiliMusicMiniHost = Object.freeze({
    getSnapshot: () => selectMiniPlayerSnapshot(getApplicationStore().getState()),
    previous: commands.previous, togglePlayPause: commands.togglePlayPause, next: commands.next,
    toggleFavorite: toggleCurrentFavorite,
  } satisfies Window["bilibiliMusicMiniHost"]);
}
export { installMiniPlayerBridge };
