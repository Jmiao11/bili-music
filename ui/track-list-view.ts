import PlaylistList from "./components/PlaylistList.vue";
import TrackList from "./components/TrackList.vue";
import { createSyncRegion } from "./vue/sync-region.ts";
import type { PlaylistRowModel, TrackRowModel } from "./track-list-model.ts";

let trackListRegions: WeakMap<HTMLElement, ReturnType<typeof createSyncRegion>> | null = null;
function renderTrackList(host: HTMLElement, rows: readonly TrackRowModel[], skeleton: boolean): void {
  let region = trackListRegions?.get(host);
  if (!skeleton && rows.length === 0) {
    if (region) { region.unmount(); trackListRegions?.delete(host); }
    return;
  }
  if (!region) { host.replaceChildren(); region = createSyncRegion(host, TrackList); (trackListRegions ??= new WeakMap()).set(host, region); }
  region.update({ rows, skeleton });
}
function renderPlaylistList(host: HTMLElement, rows: readonly PlaylistRowModel[]): void {
  let region = trackListRegions?.get(host);
  if (rows.length === 0) { if (region) { region.unmount(); trackListRegions?.delete(host); } return; }
  if (!region) { host.replaceChildren(); region = createSyncRegion(host, PlaylistList); (trackListRegions ??= new WeakMap()).set(host, region); }
  region.update({ rows });
}
export { renderPlaylistList, renderTrackList };
