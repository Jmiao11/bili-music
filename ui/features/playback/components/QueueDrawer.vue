<script setup lang="ts">
import { onBeforeUnmount, onBeforeUpdate, reactive, ref } from "vue";
import type { QueueDrawerView, QueueDrawerRow as Row } from "../queue-drawer-view.ts";
import type { queueDrawerCallbacks } from "../queue-drawer.ts";
import type { mainWindowRefs } from "../../../platform/main-window-refs.ts";
import { rowDragHandlers } from "../../../shared/controller-runtime.ts";
import Icon from "../../../app/components/Icon.vue";
import QueueDrawerRow from "./QueueDrawerRow.vue";

const props = defineProps<{ model: QueueDrawerView; callbacks: typeof queueDrawerCallbacks; refs: typeof mainWindowRefs }>();
const expanded = reactive(new Map<number, boolean>());
const isExpanded = (row: Row) => expanded.get(row.id) ?? row.active;
const toggle = (row: Row) => expanded.set(row.id, !isExpanded(row));
const source = ref<string | null>(null), target = ref<string | null>(null);
const direction = ref<"before" | "after" | null>(null);
let suppressUntil = 0;
function resetDrag() { source.value = null; target.value = null; direction.value = null; }
const drag = rowDragHandlers({
  suppressed: () => source.value !== null || performance.now() < suppressUntil,
  blocked: () => props.model.shuffle || !props.model.stage.open,
  start(_index, key) { source.value = key; target.value = direction.value = null; },
  source() {
    if (props.model.shuffle || !props.model.stage.open || source.value === null) return null;
    const index = props.model.rows.findIndex(row => String(row.id) === source.value);
    return index < 0 ? null : index;
  },
  target: () => target.value,
  hover(key, side) { target.value = key; direction.value = side; },
  finish() { if (source.value !== null) suppressUntil = performance.now() + 400; resetDrag(); },
  move: props.callbacks.move,
});
onBeforeUpdate(() => {
  if (props.model.stage.hidden) expanded.clear();
  if (!props.model.stage.open || props.model.shuffle) resetDrag();
});
const remove = (event: MouseEvent) => props.callbacks.remove(Number((event.currentTarget as HTMLButtonElement).value));
onBeforeUnmount(() => props.callbacks.dispose());
</script>
<template>
  <aside id="queue-drawer" :ref="element => refs.queueDrawer(element as HTMLElement | null)" role="dialog" aria-modal="false" aria-labelledby="queue-drawer-title" :hidden="model.stage.hidden" :aria-hidden="!model.stage.open" :inert="!model.stage.open" :class="{ 'is-open': model.stage.open }" :onTransitionend="model.stage.hidden ? undefined : callbacks.transition">
    <header :inert="!!model.stage.confirming"><h2 id="queue-drawer-title">播放队列</h2><span>{{ model.count }}</span><button :ref="element => refs.queueDrawerClear(element as HTMLButtonElement | null)" type="button" class="small-button quiet danger-action queue-clear" :disabled="!model.count" :onClick="model.stage.open && model.count ? callbacks.openClear : undefined">清空</button><button :ref="element => refs.queueDrawerClose(element as HTMLButtonElement | null)" class="tool-button" type="button" aria-label="关闭" :onClick="model.stage.hidden ? undefined : callbacks.close"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="m6 5 6 6 6-6 1 1-6 6 6 6-1 1-6-6-6 6-1-1 6-6-6-6Z" /></svg></button></header>
    <ul :ref="element => refs.queueDrawerList(element as HTMLUListElement | null)" class="queue-drawer-list" :inert="!!model.stage.confirming">
      <template v-if="!model.stage.hidden">
        <li v-for="(row,index) in model.rows" :key="row.id" :class="{ 'queue-group': row.entry.collection }">
          <div class="queue-parent" :class="[{ 'is-current': row.active, 'is-dragging': source === String(row.id) }, target === String(row.id) ? 'is-drop-' + direction : '']"
            :draggable="!model.shuffle" :title="model.shuffle ? '随机播放时不可调整顺序' : undefined"
            @click.capture="drag.capture" @dblclick.capture="drag.capture" @dragstart="drag.start($event, index, String(row.id))"
            @dragover="drag.over($event, index, String(row.id))" @dragleave="drag.leave($event, String(row.id))"
            @drop="drag.drop($event, index)" @dragend="drag.end">
            <Icon v-if="!model.shuffle" class="queue-drag-handle" name="grip" :size="14" />
            <QueueDrawerRow :row="row" :index="index" :expanded="!!row.entry.collection && isExpanded(row)" :choose="callbacks.choose" :toggle="toggle" />
            <button v-if="model.hasCurrent" type="button" class="tool-button queue-remove" aria-label="移出队列" title="移出队列" :value="index" @click="remove"></button>
          </div>
          <ul v-if="row.entry.collection && isExpanded(row)" class="queue-members" :title="model.shuffle ? '随机播放时不可调整顺序' : undefined">
            <li v-for="(member,i) in row.entry.collection.data.snapshot.items" :key="member.bvid" :class="{ 'is-current': row.active && i === row.memberIndex }"><span class="queue-title">{{ member.title }}</span></li>
            <li v-if="row.active && row.entry.collection.historyTrack && row.memberIndex === -1" class="is-current"><span class="queue-title">{{ row.entry.collection.historyTrack.title }}</span></li>
          </ul>
        </li>
      </template>
    </ul>
    <div v-if="model.stage.confirming" class="queue-clear-backdrop">
      <section :ref="element => refs.queueDrawerConfirm(element as HTMLElement | null)" class="queue-clear-confirm is-open" role="alertdialog" aria-labelledby="queue-clear-title" aria-describedby="queue-clear-description">
        <h3 id="queue-clear-title">清空播放队列</h3>
        <p id="queue-clear-description">将停止播放并清空队列。</p>
        <div class="library-modal-actions">
          <button type="button" class="small-button quiet queue-clear-cancel" @click="callbacks.dismissClear">取消</button>
          <button type="button" class="secondary-button danger-action" @click="callbacks.confirmClear">清空</button>
        </div>
      </section>
    </div>
  </aside>
</template>
