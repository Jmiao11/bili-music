<script setup lang="ts">
import { isPageDisabled } from "../page-selection.ts";
import { formatDuration } from "../../../shared/track-utils.ts";
import type { PagesSnapshot } from "../pages-state.ts";
import type { LibrarySnapshot } from "../../library/library-state.ts";

const props = defineProps<{
  readonly modal: NonNullable<PagesSnapshot["modal"]>;
  readonly disabledPages: LibrarySnapshot["disabledPages"];
  readonly pending: LibrarySnapshot["disabledPagePending"];
  readonly currentBvid: string | null;
  readonly currentCid: number | null;
  readonly onPlay: (page: Readonly<CommandContract.VideoPage>) => void;
  readonly onToggle: (bvid: string, cid: number, disabled: boolean) => Promise<void>;
}>();
function current(page: Readonly<CommandContract.VideoPage>): boolean {
  return props.currentBvid?.toLowerCase() === props.modal.video.bvid.toLowerCase() && props.currentCid === page.cid;
}
function disabled(page: Readonly<CommandContract.VideoPage>): boolean {
  return isPageDisabled(props.disabledPages, props.modal.video.bvid, page.cid);
}
function saving(): boolean { return props.pending.has(props.modal.video.bvid.toLowerCase()); }
function busy(page: Readonly<CommandContract.VideoPage>): boolean {
  const cid = props.pending.get(props.modal.video.bvid.toLowerCase());
  return saving() && (cid === null || cid === page.cid);
}
function icon(page: Readonly<CommandContract.VideoPage>): string {
  return disabled(page)
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 18.4 18.4 5.6"/></svg>';
}
</script>

<template>
  <li v-for="page in props.modal.pages" :key="page.cid" v-bind="disabled(page) ? { class: 'is-disabled' } : {}"><button type="button" :class="current(page) ? 'pages-list-button is-current' : 'pages-list-button'" :aria-current="current(page) ? 'true' : undefined" @click="props.onPlay(page)">{{ `${page.page} · ${page.part || `第 ${page.page} P`} · ${formatDuration(page.durationSeconds)}${current(page) ? ' · 当前' : ''}` }}</button><button type="button" class="pages-disable-button" :title="disabled(page) ? '恢复' : '不想听'" :aria-label="disabled(page) ? '恢复' : '不想听'" :disabled="saving()" :aria-busy="busy(page) ? 'true' : 'false'" @click.stop="props.onToggle(props.modal.video.bvid, page.cid, !disabled(page))" v-html="icon(page)"></button></li>
</template>
