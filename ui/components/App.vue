<script setup lang="ts">
import LegacyShell from "./LegacyShell.vue";
import type { ApplicationSnapshot } from "../application-store.ts";
import type { RootLists } from "../root-lists.ts";

defineProps<{ snapshot: ApplicationSnapshot; callbacks: Readonly<Record<string, never>>; lists: RootLists }>();
</script>

<template><LegacyShell :lists="lists" /></template>
