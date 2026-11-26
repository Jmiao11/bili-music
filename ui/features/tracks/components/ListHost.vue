<script lang="ts">
import { defineComponent, h } from "vue";
import type { PropType } from "vue";
import TrackList from "./TrackList.vue";
import PlaylistList from "../../library/components/PlaylistList.vue";
import type { PlaylistListModel, TrackListModel } from "../root-lists.ts";

export default defineComponent({
  inheritAttrs: false,
  props: {shown: Boolean, firstRow: Number, onHost: {type:Function as PropType<(node:HTMLUListElement|null)=>void>,required:false}, model: { type: Object as PropType<TrackListModel | PlaylistListModel>, required: true } },
  setup(props, { attrs }) {
    const spacer = (rows: number) => h("li", { class: "library-filter-spacer", role: "presentation", "aria-hidden": "true", style: { height: rows * 44 + "px" } });
    return () => {
      const { model, firstRow } = props;
      let content;
      if (model.kind === "tracks" && (model.skeleton || model.rows.length)) {
        if (firstRow !== undefined && model.rows.length > 48) {
          const start = Math.min(firstRow, model.rows.length - 48), end = start + 48;
          content = [spacer(start), h(TrackList, { rows: model.rows.slice(start, end), skeleton: false }), spacer(model.rows.length - end)];
        } else content = [h(TrackList, { rows: model.rows, skeleton: model.skeleton })];
      } else if (model.kind === "playlists" && model.rows.length) {
        content = [h(PlaylistList, { rows: model.rows, shown: props.shown })];
      }
      return h("ul", {...attrs,ref:(node:unknown)=>props.onHost?.(node as HTMLUListElement|null)}, content);
    };
  },
});
</script>
