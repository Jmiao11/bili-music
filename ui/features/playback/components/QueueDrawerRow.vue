<script setup lang="ts">
import { ref } from "vue";
import type { QueueDrawerRow } from "../queue-drawer-view.ts";
import { displayThumbnailUrl, formatDuration } from "../../../shared/track-utils.ts";
import Icon from "../../../app/components/Icon.vue";
const props = defineProps<{ row: QueueDrawerRow; choose: (index: number) => void }>();
const expanded = ref<boolean | null>(null);
const isExpanded = () => expanded.value ?? props.row.active;
</script>
<template>
  <li :class="{ 'queue-group': row.entry.collection }">
    <div class="queue-parent" :class="{ 'is-current': row.active }">
      <button type="button" class="queue-track" :data-queue-index="row.index" :aria-current="row.active ? 'true' : undefined" @click="choose(row.index)">
        <template v-if="row.entry.collection"><span class="queue-title">{{ row.entry.title }}</span><span class="queue-meta">合集 {{ row.entry.collection.data.videoCount }}</span></template>
        <template v-else>
          <span class="queue-number">{{ row.index + 1 }}</span>
          <img v-if="row.entry.thumbnailUrl" :src="displayThumbnailUrl(row.entry.thumbnailUrl)" alt="" loading="lazy" referrerpolicy="no-referrer" /><span v-else class="queue-cover"></span>
          <span class="queue-text"><span class="queue-title">{{ row.entry.title }}</span><span class="queue-meta">{{ row.entry.uploader }}</span></span>
          <span class="queue-meta">{{ formatDuration(row.entry.durationSeconds) }}</span>
        </template>
      </button>
      <button v-if="row.entry.collection" type="button" class="tool-button queue-expand" aria-label="展开或收起合集" :aria-expanded="isExpanded()" @click="expanded = !isExpanded()"><Icon name="chevronDown" :size="16" /></button>
    </div>
    <ul v-if="row.entry.collection && isExpanded()" class="queue-members">
      <li v-for="(member, index) in row.entry.collection.data.snapshot.items" :key="member.bvid" :class="{ 'is-current': row.active && !row.entry.collection.historyTrack && index === row.entry.collection.memberIndex }"><span class="queue-title">{{ member.title }}</span></li>
      <li v-if="row.active && row.entry.collection.historyTrack" class="is-current"><span class="queue-title">{{ row.entry.collection.historyTrack.title }}</span></li>
    </ul>
  </li>
</template>
