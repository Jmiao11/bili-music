<script setup lang="ts">
import type {PageCallbacks, HomeControls} from '../root-controls.ts';
defineProps<{model:HomeControls;callbacks:PageCallbacks}>();
</script>
<template>
            <div id="home-hint-row" class="home-hint-row" :hidden="model.hintHidden">
              <div class="home-hint-controls">
                <input id="home-hint-input" class="home-hint-input" type="text" maxlength="60" @keydown="callbacks.hintKey($event)" aria-label="用一句话描述你现在想听什么" placeholder="用一句话描述你现在想听什么，可留空" />
                <button id="home-hint-apply" class="primary-cta" type="button" :disabled="model.hintDisabled" @click="callbacks.hint()">{{ model.hintText }}</button>
              </div>
            </div>


</template>
