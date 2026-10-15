<script setup lang="ts">
import type {SettingsControls} from "../settings-controls.ts";
import type {SettingsCallbacks} from "../root-settings.ts";
import type { HomeControls, PageCallbacks } from "../root-controls.ts";
import LegacyShell from "./LegacyShell.vue";
import type { ApplicationSnapshot } from "../application-store.ts";
import type { PlaybackCallbacks, PlaybackControls } from "../root-playback.ts";
import type { RootLists } from "../root-lists.ts";

defineProps<{ settingsControls:SettingsControls;settingsCallbacks:SettingsCallbacks;homeControls:HomeControls;pageCallbacks:PageCallbacks;snapshot: ApplicationSnapshot; callbacks: PlaybackCallbacks; playback: PlaybackControls; lists: RootLists }>();
</script>

<template><LegacyShell :settings-controls="settingsControls" :settings-callbacks="settingsCallbacks" :home-controls="homeControls" :page-callbacks="pageCallbacks" :lists="lists" :snapshot="snapshot" :playback="playback" :callbacks="callbacks" /></template>
