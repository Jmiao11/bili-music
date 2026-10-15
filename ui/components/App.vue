<script setup lang="ts">
import LegacyShell from "./LegacyShell.vue";
import type { ApplicationSnapshot } from "../application-store.ts";

defineProps<{ snapshot: ApplicationSnapshot; callbacks: Readonly<Record<string, never>> }>();
</script>

<template><LegacyShell /></template>
