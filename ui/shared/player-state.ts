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

export { LAST_SEARCH_KEY, LOAD_MORE_THRESHOLD_PX, LOOP_MODES, MAX_AUDIO_RECOVERIES, MAX_CONSECUTIVE_RESOLVE_FAILURES, PAGE_COUNT_LOOKUP_CONCURRENCY, PAGE_COUNT_LOOKUP_INTERVAL_MS, PLAYBACK_STATE_SAVE_INTERVAL_MS, observedPageCountTargets, pageCountLookupQueue, pageModalOpeners, pendingPageCacheTargets, visiblePageCountTargets };
