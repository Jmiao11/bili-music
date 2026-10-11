<script setup lang="ts">
import { useAppState } from "../../../ui/vue/use-app-state.ts";
import type { AppReader } from "../../../ui/vue/use-app-state.ts";

const props = defineProps<{ reader: AppReader }>();
const selected = useAppState(props.reader, state => state.pages);
// Type canaries insert attempted writes here; the snapshot keeps the store's DeepReadonly type.
</script>

<template>
  <span>{{ selected.requestVersion }}</span>
</template>
