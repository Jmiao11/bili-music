<script setup lang="ts">
import type {ComponentPublicInstance} from "vue";
import type {draftBindings} from "../../../platform/draft-ports.ts";
import type {PageCallbacks} from '../../../app/root-controls.ts';
const props=defineProps<{draftBindings:typeof draftBindings;disabled:boolean | null; callbacks:PageCallbacks}>();
function draftRef(value:Element|ComponentPublicInstance|null):void {
 const input=value as HTMLInputElement|null;
 props.draftBindings.search(input ? {read:()=>input.value,write:value=>{input.value=value;}} : null);
}
</script>
<template>
              <form id="search-form" class="searchbar" role="search" @submit="callbacks.submit($event)">
                <label class="sr-only" for="search-keyword">搜索歌曲、歌手，或粘贴 BV 号直接播放</label>
                <div class="search-field">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m20.3 21.7-5.7-5.7a8 8 0 1 1 1.4-1.4l5.7 5.7ZM4 10a6 6 0 1 0 12 0A6 6 0 0 0 4 10Z" /></svg>
                  <input id="search-keyword" :ref="draftRef" required placeholder="搜索歌曲、歌手，BV 号自动识别" autocomplete="off" />
                  <span class="search-hint sr-only">BV 号自动识别</span>
                </div>
                <button id="search-button" class="search-submit" type="submit" :disabled="disabled ?? undefined">搜索</button>
              </form>

</template>
