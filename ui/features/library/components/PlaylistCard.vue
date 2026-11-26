<script lang="ts">
import { computed, defineComponent, h } from "vue";
import type { PropType } from "vue";
import StackedCover from "./StackedCover.vue";
import Icon from "../../../app/components/Icon.vue";
import { coverWindow, playlistTone } from "../cover-art.ts";
import { localLibraryArtwork } from "../library-entry.ts";
import type { PlaylistRowModel } from "../../tracks/track-list-model.ts";
export default defineComponent({
  props: { row: { type: Object as PropType<PlaylistRowModel>, required: true }, shown: Boolean },
  setup(props) {
    const tracks = computed(() => coverWindow(props.row.items, props.row.start, entry => {
      const url = entry.kind === "video" ? entry.video.thumbnailUrl : entry.thumbnailUrl;
      return { key: entry.entryId, url: props.row.localArtwork ? localLibraryArtwork(url) : url };
    }));
    return () => {
      const row = props.row;
      const handlers = row.handlers;
      return h("li", { key: row.key, draggable: Boolean(handlers), class: row.dragClass, title: handlers ? undefined : "搜索时不可调整顺序", ...(handlers ? { onClickCapture: handlers.capture, onDblclickCapture: handlers.capture, onDragstart: (event: DragEvent) => handlers.start(event, row.index, row.key), onDragover: (event: DragEvent) => handlers.over(event, row.index, row.key), onDragleave: (event: DragEvent) => handlers.leave(event, row.key), onDrop: (event: DragEvent) => handlers.drop(event, row.index), onDragend: handlers.end } : {}) }, [
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
