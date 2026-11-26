<script setup lang="ts">
import { RECENT_PLAY_TIME_MIN, TRACK_COLUMN_LIMITS } from "../track-column-state.ts";
import type { TrackColumnWidths } from "../track-column-state.ts";
import type { trackColumnCallbacks } from "../../../app/track-columns.ts";
defineProps<{ widths: Readonly<TrackColumnWidths>; drag: Readonly<{column:string|null}>; callbacks: typeof trackColumnCallbacks; list: string; playsLabel?: string }>();
const columns = [
  { name: "UP 主", key: "uploader", class: "column-uploader" },
  { name: "分P", key: "pages", class: "column-pages" },
  { name: "播放量", key: "plays", class: "column-play" },
  { name: "时长", key: "duration", class: "column-duration" },
] as const;
</script>
<template>
<div :id="`${list}-columns`" class="track-columns" @pointerdown="callbacks.pointerdown($event)" @keydown="callbacks.keydown($event)">
  <span aria-hidden="true">#</span><span aria-hidden="true"></span><span class="column-title" aria-hidden="true">标题</span>
  <span v-for="column in columns" :key="column.class" :class="column.class">
    <span aria-hidden="true">{{ column.key === "plays" ? playsLabel ?? column.name : column.name }}</span>
    <span class="column-resize" :class="{'is-column-dragging':drag.column === column.key}" title="拖动调整列宽,双击恢复默认" role="separator" aria-orientation="vertical" :aria-label="`调整${column.key === 'plays' ? playsLabel ?? column.name : column.name}列宽`" :aria-controls="list" :aria-valuenow="Math.max(widths[column.key], column.key === 'plays' && playsLabel ? RECENT_PLAY_TIME_MIN : 0)" :aria-valuemin="column.key === 'plays' && playsLabel ? RECENT_PLAY_TIME_MIN : TRACK_COLUMN_LIMITS[column.key][0]" :aria-valuemax="TRACK_COLUMN_LIMITS[column.key][1]" :data-track-column="column.key" tabindex="0"></span>
  </span><span class="column-spacer" aria-hidden="true"></span><span aria-hidden="true"></span>
</div>
</template>
