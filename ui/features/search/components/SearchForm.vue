<script setup lang="ts">
import { computed } from "vue";
import type {ComponentPublicInstance} from "vue";
import type {draftBindings} from "../../../platform/draft-ports.ts";
import type {PageCallbacks} from '../../../app/root-controls.ts';
import type {SearchSnapshot} from "../search-state.ts";
import {matchingSearchHistory} from "../search-state.ts";
const props=defineProps<{draftBindings:typeof draftBindings;disabled:boolean | null; active:boolean; search:SearchSnapshot; callbacks:PageCallbacks}>();
function draftRef(value:Element|ComponentPublicInstance|null):void {
 const input=value as HTMLInputElement|null;
 props.draftBindings.search(input ? {read:()=>input.value,write:value=>{input.value=value;}} : null);
}
const history = computed(() => props.search.historyOpen && props.active ? matchingSearchHistory(props.search) : []);
function focusOut(event: FocusEvent): void { props.callbacks.closeSearchHistory(event.relatedTarget); }
</script>
<template>
              <form id="search-form" class="searchbar" role="search" @submit="callbacks.submit($event)" :onFocusout="active ? focusOut : undefined">
                <label class="sr-only" for="search-keyword">搜索歌曲、歌手，或粘贴 BV 号直接播放</label>
                <div class="search-field">
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m20.3 21.7-5.7-5.7a8 8 0 1 1 1.4-1.4l5.7 5.7ZM4 10a6 6 0 1 0 12 0A6 6 0 0 0 4 10Z" /></svg>
                  <input id="search-keyword" :ref="draftRef" required placeholder="搜索歌曲、歌手，BV 号自动识别" autocomplete="off"
                    :role="active && search.history.length ? 'combobox' : undefined" :aria-autocomplete="active && search.history.length ? 'list' : undefined"
                    :aria-expanded="active && search.history.length ? history.length > 0 : undefined"
                    :aria-controls="history.length ? 'search-history-list' : undefined"
                    :aria-activedescendant="history[search.historyIndex] ? 'search-history-option-' + search.historyIndex : undefined"
                    :onFocus="active ? callbacks.showSearchHistory : undefined" :onInput="active ? callbacks.showSearchHistory : undefined" />
                  <span class="search-hint sr-only">BV 号自动识别</span>
                  <button id="search-button" class="search-submit" type="submit" :disabled="disabled ?? undefined">搜索</button>
                </div>
                <div v-if="history.length" class="search-history">
                  <ul id="search-history-list" role="listbox" aria-label="搜索历史">
                    <li v-for="(item, index) in history" :key="item.keyword" role="presentation">
                      <button :id="'search-history-option-' + index" type="button" class="search-history-keyword" role="option" :aria-selected="index === search.historyIndex" :title="item.keyword" @click="callbacks.selectSearchHistory(item.keyword)">{{ item.keyword }}</button>
                      <button type="button" class="search-history-delete" :aria-label="'删除历史 ' + item.keyword" @click="callbacks.deleteSearchHistory(item.keyword)">×</button>
                    </li>
                  </ul>
                  <button type="button" class="search-history-clear" @click="callbacks.clearSearchHistory()">清空历史</button>
                </div>
              </form>

</template>
