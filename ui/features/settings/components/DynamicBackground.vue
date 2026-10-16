<script setup lang="ts">
import type { DynamicBackgroundPresentation } from "../dynamic-background.ts";
defineProps<{ model:DynamicBackgroundPresentation }>();
</script>
<template>
  <div class="dynamic-background" aria-hidden="true" :class="{'is-paused':model.paused}">
    <div v-for="(palette,index) in model.palettes" :key="index" class="dynamic-background-layer" :class="{'is-visible':index === model.front}" :style="palette ? {'--dynamic-color-1':palette[0],'--dynamic-color-2':palette[1],'--dynamic-color-3':palette[2]} : undefined"></div>
  </div>
</template>
