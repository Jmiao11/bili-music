<script lang="ts">
import { computed, defineComponent, h } from "vue";
import type { PropType } from "vue";
import StackedCover from "./StackedCover.vue";
import Icon from "../../../app/components/Icon.vue";
import { coverWindow, playlistTone } from "../cover-art.ts";
import type { PlaylistRowModel } from "../../tracks/track-list-model.ts";
export default defineComponent({
  props: { row: { type: Object as PropType<PlaylistRowModel>, required: true }, shown: Boolean },
  setup(props) {
    const tracks = computed(() => coverWindow(props.row.items, props.row.start, entry => ({
      key: entry.entryId, url: entry.kind === "video" ? entry.video.thumbnailUrl : entry.thumbnailUrl,
    })));
    return () => {
      const row = props.row;
      return h("li", { key: row.key, draggable: true, class: row.dragClass, onClickCapture: row.handlers.capture, onDblclickCapture: row.handlers.capture, onDragstart: (event: DragEvent) => row.handlers.start(event, row.index, row.key), onDragover: (event: DragEvent) => row.handlers.over(event, row.index, row.key), onDragleave: (event: DragEvent) => row.handlers.leave(event, row.key), onDrop: (event: DragEvent) => row.handlers.drop(event, row.index), onDragend: row.handlers.end }, [
        h("button", { type: "button", class: "playlist-card" + (row.selected ? " is-selected" : ""), "data-playlist-id": row.key, "aria-label": "打开歌单 " + row.name, onClick: row.onChoose }, [
          h(StackedCover, { tracks: tracks.value, nominalSide: 220, shown: props.shown, tone: playlistTone(row.key) }),
          h("span", { class: "playlist-name" }, row.name),
          h("small", row.count + " 首"),
        ]),
        row.count ? h("button", { type: "button", class: "playlist-card-play", "aria-label": "播放歌单 " + row.name, onClick: (event: MouseEvent) => { event.stopPropagation(); row.onPlay(); } }, [h(Icon, { name: "play", size: 16 })]) : null,
      ]);
    };
  },
});
</script>
