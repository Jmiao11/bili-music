import type vm from "node:vm";
import { effectivePlaybackVolume } from "../../ui/features/playback/playback-settings-state.ts";
import { createMediaAdapter } from "../../ui/platform/media-adapter.ts";
import { renderPlaybackSettingsSnapshot } from "../../ui/features/playback/playback-settings-view.ts";

function attachPlaybackVolumeVm(context: vm.Context): void {
  Object.assign(context, { effectivePlaybackVolume, createMediaAdapter, renderPlaybackSettingsSnapshot });
}
export { attachPlaybackVolumeVm };
