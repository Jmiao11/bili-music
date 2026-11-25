<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import Icon from "../../../app/components/Icon.vue";
import { measureCoverTier } from "../../../platform/cover-size.ts";
import { coverCandidates, coverSlots, type CoverTone, type CoverTrack } from "../cover-art.ts";

const props = defineProps<{ tracks: readonly CoverTrack[]; tone: CoverTone; shown: boolean; nominalSide: number }>();
const tier = ref(0);
function measure(box: HTMLElement) { tier.value = measureCoverTier(box, props.nominalSide); }
const vArtworkSize = { mounted: measure, updated: measure };
const candidates = computed(() => tier.value ? coverCandidates(props.tracks, tier.value) : []);
const failed = reactive(new Set<string>());
const loaded = reactive(new Set<string>());
watch(candidates, tracks => {
  const urls = tracks.map(track => track.url);
  for (const known of [failed, loaded]) for (const url of known) if (!urls.includes(url)) known.delete(url);
});
const slots = computed(() => coverSlots(candidates.value, failed));
const visible = computed(() => slots.value.filter(track => loaded.has(track.url)));
</script>

<template>
  <span v-artwork-size="shown" class="stacked-cover" :data-tone="tone" :data-count="visible.length" aria-hidden="true">
    <Icon v-if="!visible.length" name="note" class="stacked-note" />
    <img v-for="track in slots" :key="track.key" class="stacked-tile" :data-layer="visible.indexOf(track)" :src="track.url"
      alt="" loading="lazy" decoding="async" draggable="false" referrerpolicy="no-referrer" @load="loaded.add(track.url)" @error="failed.add(track.url)" />
  </span>
</template>
