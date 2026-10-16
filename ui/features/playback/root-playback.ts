import type { ApplicationSnapshot } from "../../store/application-store.ts";
import { projectPlaybackControls } from "./playback-display-view.ts";
import type { LyricsCandidate } from "../immersive/lyrics-display-state.ts";

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
  openImmersive: () => playbackHandlers.openImmersive?.(), closeImmersive: () => playbackHandlers.closeImmersive?.(),
  immersiveTransition: event => playbackHandlers.immersiveTransition?.(event), immersiveBackdrop: event => playbackHandlers.immersiveBackdrop?.(event),
  bindLyrics: candidate => playbackHandlers.bindLyrics?.(candidate), rejectLyrics: () => playbackHandlers.rejectLyrics?.(),
  bindManualLyrics: candidate => playbackHandlers.bindManualLyrics?.(candidate),
});
function installPlaybackCallbacks(callbacks: Partial<PlaybackCallbacks>): void { Object.assign(playbackHandlers, callbacks); }

export { installPlaybackCallbacks, playbackCallbacks, projectRootPlayback };
export type { PlaybackCallbacks, PlaybackControls };
