<script setup lang="ts">
import { TRACK_COLUMN_LIMITS } from "../track-column-state.ts";
import type { TrackColumnWidths } from "../track-column-state.ts";
import type { trackColumnCallbacks } from "../../../app/track-columns.ts";
defineProps<{ widths: Readonly<TrackColumnWidths>; drag: Readonly<{column:string|null}>; callbacks: typeof trackColumnCallbacks; list: string }>();
const columns = [
  { name: "UP 主", key: "uploader", class: "column-uploader" },
  { name: "分P", key: null, class: "column-pages" },
  { name: "播放量", key: "plays", class: "column-play" },
  { name: "时长", key: "duration", class: "column-duration" },
] as const;
</script>
<template>
<div :id="`${list}-columns`" class="track-columns" @pointerdown="callbacks.pointerdown($event)" @keydown="callbacks.keydown($event)">
  <span aria-hidden="true">#</span><span aria-hidden="true"></span><span aria-hidden="true">标题</span>
  <span v-for="column in columns" :key="column.class" :class="column.class">
    <span aria-hidden="true">{{ column.name }}</span>
    <span v-if="column.key" class="column-resize" :class="{'is-column-dragging':drag.column === column.key}" role="separator" aria-orientation="vertical" :aria-label="`调整${column.name}列宽`" :aria-controls="list" :aria-valuenow="widths[column.key]" :aria-valuemin="TRACK_COLUMN_LIMITS[column.key][0]" :aria-valuemax="TRACK_COLUMN_LIMITS[column.key][1]" :data-track-column="column.key" tabindex="0"></span>
  </span><span aria-hidden="true"></span>
</div>
</template>
