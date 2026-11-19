<script setup lang="ts">
import { onBeforeUnmount, onBeforeUpdate, reactive } from "vue";
import type { QueueDrawerView, QueueDrawerRow as Row } from "../queue-drawer-view.ts";
import type { queueDrawerCallbacks } from "../queue-drawer.ts";
import type { mainWindowRefs } from "../../../platform/main-window-refs.ts";
import QueueDrawerRow from "./QueueDrawerRow.vue";

const props = defineProps<{ model: QueueDrawerView; callbacks: typeof queueDrawerCallbacks; refs: typeof mainWindowRefs }>();
const expanded = reactive(new Map<number, boolean>());
const isExpanded = (row: Row) => expanded.get(row.id) ?? row.active;
const toggle = (row: Row) => expanded.set(row.id, !isExpanded(row));
onBeforeUpdate(() => { if (props.model.stage.hidden) expanded.clear(); });
const remove = (event: MouseEvent) => props.callbacks.remove(Number((event.currentTarget as HTMLButtonElement).value));
onBeforeUnmount(() => props.callbacks.dispose());
</script>
<template>
  <aside id="queue-drawer" :ref="element => refs.queueDrawer(element as HTMLElement | null)" role="dialog" aria-modal="false" aria-labelledby="queue-drawer-title" :hidden="model.stage.hidden" :aria-hidden="!model.stage.open" :inert="!model.stage.open" :class="{ 'is-open': model.stage.open }" :onTransitionend="model.stage.hidden ? undefined : callbacks.transition">
    <header><h2 id="queue-drawer-title">播放队列</h2><span>{{ model.count }}</span><button :ref="element => refs.queueDrawerClose(element as HTMLButtonElement | null)" class="tool-button" type="button" aria-label="关闭" :onClick="model.stage.hidden ? undefined : callbacks.close"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="m6 5 6 6 6-6 1 1-6 6 6 6-1 1-6-6-6 6-1-1 6-6-6-6Z" /></svg></button></header>
    <ul :ref="element => refs.queueDrawerList(element as HTMLUListElement | null)" class="queue-drawer-list">
      <template v-if="!model.stage.hidden">
        <li v-for="(row,index) in model.rows" :key="row.id" :class="{ 'queue-group': row.entry.collection }">
          <div class="queue-parent" :class="{ 'is-current': row.active }">
            <QueueDrawerRow :row="row" :index="index" :expanded="!!row.entry.collection && isExpanded(row)" :choose="callbacks.choose" :toggle="toggle" />
            <button v-if="model.hasCurrent && !row.active" type="button" class="tool-button queue-remove" aria-label="移出队列" title="移出队列" :value="index" @click="remove"></button>
          </div>
          <ul v-if="row.entry.collection && isExpanded(row)" class="queue-members">
            <li v-for="(member,i) in row.entry.collection.data.snapshot.items" :key="member.bvid" :class="{ 'is-current': row.active && i === row.memberIndex }"><span class="queue-title">{{ member.title }}</span></li>
            <li v-if="row.active && row.entry.collection.historyTrack && row.memberIndex === -1" class="is-current"><span class="queue-title">{{ row.entry.collection.historyTrack.title }}</span></li>
          </ul>
        </li>
      </template>
    </ul>
  </aside>
</template>
