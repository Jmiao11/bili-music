<script setup lang="ts">
import type {PageCallbacks} from '../../../app/root-controls.ts';
defineProps<{tids:number;sort:string;active:boolean;callbacks:PageCallbacks}>();
</script>
<template>
              <div class="search-tabs-row">
                <div class="search-tabs-groups">
                  <span class="search-filter-label" aria-hidden="true">分区</span>
                  <div id="music-tabs" class="music-tabs search-tab-group" role="tablist" aria-label="音乐分区">
                    <button class="music-tab" type="button" role="tab" data-tids="3" :tabindex="tids === 3 ? 0 : -1" :aria-selected="tids === 3" :class="{ 'is-active': tids === 3 }" @click="callbacks.division('3')">全部</button>
                    <button class="music-tab" type="button" role="tab" data-tids="28" :tabindex="tids === 28 ? 0 : -1" :aria-selected="tids === 28" :class="{ 'is-active': tids === 28 }" @click="callbacks.division('28')">原创</button>
                    <button class="music-tab" type="button" role="tab" data-tids="31" :tabindex="tids === 31 ? 0 : -1" :aria-selected="tids === 31" :class="{ 'is-active': tids === 31 }" @click="callbacks.division('31')">翻唱</button>
                  </div>
                  <span class="search-filter-label" aria-hidden="true">类型</span>
                  <div id="search-sort-modes" class="music-tabs search-tab-group" role="tablist" aria-label="搜索类型">
                    <button class="music-tab" type="button" role="tab" data-sort-mode="all" :tabindex="sort === 'all' ? 0 : -1" :aria-selected="sort === 'all'" :class="{ 'is-active': sort === 'all' }" :onClick="active ? () => callbacks.sort('all') : undefined">全部</button>
                    <button class="music-tab" type="button" role="tab" data-sort-mode="single" :tabindex="sort === 'single' ? 0 : -1" :aria-selected="sort === 'single'" :class="{ 'is-active': sort === 'single' }" @click="callbacks.sort('single')">单曲</button>
                    <button class="music-tab" type="button" role="tab" data-sort-mode="collection" :tabindex="sort === 'collection' ? 0 : -1" :aria-selected="sort === 'collection'" :class="{ 'is-active': sort === 'collection' }" @click="callbacks.sort('collection')">合集</button>
                  </div>
                </div>
              </div>


</template>
