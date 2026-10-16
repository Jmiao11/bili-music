<script lang="ts">
import { defineComponent, h, onBeforeUnmount, withModifiers } from "vue";
import type { PropType } from "vue";
import type { TrackRowModel } from "../track-list-model.ts";
import { displayThumbnailUrl, formatDuration } from "../../../shared/track-utils.ts";

export default defineComponent({
  props: { row: { type: Object as PropType<TrackRowModel>, required: true } },
  setup(props) {
    let item: HTMLElement | null = null, button: HTMLButtonElement | null = null;
    const notify = () => { if (item && button) props.row.onNodes(item, button); };
    const itemRef = (value: unknown) => { item = value instanceof HTMLElement ? value : null; notify(); };
    const buttonRef = (value: unknown) => { button = value instanceof HTMLElement ? value as HTMLButtonElement : null; notify(); };
    onBeforeUnmount(() => props.row.onNodes(null, null));
    return () => {
      const row = props.row, video = row.video;
      const content = [
        h("span", { class: "eq", "aria-hidden": "true" }, [h("span"), h("span"), h("span")]),
        h("span", { class: "track-cover" }, [video.thumbnailUrl
          ? h("img", { src: displayThumbnailUrl(video.thumbnailUrl), alt: "", ".loading": "lazy", ".referrerPolicy": "no-referrer", draggable: row.draggable ? false : undefined })
          : h("span", { class: "cover-placeholder" })]),
        h("span", { class: "track-meta" }, [h("span", { class: "track-title" }, video.title || video.bvid), h("span", { class: "track-up" }, video.uploader || video.bvid)]),
        ...(row.showPlayCount === false ? [] : [h("span", { class: "track-play" }, row.playCountText)]),
        ...(row.search ? [h("span", { class: "track-pubdate" }, row.pubdateText)] : []),
        h("span", { class: "track-duration" }, video.durationSeconds ? formatDuration(video.durationSeconds) : "0:00"),
      ];
      const controls = [
        ...(row.pageCount > 1 ? [h("button", { type: "button", class: "page-count-badge", title: "查看分P", "aria-label": `查看 ${row.pageCount} 个分P`, onClick: withModifiers(() => row.onBadge(), ["prevent", "stop"]), onDblclick: withModifiers(() => {}, ["stop"]) }, `${row.pageCount}P`)] : []),
        ...(row.unavailableReason ? [h("span", { class: "track-unavailable", title: row.unavailableReason, "aria-label": row.unavailableReason }, "!")] : []),
        h("button", { type: "button", class: "track-action favorite-button" + (row.favorited ? " is-favorited" : ""), "data-favorite-bvid": video.bvid, title: row.favorited ? "取消收藏" : "收藏", "aria-label": row.favorited ? "取消收藏" : "收藏", onClick: withModifiers(() => row.onFavorite(), ["stop"]) }, row.favorited ? "♥" : "♡"),
        h("button", { type: "button", class: "track-action", title: row.playlistId ? "从歌单移除" : "加入歌单", "aria-label": row.playlistId ? "从歌单移除" : "加入歌单", onClick: withModifiers(() => row.playlistId ? row.onRemove?.() : row.onAdd(), ["stop"]) }, row.playlistId ? "−" : "+"),
      ];
      return h("li", { class: "track-row" + (row.unavailableReason ? " is-unavailable" : "") + (row.dragClass ? " " + row.dragClass : ""), draggable: row.draggable, onClickCapture: row.onCapture, onDblclickCapture: row.onCapture, onDragstart: row.onDragStart, onDragover: row.onDragOver, onDragleave: row.onDragLeave, onDrop: row.onDrop, onDragend: row.onDragEnd, ref: itemRef, onDblclick: row.onDoubleClick }, [
        h("button", { type: "button", class: "track", [row.search ? "data-result-index" : "data-library-index"]: String(row.index), "data-bvid": video.bvid, ...(row.active ? { "aria-current": "true" } : {}), ref: buttonRef, onClick: row.onClick }, content),
        h("span", { class: "track-actions" }, controls),
      ]);
    };
  },
});
</script>
