<script setup lang="ts">
import type {PageCallbacks} from '../root-controls.ts';
defineProps<{visible:boolean;callbacks:PageCallbacks}>();
</script>
<template>
                <div id="playlist-actions" class="playlist-actions" :hidden="!visible">
                  <button id="rename-playlist-button" class="small-button quiet" type="button" @click="callbacks.renamePlaylist()">改名</button>
                  <button id="delete-playlist-button" class="small-button quiet danger" type="button" @click="callbacks.deletePlaylist()">删除</button>
                </div>

</template>
