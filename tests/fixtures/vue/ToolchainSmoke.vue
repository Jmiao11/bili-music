<script setup lang="ts">
import type { DeepReadonly } from "../../../ui/state-store.ts";

const props = defineProps<{
  snapshot: DeepReadonly<{ count: number }>;
  onChoose: (count: number) => void;
}>();
</script>

<template>
  <button @click="props.onChoose(props.snapshot.count + 1)">{{ props.snapshot.count }}</button>
</template>
