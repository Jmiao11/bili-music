import { accentChannels } from "./settings-state.ts";
import type { createApplicationStore } from "./app-state.ts";

function selectMiniPlayerSnapshot(state: ReturnType<ReturnType<typeof createApplicationStore>["getState"]>) {
  const current = state.playbackQueue.queue[state.playbackQueue.currentIndex];
  const accent = accentChannels(state.settings.accentColor, state.settings.view.accent ? state.settings.view.accent.theme : state.settings.theme);
  const track = state.playbackDisplay.renderedTrack;
  return {
    title: track.title || "尚未播放", uploader: track.uploader || "—", thumbnailUrl: track.thumbnailUrl || "",
    hasCurrent: Boolean(current?.bvid), canPrevious: true, canNext: true,
    isPlaying: state.playbackDisplay.buttonPlaying,
    isFavorited: Boolean(current?.bvid && state.library.favoriteBvids.has(current.bvid.toLowerCase())),
    theme: state.settings.theme || "dark", accent: { r: accent[0], g: accent[1], b: accent[2] },
  };
}
export { selectMiniPlayerSnapshot };
