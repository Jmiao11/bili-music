<script setup lang="ts">
import { onMounted, onBeforeUnmount, shallowRef } from "vue";
import DynamicBackground from "./DynamicBackground.vue";
import type { DynamicBackgroundPresentation } from "../dynamic-background.ts";
const props = defineProps<{ model: DynamicBackgroundPresentation; onGeometry?: (element: HTMLElement) => () => void }>();
const surface = shallowRef<HTMLElement|null>(null);
let dispose: (() => void) | undefined;
onMounted(() => { if (surface.value) dispose = props.onGeometry?.(surface.value); });
onBeforeUnmount(() => dispose?.());
</script>
<template>
  <span ref="surface" class="floating-backdrop" aria-hidden="true">
    <span class="floating-image"></span>
    <DynamicBackground :model="model" />
  </span>
</template>
