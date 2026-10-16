<script setup lang="ts">
import type {mainWindowRefs} from "../../../platform/main-window-refs.ts";
import type {ComponentPublicInstance} from "vue";
import type {draftBindings} from "../../../platform/draft-ports.ts";
import type {PageCallbacks, HomeControls} from '../../../app/root-controls.ts';
const props=defineProps<{mainWindowRefs:typeof mainWindowRefs;draftBindings:typeof draftBindings;model:HomeControls;callbacks:PageCallbacks}>();
function draftRef(value:Element|ComponentPublicInstance|null):void {
 const input=value as HTMLInputElement|null;
 props.mainWindowRefs.homeHintInput(input);
 props.draftBindings.home(input ? {read:()=>input.value,write:value=>{input.value=value;}} : null);
}
</script>
<template>
            <div id="home-hint-row" class="home-hint-row" :hidden="model.hintHidden">
              <div class="home-hint-controls">
                <input id="home-hint-input" :ref="draftRef" class="home-hint-input" type="text" maxlength="60" @keydown="callbacks.hintKey($event)" aria-label="用一句话描述你现在想听什么" placeholder="用一句话描述你现在想听什么，可留空" />
                <button id="home-hint-apply" :ref="element => mainWindowRefs.homeHintApply(element as HTMLButtonElement|null)" class="primary-cta" type="button" :disabled="model.hintDisabled" @click="callbacks.hint()">{{ model.hintText }}</button>
              </div>
            </div>


</template>
