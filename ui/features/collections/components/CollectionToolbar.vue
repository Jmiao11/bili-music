<script setup lang="ts">
import type { CollectionSnapshot } from "../collection-state.ts";
import type { collectionCallbacks } from "../collection-port.ts";
defineProps<{ state: CollectionSnapshot; favorited: boolean; callbacks: typeof collectionCallbacks }>();
function dateLabel(timestamp: string): string {
  const date = new Date(Number(timestamp));
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString("zh-CN");
}
</script>
<template>
  <div class="home-actions">
    <button class="secondary-button" type="button" :disabled="state.loading" @click="callbacks.refresh">刷新合集</button>
    <button class="secondary-button" type="button" :disabled="state.loading || !state.fullSnapshot" @click="callbacks.favorite">{{ favorited ? '取消收藏合集' : '收藏合集' }}</button>
    <button class="secondary-button" type="button" :disabled="state.loading || !state.fullSnapshot" @click="callbacks.add">加入歌单</button>
    <button class="secondary-button" type="button" :disabled="state.loading || !state.fullSnapshot" @click="callbacks.addAll">全部加入歌单（拆成单曲）</button>
  </div>
  <p v-if="state.fullSnapshot" class="search-status">{{ state.usingSnapshot ? '本地快照 · ' : '' }}更新于 {{ dateLabel(state.fullSnapshot.snapshot.fetchedAt) }}</p>
  <label v-if="state.usingSnapshot && state.fullSnapshot" class="library-name-field">
    <span>来源无法校验时，可明确选择另一成员再试</span>
    <select :disabled="state.loading" :value="state.source?.kind === 'collection' ? state.source.bvid : ''" @change="callbacks.chooseAnchor(($event.target as HTMLSelectElement).value)">
      <option v-for="video in state.fullSnapshot.snapshot.items" :key="video.bvid" :value="video.bvid">{{ video.title }} · {{ video.bvid }}</option>
    </select>
  </label>
</template>
