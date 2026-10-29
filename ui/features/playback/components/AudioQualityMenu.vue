<script setup lang="ts">
import Icon from "../../../app/components/Icon.vue";
import FloatingBackdrop from "../../settings/components/FloatingBackdrop.vue";
import type { mainWindowRefs } from "../../../platform/main-window-refs.ts";
import type { DynamicBackgroundPresentation } from "../../settings/dynamic-background.ts";
const props = defineProps<{ mainWindowRefs: typeof mainWindowRefs; preference: CommandContract.AudioQuality; position: { readonly left: number; readonly bottom: number }; theme: string | null; background: DynamicBackgroundPresentation; onGeometry: (element: HTMLElement) => () => void; onChoose: (quality: CommandContract.AudioQuality) => void }>();
const options = [{ value: "highest", label: "最高可用" }, { value: "192k", label: "192K" }, { value: "132k", label: "132K" }, { value: "64k", label: "64K" }] as const;
</script>
<template>
  <div id="player-quality-menu" :ref="element => mainWindowRefs.playerQualityMenu(element as HTMLElement|null)" class="player-quality-menu" role="menu" aria-label="音质" :style="[{ left: `${position.left}px`, bottom: `${position.bottom}px` }, background.surfaces?.quality]">
    <FloatingBackdrop v-if="theme === 'image' || theme === 'dynamic'" :model="background" :on-geometry="onGeometry" />
    <button v-for="option in options" :key="option.value" type="button" role="menuitemradio" :aria-checked="preference === option.value" :data-quality="option.value" tabindex="-1" @click="props.onChoose(option.value)"><span class="quality-menu-check"><Icon v-if="preference === option.value" name="check" /></span><span>{{ option.label }}</span></button>
    <p>切换后从下一首开始生效</p>
  </div>
</template>
