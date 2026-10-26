<script setup lang="ts">
import DynamicBackground from "../../features/settings/components/DynamicBackground.vue";
import type {MiniView,MiniCallbacks} from "../view-model.ts";
defineProps<{view:MiniView;callbacks:MiniCallbacks}>();
</script>
<template>
<main id="mini-drag-region" class="mini-shell" :data-image-scheme="view.snapshot.theme === 'image' ? view.snapshot.imageScheme ?? 'dark' : undefined" :data-image-mode="view.snapshot.theme === 'image' ? ((view.snapshot.backgroundDim ?? 90) < 40 ? 'adaptive' : 'uniform') : undefined" :style="{'--mini-background':view.backgroundUrl ? `url(&quot;${view.backgroundUrl}&quot;)` : undefined,'--background-dim':String((view.snapshot.backgroundDim ?? 90) / 100),'--dynamic-color-1':view.snapshot.dynamicColors?.[0],'--dynamic-color-2':view.snapshot.dynamicColors?.[1],'--dynamic-color-3':view.snapshot.dynamicColors?.[2]}" @pointerdown="callbacks.drag" aria-label="迷你播放器">
      <DynamicBackground v-if="view.snapshot.theme === 'dynamic' && view.background" :model="view.background" />
      <div class="mini-track">
        <img id="mini-cover" class="mini-cover" alt="" width="40" height="40" :src="view.snapshot.thumbnailUrl || undefined" :hidden="!view.snapshot.thumbnailUrl" referrerpolicy="no-referrer" />
        <div class="mini-copy">
          <div id="mini-title-viewport" class="mini-title-viewport" :class="{'has-scrolling-title': view.scrolling}">
            <strong id="mini-title" class="mini-title" :class="{'is-scrolling': view.scrolling}" :title="view.hasSnapshot ? view.snapshot.title || '尚未播放' : undefined" :style="{'--mini-title-distance':view.distance || undefined,'--mini-title-duration':view.duration || undefined}">{{ view.snapshot.title || "尚未播放" }}</strong>
          </div>
        </div>
        <button id="mini-restore" @click="callbacks.restore" class="mini-icon-button mini-restore" type="button" aria-label="还原主窗口" title="还原主窗口">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H4v4h2V7.4l3.3 3.3 1.4-1.4L7.4 6H8Zm4 12h4v-4h-2v.6l-3.3-3.3-1.4 1.4 3.3 3.3H12Z" /></svg>
        </button>
      </div>
      <div class="mini-controls" aria-label="播放控制">
        <button id="mini-previous" @click="callbacks.command('previous')" class="mini-icon-button" type="button" aria-label="上一首" title="上一首" :disabled="!view.snapshot.canPrevious">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6Zm3 7 9-7v14Z" /></svg>
        </button>
        <button id="mini-play-pause" @click="callbacks.command('toggle_play')" class="mini-icon-button mini-play-button" type="button"  :data-playing="view.hasSnapshot ? String(Boolean(view.snapshot.isPlaying)) : undefined" :aria-label="view.snapshot.isPlaying ? '暂停' : '播放'" title="播放/暂停" :disabled="!view.snapshot.hasCurrent">
          <svg class="mini-icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l9.6-6.4a1 1 0 0 0 0-1.7l-9.6-6.4A1 1 0 0 0 8 5.6Z" /></svg>
          <svg class="mini-icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
        </button>
        <button id="mini-next" @click="callbacks.command('next')" class="mini-icon-button" type="button" aria-label="下一首" title="下一首" :disabled="!view.snapshot.canNext">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2ZM15 12 6 5v14Z" /></svg>
        </button>
        <button id="mini-favorite" @click="callbacks.command('toggle_favorite')" class="mini-icon-button mini-favorite" :class="{'is-favorited': Boolean(view.snapshot.isFavorited)}" type="button" :aria-label="view.snapshot.isFavorited ? '取消收藏' : '收藏'" title="收藏" :disabled="!view.snapshot.hasCurrent">
          <svg class="mini-icon-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.2 10.7 20C5.4 15.2 2 12.2 2 8.4A5.4 5.4 0 0 1 7.5 3c1.8 0 3.5.8 4.5 2.1A5.6 5.6 0 0 1 16.5 3 5.4 5.4 0 0 1 22 8.4c0 3.8-3.4 6.8-8.7 11.6Z" /></svg>
        </button>
      </div>
      <p id="mini-notice" role="status" aria-live="polite" :hidden="!view.snapshot.notice">{{ view.snapshot.notice || "" }}</p>
      <button id="mini-notice-more" class="mini-notice-more" type="button" aria-controls="mini-notice-full" @click="callbacks.more" :aria-expanded="view.expanded" :hidden="!view.snapshot.notice">全文</button>
      <div id="mini-notice-full" class="mini-notice-full" role="region" aria-label="提醒全文" tabindex="0" @keydown="callbacks.noticeKey" :hidden="!view.expanded">{{ view.expanded ? view.snapshot.notice || "" : "" }}</div>
    </main>
</template>
