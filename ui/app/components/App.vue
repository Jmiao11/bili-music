<script setup lang="ts">
import type {mainWindowRefs} from "../../platform/main-window-refs.ts";
import type {draftBindings} from "../../platform/draft-ports.ts";
import type { ShellProjection } from "../shell-projection.ts";
import type { ShellStages,SidebarPresentation } from "../shell-stages.ts";
import type { DynamicBackgroundPresentation } from "../../features/settings/dynamic-background.ts";
import type { RootModals } from "../root-modals.ts";
import type { libraryCallbacks, pagesCallbacks } from "../root-modals.ts";
import type {SettingsControls} from "../../features/settings/settings-controls.ts";
import type {SettingsCallbacks} from "../../features/settings/root-settings.ts";
import type { HomeControls, PageCallbacks } from "../root-controls.ts";
import AppShell from "./AppShell.vue";
import type { ApplicationSnapshot } from "../../store/application-store.ts";
import type { PlaybackCallbacks, PlaybackControls } from "../../features/playback/root-playback.ts";
import type { collectionCallbacks } from "../../features/collections/collection-port.ts";
import type { RootLists } from "../../features/tracks/root-lists.ts";

defineProps<{mainWindowRefs:typeof mainWindowRefs;draftBindings:typeof draftBindings;shell:ShellProjection; stages:ShellStages;sidebar:SidebarPresentation;maximized:boolean|null;background:DynamicBackgroundPresentation; modals:RootModals; libraryCallbacks:typeof libraryCallbacks; pagesCallbacks:typeof pagesCallbacks; settingsControls:SettingsControls;settingsCallbacks:SettingsCallbacks;homeControls:HomeControls;pageCallbacks:PageCallbacks;snapshot: ApplicationSnapshot; callbacks: PlaybackCallbacks; collectionCallbacks:typeof collectionCallbacks; playback: PlaybackControls; lists: RootLists }>();
</script>

<template><AppShell :main-window-refs="mainWindowRefs" :draft-bindings="draftBindings" :shell="shell" :stages="stages" :sidebar="sidebar" :maximized="maximized" :background="background" :modals="modals" :library-callbacks="libraryCallbacks" :pages-callbacks="pagesCallbacks" :settings-controls="settingsControls" :settings-callbacks="settingsCallbacks" :home-controls="homeControls" :page-callbacks="pageCallbacks" :lists="lists" :snapshot="snapshot" :playback="playback" :callbacks="callbacks" :collection-callbacks="collectionCallbacks" /></template>
