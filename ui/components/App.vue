<script setup lang="ts">
import type { RootModals } from "../root-modals.ts";
import type { libraryCallbacks, pagesCallbacks } from "../root-modals.ts";
import type {SettingsControls} from "../settings-controls.ts";
import type {SettingsCallbacks} from "../root-settings.ts";
import type { HomeControls, PageCallbacks } from "../root-controls.ts";
import AppShell from "./AppShell.vue";
import type { ApplicationSnapshot } from "../application-store.ts";
import type { PlaybackCallbacks, PlaybackControls } from "../root-playback.ts";
import type { RootLists } from "../root-lists.ts";

defineProps<{ modals:RootModals; libraryCallbacks:typeof libraryCallbacks; pagesCallbacks:typeof pagesCallbacks; settingsControls:SettingsControls;settingsCallbacks:SettingsCallbacks;homeControls:HomeControls;pageCallbacks:PageCallbacks;snapshot: ApplicationSnapshot; callbacks: PlaybackCallbacks; playback: PlaybackControls; lists: RootLists }>();
</script>

<template><AppShell :modals="modals" :library-callbacks="libraryCallbacks" :pages-callbacks="pagesCallbacks" :settings-controls="settingsControls" :settings-callbacks="settingsCallbacks" :home-controls="homeControls" :page-callbacks="pageCallbacks" :lists="lists" :snapshot="snapshot" :playback="playback" :callbacks="callbacks" /></template>
