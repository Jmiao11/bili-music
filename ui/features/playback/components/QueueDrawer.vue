<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import type { QueueDrawerView } from "../queue-drawer-view.ts";
import type { queueDrawerCallbacks } from "../queue-drawer.ts";
import type { mainWindowRefs } from "../../../platform/main-window-refs.ts";
import type { DynamicBackgroundPresentation } from "../../settings/dynamic-background.ts";
import FloatingBackdrop from "../../settings/components/FloatingBackdrop.vue";
import QueueDrawerRow from "./QueueDrawerRow.vue";

const props = defineProps<{ model: QueueDrawerView; callbacks: typeof queueDrawerCallbacks; refs: typeof mainWindowRefs; background: DynamicBackgroundPresentation; theme: string | null; onGeometry: (element: HTMLElement) => () => void }>();
onBeforeUnmount(() => props.callbacks.dispose());
</script>
<template>
  <aside id="queue-drawer" :ref="element => refs.queueDrawer(element as HTMLElement | null)" role="dialog" aria-modal="false" aria-labelledby="queue-drawer-title" :hidden="model.stage.hidden" :aria-hidden="!model.stage.open" :inert="!model.stage.open" :class="{ 'is-open': model.stage.open }" :style="background.surfaces?.queue" :onTransitionend="model.stage.hidden ? undefined : callbacks.transition">
    <FloatingBackdrop v-if="model.stage.open && (theme === 'image' || theme === 'dynamic')" :model="background" :on-geometry="onGeometry" />
    <header><h2 id="queue-drawer-title">播放队列</h2><span>{{ model.count }}</span><button :ref="element => refs.queueDrawerClose(element as HTMLButtonElement | null)" class="tool-button" type="button" aria-label="关闭" :onClick="model.stage.hidden ? undefined : callbacks.close"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="m6 5 6 6 6-6 1 1-6 6 6 6-1 1-6-6-6 6-1-1 6-6-6-6Z" /></svg></button></header>
    <ul :ref="element => refs.queueDrawerList(element as HTMLUListElement | null)" class="queue-drawer-list"><QueueDrawerRow v-for="row in model.rows" :key="row.index + ':' + (row.entry.entryId ?? row.entry.bvid)" :row="row" :choose="callbacks.choose" /></ul>
  </aside>
</template>
