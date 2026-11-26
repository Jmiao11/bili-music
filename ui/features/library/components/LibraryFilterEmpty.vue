<script setup lang="ts">
defineProps<{query: string; clear: () => void}>();
</script>
<template>
  <div class="library-filter-empty">
    <p role="status">没有找到与“{{ query }}”相关的歌曲</p>
    <button type="button" class="secondary-button" @click="clear">清除搜索</button>
  </div>
</template>
