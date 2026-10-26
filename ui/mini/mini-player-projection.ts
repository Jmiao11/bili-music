import { accentChannels } from "../features/settings/settings-state.ts";
import type { createApplicationStore } from "../store/app-state.ts";
import { activeQueueTrack } from "../features/playback/playback-queue-state.ts";

function selectMiniPlayerSnapshot(state: ReturnType<ReturnType<typeof createApplicationStore>["getState"]>, dynamicColors?: readonly string[], imageScheme: "light"|"dark" = "dark") {
  const current = activeQueueTrack(state.playbackQueue);
  const accent = accentChannels(state.settings.accentColor, state.settings.view.accent ? state.settings.view.accent.theme : state.settings.theme);
  const track = state.playbackDisplay.renderedTrack;
  return {
    title: track.title || "尚未播放", uploader: track.uploader || "—", thumbnailUrl: track.thumbnailUrl || "",
    hasCurrent: Boolean(current?.bvid), canPrevious: true, canNext: true,
    isPlaying: state.playbackDisplay.buttonPlaying,
    isFavorited: Boolean(current?.bvid && state.library.favoriteBvids.has(current.bvid.toLowerCase())),
    ...(state.settings.theme === "image" ? { imageScheme, backgroundPath: state.settings.background?.path ?? null, backgroundDim: state.settings.backgroundDim, backgroundVersion: state.settings.view.backgroundVersion } : {}),
    ...(state.settings.theme === "dynamic" && dynamicColors ? { dynamicColors } : {}),
    theme: state.settings.theme || "dark", accent: { r: accent[0], g: accent[1], b: accent[2] },
  };
}
function selectMiniPlayerMessages(state: ReturnType<ReturnType<typeof createApplicationStore>["getState"]>) {
  return { status: state.playbackMessages.status, notice: state.playbackMessages.notice.text };
}
export { selectMiniPlayerMessages, selectMiniPlayerSnapshot };
