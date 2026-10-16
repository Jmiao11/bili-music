<script setup lang="ts">
import type {ObjectDirective} from "vue";
import type { MascotPresentation } from "../mascot.ts";
defineProps<{ model:MascotPresentation; onStage:(stage:HTMLDivElement|null)=>void }>();
const vSvg:ObjectDirective<HTMLDivElement,MascotPresentation>={mounted:(element,binding)=>{element.innerHTML=binding.value.svg;},updated:(element,binding)=>{if(binding.value.svgVersion !== binding.oldValue?.svgVersion)element.innerHTML=binding.value.svg;}};
</script>
<template>
  <div id="mascot-stage" aria-label="小黑咪" :ref="element => onStage(element as HTMLDivElement|null)" :style="model.initialized ? {pointerEvents:'auto'} : undefined" :class="model.classes" :data-mascot-id="model.id" :data-mascot-name="model.name" :data-state="model.state">
    <div id="mascot-slot" aria-hidden="true" v-svg="model"></div>
    <div id="mascot-bubble" :hidden="model.bubbleHidden">{{model.bubble}}</div>
  </div>
</template>
