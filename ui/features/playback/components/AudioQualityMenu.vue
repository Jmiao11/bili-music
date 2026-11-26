<script setup lang="ts">
import Icon from "../../../app/components/Icon.vue";
import FloatingBackdrop from "../../settings/components/FloatingBackdrop.vue";
import type { mainWindowRefs } from "../../../platform/main-window-refs.ts";
import type { DynamicBackgroundPresentation } from "../../settings/dynamic-background.ts";
import { audioQualityOptions } from "../playback-display-view.ts";
const props = defineProps<{ mainWindowRefs: typeof mainWindowRefs; preference: CommandContract.AudioQuality; position: { readonly left: number; readonly bottom: number }; theme: string | null; background: DynamicBackgroundPresentation; onGeometry: (element: HTMLElement) => () => void; onChoose: (quality: CommandContract.AudioQuality) => void }>();
</script>
<template>
  <div id="player-quality-menu" :ref="element => mainWindowRefs.playerQualityMenu(element as HTMLElement|null)" class="player-quality-menu" role="menu" aria-label="音质" :style="[{ left: `${position.left}px`, bottom: `${position.bottom}px` }, background.surfaces?.quality]">
    <FloatingBackdrop v-if="theme === 'image' || theme === 'dynamic'" :model="background" :on-geometry="onGeometry" />
    <button v-for="(option, value) in audioQualityOptions" :key="value" type="button" role="menuitemradio" :aria-checked="preference === value" :data-quality="value" tabindex="-1" @click="props.onChoose(value)">
      <span class="quality-menu-check"><Icon v-if="preference === value" name="check" /></span>
      <span class="quality-menu-copy"><span>{{ option.label }}</span><small>{{ option.description }}</small></span>
    </button>
    <p>切换后立即生效</p>
  </div>
</template>
