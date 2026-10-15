import { projectPlaybackProgress, renderPlaybackMediaSession } from "../../ui/playback-display-view.ts";
import type { PlaybackDisplaySnapshot, PlaybackSessionTrack } from "../../ui/playback-display-state.ts";

type PlaybackDisplayDom = { progressSlider: HTMLInputElement; immersiveProgressSlider: HTMLInputElement;
  currentTimeLabel: HTMLElement; durationLabel: HTMLElement; immersiveCurrentTimeLabel: HTMLElement; immersiveDurationLabel: HTMLElement;
  playPauseButton: HTMLButtonElement; immersivePlayPauseButton: HTMLButtonElement };
function renderPlaybackDisplaySnapshot(state: PlaybackDisplaySnapshot, previous: PlaybackDisplaySnapshot | null, dom: PlaybackDisplayDom, bindings: {
  formatTime(value: number): string;
  setTrack(track: PlaybackSessionTrack | null): void;
  setPlaybackState(state: "none" | "paused" | "playing"): void;
  setPosition(position: NonNullable<PlaybackDisplaySnapshot["position"]>): void;
}): void {
  if (state.view.progressVersion && state.view.progressVersion !== previous?.view.progressVersion) {
    const projected = projectPlaybackProgress(state);
    const { value: position, max: mediaDuration, progress } = projected;
    for (const slider of [dom.progressSlider, dom.immersiveProgressSlider]) {
      slider.max = String(mediaDuration || 0); slider.value = String(position); slider.style.setProperty("--progress", progress);
    }
    dom.currentTimeLabel.textContent = bindings.formatTime(position); dom.durationLabel.textContent = bindings.formatTime(mediaDuration);
    dom.immersiveCurrentTimeLabel.textContent = bindings.formatTime(position); dom.immersiveDurationLabel.textContent = bindings.formatTime(mediaDuration);
  }
  if (state.view.buttonVersion && state.view.buttonVersion !== previous?.view.buttonVersion) {
    for (const button of [dom.playPauseButton, dom.immersivePlayPauseButton]) {
      button.dataset.playing = String(state.isPlaying); button.setAttribute("aria-label", state.isPlaying ? "暂停" : "播放");
    }
  }
  renderPlaybackMediaSession(state, previous, bindings);
}
export { renderPlaybackDisplaySnapshot };
export type { PlaybackDisplayDom };
