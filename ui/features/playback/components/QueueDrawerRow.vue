<script setup lang="ts">
import type { QueueDrawerRow } from "../queue-drawer-view.ts";
import { displayThumbnailUrl, formatDuration } from "../../../shared/track-utils.ts";
import Icon from "../../../app/components/Icon.vue";
defineProps<{ row: QueueDrawerRow; index: number; expanded: boolean; toggle: (row: QueueDrawerRow) => void; choose: (index: number) => void }>();
</script>
<template>
  <button type="button" class="queue-track" :data-queue-index="index" :aria-current="row.active ? 'true' : undefined" @click="choose(index)">
    <template v-if="row.entry.collection"><span class="queue-title">{{ row.entry.title }}</span><span class="queue-meta">合集 {{ row.entry.collection.data.videoCount }}</span></template>
    <template v-else>
      <span class="queue-number">{{ index + 1 }}</span>
      <img draggable="false" v-if="row.entry.thumbnailUrl" :src="displayThumbnailUrl(row.entry.thumbnailUrl)" alt="" loading="lazy" referrerpolicy="no-referrer" /><span v-else class="queue-cover"></span>
      <span class="queue-text"><span class="queue-title">{{ row.entry.title }}</span><span class="queue-meta">{{ row.entry.uploader }}</span></span>
      <span class="queue-meta">{{ formatDuration(row.entry.durationSeconds) }}</span>
    </template>
  </button>
  <button v-if="row.entry.collection" type="button" class="tool-button queue-expand" aria-label="展开或收起合集" :aria-expanded="expanded" @click="toggle(row)"><Icon name="chevronDown" :size="16" /></button>
</template>
