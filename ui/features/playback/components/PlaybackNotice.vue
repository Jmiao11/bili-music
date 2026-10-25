<script setup lang="ts">
import FloatingBackdrop from "../../settings/components/FloatingBackdrop.vue";
import type {DynamicBackgroundPresentation} from "../../settings/dynamic-background.ts";
import { projectPlaybackMessages } from "../playback-messages-projection.ts";
import type { PlaybackMessagesSnapshot } from "../playback-messages-state.ts";
const props = defineProps<{ messages: PlaybackMessagesSnapshot;theme?:string|null;background?:DynamicBackgroundPresentation;onGeometry?:(element:HTMLElement)=>()=>void;surfaceStyle?:Readonly<Record<string,string>>; prompt: { bvid: string; summary: CommandContract.CollectionSummary } | null; onExpand: () => void }>();
const model = () => projectPlaybackMessages(props.messages);
</script>
<template>
  <p id="playback-notice" class="playback-notice" :class="{ 'is-visible': model().visible || !!prompt, 'has-action': !!prompt }" :data-kind="model().kind ?? undefined" :style="[surfaceStyle, model().x === null ? undefined : { '--playback-notice-x': `${model().x}px` }]" role="status" aria-live="polite"><FloatingBackdrop v-if="(model().visible || prompt) && background && (theme === 'image' || theme === 'dynamic')" :model="background" :on-geometry="onGeometry" /><template v-if="prompt">该视频属于共 {{ prompt.summary.total }} 个视频的合集「{{ prompt.summary.title }}」 <button type="button" class="secondary-button" @click="onExpand">展开合集</button></template><template v-else>{{ model().notice }}</template></p>
</template>
