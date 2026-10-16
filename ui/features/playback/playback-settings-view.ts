import type { PlaybackSettingsSnapshot } from "./playback-settings-state.ts";

function renderPlaybackSettingsSnapshot(state: PlaybackSettingsSnapshot, previous: PlaybackSettingsSnapshot | null, bindings: {
  setMediaVolume(volume: number): void;
  setVolumeControl(volume: number): void;
  setNormalizationControl(enabled: boolean): void;
}): void {
  if (state.view.mediaVersion && state.view.mediaVersion !== previous?.view.mediaVersion) bindings.setMediaVolume(state.effectiveVolume);
  if (state.view.volumeVersion && state.view.volumeVersion !== previous?.view.volumeVersion) bindings.setVolumeControl(state.userVolume);
  if (state.view.enabledVersion && state.view.enabledVersion !== previous?.view.enabledVersion) bindings.setNormalizationControl(state.normalizationEnabled);
}
export { renderPlaybackSettingsSnapshot };
