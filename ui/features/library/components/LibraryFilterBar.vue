<script setup lang="ts">
import Icon from "../../../app/components/Icon.vue";
import type { libraryFilterCallbacks } from "../../tracks/root-lists.ts";

defineProps<{ draft: string; filtered: boolean; count: number; placeholder: string; callbacks: typeof libraryFilterCallbacks }>();
</script>

<template>
  <div class="library-filter-bar">
    <label class="library-filter-field">
      <Icon name="search" :size="16" />
      <input class="library-filter-input" type="text" :aria-label="placeholder" :placeholder="placeholder" :value="draft"
        @input="callbacks.input(($event.target as HTMLInputElement).value)" @keydown.esc.stop.prevent="callbacks.clear()" />
      <button v-if="draft" class="library-filter-clear" type="button" aria-label="清除搜索" @click="callbacks.clear()">×</button>
    </label>
    <span class="library-filter-count" aria-live="polite">{{ filtered ? '找到 ' : '共 ' }}{{ count }} 首</span>
  </div>
</template>
