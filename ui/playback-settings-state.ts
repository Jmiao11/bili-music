import type { DeepReadonly } from "./state-store.ts";

function normalizePlaybackVolume(value: unknown): number {
  if (value === null || value === undefined || value === "") return 1;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, 0), 1) : 1;
}

function initialPlaybackSettingsState() {
  return { userVolume: 1, normalizationEnabled: false, normalizationGain: 1, targetVolume: 1, effectiveVolume: 1,
    view: { volumeVersion: 0, enabledVersion: 0, mediaVersion: 0 } };
}
type PlaybackSettingsSnapshot = DeepReadonly<ReturnType<typeof initialPlaybackSettingsState>>;
function effectivePlaybackVolume(state: PlaybackSettingsSnapshot): number {
  return normalizePlaybackVolume(state.userVolume * (state.normalizationEnabled ? state.normalizationGain : 1));
}
function createPlaybackSettingsActions(read: () => PlaybackSettingsSnapshot, commit: (state: PlaybackSettingsSnapshot) => void) {
  return {
    setUserVolume(value: unknown) {
      const state = read(), userVolume = normalizePlaybackVolume(value);
      const effectiveVolume = effectivePlaybackVolume({ ...state, userVolume });
      commit({ ...state, userVolume, effectiveVolume, targetVolume: effectiveVolume,
        view: { ...state.view, volumeVersion: state.view.volumeVersion + 1, mediaVersion: state.view.mediaVersion + 1 } });
    },
    setNormalizationEnabled(enabled: unknown) {
      const state = read();
      commit({ ...state, normalizationEnabled: enabled === true, view: { ...state.view, enabledVersion: state.view.enabledVersion + 1 } });
    },
    setGain(gain: unknown) {
      const state = read(), normalizationGain = normalizePlaybackVolume(gain);
      const targetVolume = effectivePlaybackVolume({ ...state, normalizationGain });
      commit({ ...state, normalizationGain, targetVolume });
    },
    applyEffectiveVolume(volume: number) {
      const state = read();
      commit({ ...state, effectiveVolume: volume, view: { ...state.view, mediaVersion: state.view.mediaVersion + 1 } });
    },
  };
}
export { createPlaybackSettingsActions, effectivePlaybackVolume, initialPlaybackSettingsState };
export type { PlaybackSettingsSnapshot };
