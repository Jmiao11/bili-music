<script setup lang="ts">
import type {PageCallbacks, HomeControls} from '../root-controls.ts';
defineProps<{model:HomeControls;callbacks:PageCallbacks}>();
</script>
<template>
              <div id="home-setup-hint" class="home-setup-hint" :hidden="model.setupHidden" :class="{ 'is-inline': model.setupInline }">
                <p class="home-setup-title" id="home-setup-title">{{ model.setupTitle }}</p>
                <p class="home-setup-sub" id="home-setup-sub">{{ model.setupSub }}</p>
                <button id="home-setup-settings" class="primary-cta" type="button" @click="callbacks.setup()">去设置</button>
              </div>

</template>
