import type { ApplicationSnapshot } from "../../store/application-store.ts";
import { projectPlaybackControls } from "./playback-display-view.ts";
import type { LyricsCandidate } from "../immersive/lyrics-display-state.ts";
import { readApplicationStore } from "../../store/application-store.ts";
import { playerQualityRefs } from "../../platform/main-window-refs.ts";

type PlaybackControls = ReturnType<typeof projectPlaybackControls>;
let rootPlaybackControls: PlaybackControls | null = null;
let dependencies: readonly unknown[] = [];
function projectRootPlayback(state: ApplicationSnapshot): PlaybackControls {
  const next = [state.playbackQueue, state.playbackSession.currentPages, state.library.favoriteBvids];
  if (rootPlaybackControls && next.every((value, index) => value === dependencies[index])) return rootPlaybackControls;
  const projected = projectPlaybackControls(state.playbackQueue, state.playbackSession, state.library.favoriteBvids);
  rootPlaybackControls = { ...projected,
    ...(projected.pagesHidden && rootPlaybackControls ? { pagesText: rootPlaybackControls.pagesText, pagesLabel: rootPlaybackControls.pagesLabel } : {}),
    ...(projected.loopLabel === null && rootPlaybackControls ? { loopLabel: rootPlaybackControls.loopLabel, loopActive: rootPlaybackControls.loopActive, shuffle: rootPlaybackControls.shuffle } : {}),
  };
  dependencies = next;
  return rootPlaybackControls;
}

type PlaybackCallbacks = {
  toggle(): void; toggleImmersive(): void; previous(): void; next(): void;
  previousImmersive(): void; nextImmersive(): void; loop(): void; shuffle(checked: boolean): void;
  seekStart(): void; preview(value: string): void; seek(value: string): void; volume(value: string): void;
  favorite(): void; addPlaylist(): void; addPlaylistImmersive(): void; openVideo(): void;
  pages(): void; skip(): void; openImmersive(): void; closeImmersive(): void;
  qualityToggle(): void; qualityKeydown(event: KeyboardEvent): void; qualityChoose(quality: CommandContract.AudioQuality): void;
  immersiveTransition(event: TransitionEvent): void; immersiveBackdrop(event: MouseEvent): void;
  bindLyrics(candidate: LyricsCandidate): void; rejectLyrics(): void; bindManualLyrics(candidate: LyricsCandidate): void;
};

// The root mounts before controllers evaluate; forwarding keeps its callbacks stable.
const playbackHandlers: Partial<PlaybackCallbacks> = {};
const playbackCallbacks = Object.freeze<PlaybackCallbacks>({
  toggle: () => playbackHandlers.toggle?.(), toggleImmersive: () => playbackHandlers.toggleImmersive?.(),
  previous: () => playbackHandlers.previous?.(), next: () => playbackHandlers.next?.(),
  previousImmersive: () => playbackHandlers.previousImmersive?.(), nextImmersive: () => playbackHandlers.nextImmersive?.(),
  loop: () => playbackHandlers.loop?.(), shuffle: checked => playbackHandlers.shuffle?.(checked),
  seekStart: () => playbackHandlers.seekStart?.(), preview: value => playbackHandlers.preview?.(value),
  seek: value => playbackHandlers.seek?.(value), volume: value => playbackHandlers.volume?.(value),
  favorite: () => playbackHandlers.favorite?.(), addPlaylist: () => playbackHandlers.addPlaylist?.(),
  addPlaylistImmersive: () => playbackHandlers.addPlaylistImmersive?.(), openVideo: () => playbackHandlers.openVideo?.(),
  pages: () => playbackHandlers.pages?.(), skip: () => playbackHandlers.skip?.(),
  qualityToggle: toggleAudioQualityMenu, qualityKeydown: audioQualityButtonKeydown, qualityChoose: chooseAudioQuality,
  openImmersive: () => playbackHandlers.openImmersive?.(), closeImmersive: () => playbackHandlers.closeImmersive?.(),
  immersiveTransition: event => playbackHandlers.immersiveTransition?.(event), immersiveBackdrop: event => playbackHandlers.immersiveBackdrop?.(event),
  bindLyrics: candidate => playbackHandlers.bindLyrics?.(candidate), rejectLyrics: () => playbackHandlers.rejectLyrics?.(),
  bindManualLyrics: candidate => playbackHandlers.bindManualLyrics?.(candidate),
});
function installPlaybackCallbacks(callbacks: Partial<PlaybackCallbacks>): void { Object.assign(playbackHandlers, callbacks); }

export { installPlaybackCallbacks, playbackCallbacks, projectRootPlayback };
export type { PlaybackCallbacks, PlaybackControls };

function closeAudioQualityMenu(restoreFocus = false): void {
  document.removeEventListener("click", outsideQualityMenu, true);
  document.removeEventListener("keydown", qualityMenuKeydown, true);
  window.removeEventListener("resize", dismissQualityMenu);
  readApplicationStore().actions.playbackDisplay.setAudioQualityMenu(null);
  if (restoreFocus) playerQualityRefs.button?.focus({ preventScroll: true });
}
function dismissQualityMenu(): void { closeAudioQualityMenu(); }
function outsideQualityMenu(event: MouseEvent): void {
  if (event.target instanceof Node && !playerQualityRefs.button?.contains(event.target) && !playerQualityRefs.menu?.contains(event.target)) closeAudioQualityMenu();
}
function qualityMenuKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault(); event.stopPropagation(); closeAudioQualityMenu(true); return;
  }
  if (event.key === "Tab") { closeAudioQualityMenu(); return; }
  const items = [...(playerQualityRefs.menu?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? [])];
  const current = items.findIndex(item => item === document.activeElement);
  const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (offset || event.key === "Home" || event.key === "End") {
    event.preventDefault(); event.stopPropagation();
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + offset + items.length) % items.length;
    items[index]?.focus({ preventScroll: true });
  } else if ((event.key === "Enter" || event.key === " ") && current >= 0) {
    event.preventDefault(); event.stopPropagation();
    const quality = items[current]?.dataset.quality;
    if (quality === "highest" || quality === "192k" || quality === "132k" || quality === "64k") chooseAudioQuality(quality);
  }
}
function toggleAudioQualityMenu(): void {
  const store = readApplicationStore();
  if (store.getState().playbackDisplay.audioQualityMenu) { closeAudioQualityMenu(true); return; }
  if (!playerQualityRefs.button || !store.getState().playbackDisplay.currentTrack.hasCurrent) return;
  const rect = playerQualityRefs.button.getBoundingClientRect();
  store.actions.playbackDisplay.setAudioQualityMenu({ left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)), bottom: window.innerHeight - rect.top + 8 });
  document.addEventListener("click", outsideQualityMenu, true);
  document.addEventListener("keydown", qualityMenuKeydown, true);
  window.addEventListener("resize", dismissQualityMenu);
  playerQualityRefs.menu?.querySelector<HTMLButtonElement>("[aria-checked='true']")?.focus({ preventScroll: true });
}
function audioQualityButtonKeydown(event: KeyboardEvent): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault(); toggleAudioQualityMenu();
}
function chooseAudioQuality(quality: CommandContract.AudioQuality): void {
  readApplicationStore().actions.settings.setAudioQuality(quality);
  closeAudioQualityMenu(true);
}
