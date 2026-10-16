<script setup lang="ts">
import { projectPlaybackMessages } from "../playback-messages-projection.ts";
import type { PlaybackMessagesSnapshot } from "../playback-messages-state.ts";
const props = defineProps<{ messages: PlaybackMessagesSnapshot }>();
const model = () => projectPlaybackMessages(props.messages);
</script>
<template>
  <p id="playback-notice" class="playback-notice" :class="{ 'is-visible': model().visible }" :data-kind="model().kind ?? undefined" :style="model().x === null ? undefined : { '--playback-notice-x': `${model().x}px` }" role="status" aria-live="polite">{{ model().notice }}</p>
</template>
