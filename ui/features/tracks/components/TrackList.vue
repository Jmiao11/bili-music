<script lang="ts">
import { defineComponent, h, Fragment } from "vue";
import type { PropType } from "vue";
import TrackRow from "./TrackRow.vue";
import type { TrackRowModel } from "../track-list-model.ts";

export default defineComponent({
  props: { rows: { type: Array as PropType<readonly TrackRowModel[]>, required: true }, skeleton: { type: Boolean, required: true } },
  setup(props) {
    return () => h(Fragment, props.skeleton ? Array.from({ length: 8 }, (_, index) =>
      h("li", { class: "track-row skeleton-row", key: `skeleton:${index}` }, ["\n      ", h("span", { class: "track skeleton-track" }, [
        "\n        ", h("span", { class: "skeleton-cover" }), "\n        ", h("span", { class: "skeleton-meta" }, ["\n          ", h("span"), "\n          ", h("small"), "\n        "]), "\n      ",
      ]), "\n    "])) : props.rows.map(row => h(TrackRow, { key: row.key, row })));
  },
});
</script>
