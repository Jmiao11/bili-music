<script lang="ts">
import { defineComponent, Fragment, h } from "vue";
import type { PropType } from "vue";
import PlaylistCard from "./PlaylistCard.vue";
import type { PlaylistRowModel } from "../../tracks/track-list-model.ts";
export default defineComponent({
  props: { rows: { type: Array as PropType<readonly PlaylistRowModel[]>, required: true }, shown: Boolean },
  setup(props) {
    return () => h(Fragment, props.rows.map(row => h(PlaylistCard, { key: row.key, row, shown: props.shown })));
  },
});
</script>
