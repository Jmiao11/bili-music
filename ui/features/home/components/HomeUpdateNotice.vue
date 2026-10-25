<script setup lang="ts">
import type { HomeSnapshot } from "../../../store/app-state.ts";
defineProps<{ model: HomeSnapshot["update"]; onOpen: () => void }>();
</script>

<template>
  <div class="home-update-notice">
    <button v-if="model.version" id="home-update-button" class="home-update-button" type="button" :disabled="model.opening" title="在系统浏览器打开 GitHub 发布页，下载最新版本" @click="onOpen">
      <span>{{ model.opening ? '正在打开…' : model.error ? '打开失败，点击重试' : `发现新版本 v${model.version}` }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <span id="home-update-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ model.opening || !model.version ? '' : model.error ? '无法打开 GitHub 发布页，请点击更新提示重试。' : `发现新版本 v${model.version}，可前往 GitHub 发布页下载。` }}</span>
  </div>
</template>
