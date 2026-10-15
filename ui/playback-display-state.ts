import type { DeepReadonly } from "./state-store.ts";

type PlaybackMediaObservation = { currentTime: number; duration: number; paused: boolean; ended: boolean; playbackRate: number };
type PlaybackSessionTrack = { hasCurrent: boolean; title: string; uploader: string; thumbnailUrl: string };
function initialPlaybackDisplayState() {
  return { currentTime: 0, duration: NaN, paused: true, ended: false, playbackRate: 1, isPlaying: false, buttonPlaying: false, isSeeking: false,
    renderedTrack: { title: "尚未播放", uploader: "—", thumbnailUrl: "" },
    currentTrack: { bvid: "", title: "尚未播放", uploader: "—", thumbnailUrl: "", durationSeconds: 0, hasCurrent: false },
    progress: { position: 0, duration: 0 }, track: null as PlaybackSessionTrack | null,
    presentation: { duration: "0:00", restoredPosition: null as number | null, restoredMax: 0,
      immersiveHidden: true, immersiveOpen: false, thumbnailSet: false },
    sessionState: "none" as "none" | "paused" | "playing",
    position: null as { duration: number; playbackRate: number; position: number } | null,
    view: { progressVersion: 0, buttonVersion: 0, trackVersion: 0, sessionVersion: 0, positionVersion: 0 } };
}
type PlaybackDisplaySnapshot = DeepReadonly<ReturnType<typeof initialPlaybackDisplayState>>;
function createPlaybackDisplayActions(read: () => PlaybackDisplaySnapshot, commit: (state: PlaybackDisplaySnapshot) => void) {
  const observed = (media: PlaybackMediaObservation) => ({ ...read(), ...media, isPlaying: !media.paused && !media.ended });
  return {
    setTrackDuration(durationText: string) {
      const state = read(); commit({ ...state, presentation: { ...state.presentation, duration: durationText } });
    },
    restoreProgress(position: number, max: number, durationText: string) {
      const state = read(); commit({ ...state, presentation: { ...state.presentation, duration: durationText, restoredPosition: position, restoredMax: max } });
    },
    showImmersive() {
      const state = read(); commit({ ...state, presentation: { ...state.presentation, immersiveHidden: false } });
    },
    setImmersiveOpen(immersiveOpen: boolean) {
      const state = read(); commit({ ...state, presentation: { ...state.presentation, immersiveOpen } });
    },
    hideImmersive() {
      const state = read(); commit({ ...state, presentation: { ...state.presentation, immersiveHidden: true } });
    },
    setRenderedTrack(track: { title: string; uploader: string; thumbnailUrl: string }) {
      commit({ ...read(), presentation: { ...read().presentation, thumbnailSet: true }, renderedTrack: { title: track.title, uploader: track.uploader, thumbnailUrl: track.thumbnailUrl } });
    },
    setCurrentTrack(track: Partial<PlaybackDisplaySnapshot["currentTrack"]>) {
      const before = read(), next = { ...before.currentTrack, ...track };
      commit({ ...before, currentTrack: { bvid: next.bvid, title: next.title, uploader: next.uploader, thumbnailUrl: next.thumbnailUrl, durationSeconds: next.durationSeconds, hasCurrent: next.hasCurrent } });
    },
    observeMedia(media: PlaybackMediaObservation) { commit(observed(media)); },
    setSeeking(isSeeking: boolean) { commit({ ...read(), isSeeking }); },
    observeProgress(media: PlaybackMediaObservation, value: number | string = media.currentTime) {
      const state = observed(media), mediaDuration = Number.isFinite(media.duration) ? media.duration : 0;
      const position = Math.min(Math.max(Number(value) || 0, 0), mediaDuration || 0);
      commit({ ...state, progress: { position, duration: mediaDuration },
        presentation: { ...state.presentation, duration: formatPlaybackTime(mediaDuration), restoredPosition: null },
        view: { ...state.view, progressVersion: state.view.progressVersion + 1 } });
    },
    observePlaying(media: PlaybackMediaObservation) {
      const state = observed(media);
      commit({ ...state, buttonPlaying: state.isPlaying, view: { ...state.view, buttonVersion: state.view.buttonVersion + 1 } });
    },
    setTrack(track: PlaybackSessionTrack | null | undefined) {
      const state = read();
      commit({ ...state, track: track?.hasCurrent ? { hasCurrent: track.hasCurrent, title: track.title, uploader: track.uploader, thumbnailUrl: track.thumbnailUrl } : null,
        view: { ...state.view, trackVersion: state.view.trackVersion + 1 } });
    },
    setSessionState(sessionState: "none" | "paused" | "playing") {
      const state = read(); commit({ ...state, sessionState, view: { ...state.view, sessionVersion: state.view.sessionVersion + 1 } });
    },
    observePosition(media: PlaybackMediaObservation) {
      const state = observed(media);
      if (!Number.isFinite(media.duration) || media.duration <= 0) { commit(state); return; }
      const position = { duration: media.duration, playbackRate: Number.isFinite(media.playbackRate) && media.playbackRate > 0 ? media.playbackRate : 1,
        position: Math.min(Math.max(media.currentTime, 0), media.duration) };
      commit({ ...state, position, view: { ...state.view, positionVersion: state.view.positionVersion + 1 } });
    },
  };
}
function formatPlaybackTime(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const hours = Math.floor(safe / 3600), minutes = Math.floor((safe % 3600) / 60), seconds = safe % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
export { createPlaybackDisplayActions, formatPlaybackTime, initialPlaybackDisplayState };
export type { PlaybackDisplaySnapshot, PlaybackMediaObservation, PlaybackSessionTrack };
