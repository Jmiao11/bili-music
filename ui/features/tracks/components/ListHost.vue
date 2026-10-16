<script lang="ts">
import { defineComponent, h } from "vue";
import type { PropType } from "vue";
import TrackList from "./TrackList.vue";
import PlaylistList from "../../library/components/PlaylistList.vue";
import type { PlaylistListModel, TrackListModel } from "../root-lists.ts";

export default defineComponent({
  inheritAttrs: false,
  props: {onHost: {type:Function as PropType<(node:HTMLUListElement|null)=>void>,required:false}, model: { type: Object as PropType<TrackListModel | PlaylistListModel>, required: true } },
  setup(props, { attrs }) {
    return () => h("ul", {...attrs,ref:(node:unknown)=>props.onHost?.(node as HTMLUListElement|null)}, props.model.kind === "tracks"
      ? props.model.skeleton || props.model.rows.length > 0
        ? [h(TrackList, { rows: props.model.rows, skeleton: props.model.skeleton })] : []
      : props.model.rows.length > 0 ? [h(PlaylistList, { rows: props.model.rows })] : []);
  },
});
</script>
