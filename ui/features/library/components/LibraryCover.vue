<script setup lang="ts">
import { computed } from "vue";
import type { TrackRowModel } from "../../tracks/track-list-model.ts";
import { coverWindow, type CoverTone } from "../cover-art.ts";
import StackedCover from "./StackedCover.vue";
import { localLibraryArtwork } from "../library-entry.ts";

const props = defineProps<{ rows: readonly TrackRowModel[]; tone: CoverTone; shown: boolean; localArtwork?: boolean }>();
const tracks = computed(() => coverWindow(props.rows, props.rows.findIndex(row => row.active),
  row => ({ key: row.key, url: props.localArtwork ? localLibraryArtwork(row.video.thumbnailUrl) : row.video.thumbnailUrl })));
</script>

<template>
  <StackedCover :tracks="tracks" :tone="tone" :shown="shown" :nominal-side="160" />
</template>
