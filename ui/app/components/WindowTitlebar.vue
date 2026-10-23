<script setup lang="ts">
defineProps<{maximized:boolean|null;status:string;error:boolean}>();
</script>
<template>
<header class="window-titlebar" aria-label="窗体标题栏">
      <div class="window-titlebar-brand">
        <span class="window-titlebar-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v11.2a3 3 0 1 1-2-2.83V7.1l-6 1.2V17a3 3 0 1 1-2-2.83Z" /></svg>
        </span>
        <span class="window-titlebar-name">Bili Music</span>
      </div>
      <div class="window-titlebar-spacer"></div>
      <p id="status" class="player-status titlebar-status" :class="{'is-error':error}" role="status">{{ status }}</p>
      <div class="window-utility-controls">
        <button id="mini-player-button" class="window-control-button" type="button" aria-label="迷你播放器" title="迷你播放器">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-4v1.2h2v1.3h-7v-1.3h2V10.5h-4Zm1.5 1.3v4.4h7V4.8Z" /></svg>
        </button>
        <div class="window-controls" aria-label="窗口控制">
          <button id="window-minimize-button" class="window-control-button" type="button" aria-label="最小化" title="最小化">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10v1.4H3Z" /></svg>
          </button>
          <button id="window-maximize-button" class="window-control-button" type="button" :aria-label="maximized ? '还原' : '最大化'" :title="maximized ? '还原' : '最大化'">
            <svg class="window-icon-maximize" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4h8v8H4Zm1.4 1.4v5.2h5.2V5.4Z" /></svg>
            <svg class="window-icon-restore" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5h7v7H11v-5H5.5Zm-2 3h7v6h-7Zm1.4 1.4v3.2h4.2V7.9Z" /></svg>
          </button>
          <button id="window-close-button" class="window-control-button window-control-close" type="button" aria-label="关闭" title="关闭">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.2 3.2 3.8 3.8 3.8-3.8 1 1L9 8l3.8 3.8-1 1L8 9 4.2 12.8l-1-1L7 8 3.2 4.2Z" /></svg>
          </button>
        </div>
      </div>
    </header>
</template>
