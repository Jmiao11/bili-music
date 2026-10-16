<script lang="ts">
import { defineComponent, Fragment, h } from "vue";
import type { PropType } from "vue";
import type { PlaylistRowModel } from "../../tracks/track-list-model.ts";
export default defineComponent({
  props: { rows: { type: Array as PropType<readonly PlaylistRowModel[]>, required: true } },
  setup(props) {
    return () => h(Fragment, props.rows.map(row => h("li", { key: row.key, draggable: true, class: row.dragClass, onClickCapture: row.handlers.capture, onDblclickCapture: row.handlers.capture, onDragstart: (event: DragEvent) => row.handlers.start(event, row.index, row.key), onDragover: (event: DragEvent) => row.handlers.over(event, row.index, row.key), onDragleave: (event: DragEvent) => row.handlers.leave(event, row.key), onDrop: (event: DragEvent) => row.handlers.drop(event, row.index), onDragend: row.handlers.end }, [
      h("button", { type: "button", class: "playlist-card" + (row.selected ? " is-selected" : ""), "data-playlist-id": row.key, onClick: row.onChoose }, [h("span", row.name), h("small", row.count + " 首")]),
    ])));
  },
});
</script>
