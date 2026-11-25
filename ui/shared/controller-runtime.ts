import type { LibraryDragHandlers } from "../features/tracks/track-list-model.ts";

type RowDragSession = {
  horizontal?: boolean;
  suppressed(): boolean; blocked(): boolean;
  start(index: number, key: string): void; source(): number | null;
  canHover?(): boolean; target(): string | null; hover(key: string | null, direction: "before" | "after" | null): void;
  finish(changed: boolean): void; move(from: number, to: number): void;
};

function rowDragHandlers(session: RowDragSession): LibraryDragHandlers {
  function direction(event: DragEvent, from: number, index: number): "before" | "after" {
    if (!session.horizontal) return index < from ? "before" : "after";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  }
  return {
    capture(event) { if (session.suppressed()) { event.preventDefault(); event.stopImmediatePropagation(); } },
    start(event, index, key) {
      if (!event.dataTransfer) return;
      if (session.blocked()) { event.preventDefault(); return; }
      session.start(index, key);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    },
    over(event, index, key) {
      const from = session.source();
      if (!event.dataTransfer || from === null || session.canHover?.() === false) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      session.hover(index === from ? null : key, direction(event, from, index));
    },
    leave(event, key) {
      if (session.target() === key && !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) session.hover(null, null);
    },
    drop(event, index) {
      const from = session.source();
      if (from === null) return;
      let to = index;
      if (session.horizontal && from !== index) {
        const insertion = index + (direction(event, from, index) === "after" ? 1 : 0);
        to = insertion - (from < insertion ? 1 : 0);
      }
      event.preventDefault(); event.stopPropagation(); session.finish(from !== to);
      if (from !== to) session.move(from, to);
    },
    end() { session.finish(false); },
  };
}

const LOOP_MODES: { id: string; label: string }[] = [
  { id: "sequence", label: "顺序播放" },
  { id: "list", label: "列表循环" },
  { id: "single", label: "单曲循环" },
];

const MAX_CONSECUTIVE_RESOLVE_FAILURES: number = 5;

const MAX_AUDIO_RECOVERIES: number = 2;

const LOAD_MORE_THRESHOLD_PX: number = 96;

const PLAYBACK_STATE_SAVE_INTERVAL_MS: number = 15_000;

const LAST_SEARCH_KEY = "bilibili-music.last-search";

const pageModalOpeners = new WeakMap();

const observedPageCountTargets = new Map();

const visiblePageCountTargets = new Map();

const pageCountLookupQueue: string[] = [];

const PAGE_COUNT_LOOKUP_CONCURRENCY: number = 2;

const PAGE_COUNT_LOOKUP_INTERVAL_MS: number = 300;

const pendingPageCacheTargets = new Map();

export { rowDragHandlers, LAST_SEARCH_KEY, LOAD_MORE_THRESHOLD_PX, LOOP_MODES, MAX_AUDIO_RECOVERIES, MAX_CONSECUTIVE_RESOLVE_FAILURES, PAGE_COUNT_LOOKUP_CONCURRENCY, PAGE_COUNT_LOOKUP_INTERVAL_MS, PLAYBACK_STATE_SAVE_INTERVAL_MS, observedPageCountTargets, pageCountLookupQueue, pageModalOpeners, pendingPageCacheTargets, visiblePageCountTargets };
