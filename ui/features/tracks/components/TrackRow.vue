<script lang="ts">
import { defineComponent, h, onBeforeUnmount, withModifiers } from "vue";
import Icon from "../../../app/components/Icon.vue";
import type { PropType } from "vue";
import type { TrackRowModel } from "../track-list-model.ts";
import { displayThumbnailUrl, formatDuration } from "../../../shared/track-utils.ts";

function collectionDate(timestamp: string): string { const date = new Date(Number(timestamp)); return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleDateString("zh-CN"); }

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
        h("span", { class: "track-meta" }, [h("span", { class: "track-title" }, video.title || video.bvid), row.search
          ? h("span", { class: "track-creator" }, [h("span", { class: "track-up" }, row.collection ? `更新于 ${collectionDate(row.collection.snapshot.fetchedAt)}` : video.uploader || video.bvid), h("span", { class: "track-pubdate" }, row.pubdateText)])
          : h("span", { class: "track-up" }, row.collection ? `更新于 ${collectionDate(row.collection.snapshot.fetchedAt)}` : video.uploader || video.bvid)]),
        ...(row.showPlayCount === false ? [] : [h("span", { class: "track-play" }, row.playCountText)]),
        h("span", { class: "track-duration" }, row.collection ? `${row.collection.videoCount} 个视频` : video.durationSeconds ? formatDuration(video.durationSeconds) : "0:00"),
        h("span", { class: "track-number", "aria-hidden": "true" }, String(row.index + 1)),
        h(Icon, { name: "play", class: "track-hover-play" }),
        ...(row.draggable ? [h(Icon, { name: "grip", class: "track-drag-handle" })] : []),
      ];
      const controls = [
        ...(row.collection ? [h("button", { type: "button", class: "page-count-badge", "data-collection": "true", title: "展开合集", "aria-label": `展开共 ${row.collection.videoCount} 个视频的合集`, onClick: withModifiers(() => row.onBadge(), ["prevent", "stop"]), onDblclick: withModifiers(() => {}, ["stop"]) }, `合集 ${row.collection.videoCount}`)] : row.pageCount > 1 ? [h("button", { ref:(node:unknown)=>row.onBadgeNode?.(node as HTMLButtonElement|null),"aria-busy":row.badgePagesVersion === undefined ? undefined : "true","data-pages-request-version":row.badgePagesVersion,type: "button", class: "page-count-badge", title: "查看分P", "aria-label": `查看 ${row.pageCount} 个分P`, onClick: withModifiers(() => row.onBadge(), ["prevent", "stop"]), onDblclick: withModifiers(() => {}, ["stop"]) }, `${row.pageCount}P`)] : []),
        ...(row.unavailableReason ? [h("span", { class: "track-unavailable", title: row.unavailableReason, "aria-label": row.unavailableReason }, "!")] : []),
        h("button", { type: "button", class: "track-action favorite-button" + (row.favorited ? " is-favorited" : ""), "data-favorite-bvid": row.collection ? undefined : video.bvid, title: row.collection ? row.favorited ? "取消收藏合集" : "收藏合集" : row.favorited ? "取消收藏" : "收藏", "aria-label": row.collection ? row.favorited ? "取消收藏合集" : "收藏合集" : row.favorited ? "取消收藏" : "收藏", onDblclick: row.collection ? withModifiers(() => {}, ["stop"]) : undefined, onClick: withModifiers(() => row.onFavorite(), ["stop"]) }, [h("span", { class: "sr-only", "aria-hidden": "true" }, row.favorited ? "♥" : "♡"), h(Icon, { name: "heart" })]),
        h("button", { type: "button", class: "track-action", title: row.playlistId ? "从歌单移除" : "加入歌单", "aria-label": row.playlistId ? "从歌单移除" : "加入歌单", onDblclick: row.collection ? withModifiers(() => {}, ["stop"]) : undefined, onClick: withModifiers(() => row.playlistId ? row.onRemove?.() : row.onAdd(), ["stop"]) }, [h("span", { class: "sr-only", "aria-hidden": "true" }, row.playlistId ? "−" : "+"), h(Icon, { name: row.playlistId ? "minus" : "plus" })]),
      ];
      return h("li", {"data-page-count-bvid":row.pageCountBvid, class: "track-row" + (row.unavailableReason ? " is-unavailable" : "") + (row.dragClass ? " " + row.dragClass : ""), draggable: row.draggable, onClickCapture: row.onCapture, onDblclickCapture: row.onCapture, onDragstart: row.onDragStart, onDragover: row.onDragOver, onDragleave: row.onDragLeave, onDrop: row.onDrop, onDragend: row.onDragEnd, ref: itemRef, onDblclick: row.onDoubleClick }, [
        h("button", {"aria-busy":row.playPagesVersion === undefined ? undefined : "true","data-pages-request-version":row.playPagesVersion, type: "button", class: "track", [row.search ? "data-result-index" : "data-library-index"]: String(row.index), "data-bvid": row.collection ? undefined : video.bvid, ...(row.active ? { "aria-current": "true" } : {}), ref: buttonRef, onClick: row.onClick }, content),
        h("span", { class: "track-actions" }, controls),
      ]);
    };
  },
});
</script>
