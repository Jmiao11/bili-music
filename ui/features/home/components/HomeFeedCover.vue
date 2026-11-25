<script setup lang="ts">
import { homeTrackThumbnail } from "../../../shared/track-utils.ts";
defineProps<{ title: string; thumbnail: string; badge?: string }>();
</script>

<template>
  <span class="home-feed-cover" aria-hidden="true">
    <img v-if="thumbnail" :key="thumbnail" :src="homeTrackThumbnail(thumbnail)" alt="" referrerpolicy="no-referrer" />
    <span class="home-feed-badge">{{ badge ?? "每日更新" }}</span>
    <span class="home-feed-cover-title">{{ title }}</span>
  </span>
</template>
