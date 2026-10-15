import type vm from "node:vm";
import { effectivePlaybackVolume } from "../../ui/playback-settings-state.ts";
import { createMediaAdapter } from "../../ui/media-adapter.ts";
import { renderPlaybackSettingsSnapshot } from "../../ui/playback-settings-view.ts";

function attachPlaybackVolumeVm(context: vm.Context): void {
  Object.assign(context, { effectivePlaybackVolume, createMediaAdapter, renderPlaybackSettingsSnapshot });
}
export { attachPlaybackVolumeVm };
