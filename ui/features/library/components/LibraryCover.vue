<script setup lang="ts">
import type { TrackRowModel } from "../../tracks/track-list-model.ts";
import { displayThumbnailUrl } from "../../../shared/track-utils.ts";

defineProps<{ rows: readonly TrackRowModel[] }>();
</script>

<template>
  <div class="playlist-art-grid" aria-hidden="true">
    <template v-if="rows.length">
      <span v-for="index in 4" :key="index">
        <img v-if="rows[index - 1]?.video.thumbnailUrl" :src="displayThumbnailUrl(rows[index - 1].video.thumbnailUrl)" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false" />
      </span>
    </template>
  </div>
</template>
