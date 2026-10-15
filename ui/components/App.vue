<script setup lang="ts">
import LegacyShell from "./LegacyShell.vue";
import type { ApplicationSnapshot } from "../application-store.ts";
import type { PlaybackCallbacks, PlaybackControls } from "../root-playback.ts";
import type { RootLists } from "../root-lists.ts";

defineProps<{ snapshot: ApplicationSnapshot; callbacks: PlaybackCallbacks; playback: PlaybackControls; lists: RootLists }>();
</script>

<template><LegacyShell :lists="lists" :snapshot="snapshot" :playback="playback" :callbacks="callbacks" /></template>
