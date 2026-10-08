type NormalizedTrack = ReturnType<typeof import("./track-utils.ts").normalizeTrack>;

const LOOP_MODES: { id: string; label: string }[] = [
  { id: "sequence", label: "顺序播放" },
  { id: "list", label: "列表循环" },
  { id: "single", label: "单曲循环" },
];

const MAX_CONSECUTIVE_RESOLVE_FAILURES: number = 5;

const MAX_AUDIO_RECOVERIES: number = 2;

const LOAD_MORE_THRESHOLD_PX: number = 96;

const PLAYBACK_STATE_SAVE_INTERVAL_MS: number = 15_000;

const playerState = {
  queue: [] as NormalizedTrack[],
  queueSource: "none",
  queueSearchVersion: null as number | null,
  queuePlaylistId: null as string | null,
  currentIndex: -1,
  loopMode: "sequence",
  shuffle: false,
  randomRemaining: [] as number[],
  history: [] as { index: number; cid: number | null; pageLevel?: boolean }[],
  requestVersion: 0,
  activeAudioVersion: -1,
  activeAudioUrl: "",
  audioActivatedAt: Number.POSITIVE_INFINITY,
  consecutiveResolveFailures: 0,
  currentPages: [] as CommandContract.VideoPage[],
  currentPageIndex: 0,
  currentDisplayTrack: null as (CommandContract.TrackSnapshotInput & { hasCurrent: boolean }) | null,
  lastEmittedTrackIdentity: "",
};

const LAST_SEARCH_KEY = "bilibili-music.last-search";

const libraryState = {
  disabledPages: new Map<string, Set<number>>(),
  disabledPagePending: new Map<string, number | null>(),
};

const videoPageCounts = new Map<string, number>();

const videoPagesByBvid = new Map();

const pageModalOpeners = new WeakMap();

const failedPageCountBvids = new Set<string>();

const queuedPageCountBvids = new Set<string>();

const activePageCountBvids = new Set<string>();

const observedPageCountTargets = new Map();

const visiblePageCountTargets = new Map();

const pageCountLookupQueue: string[] = [];

const PAGE_COUNT_LOOKUP_CONCURRENCY: number = 2;

const PAGE_COUNT_LOOKUP_INTERVAL_MS: number = 300;

const pendingPageCacheTargets = new Map();

export { LAST_SEARCH_KEY, LOAD_MORE_THRESHOLD_PX, LOOP_MODES, MAX_AUDIO_RECOVERIES, MAX_CONSECUTIVE_RESOLVE_FAILURES, PAGE_COUNT_LOOKUP_CONCURRENCY, PAGE_COUNT_LOOKUP_INTERVAL_MS, PLAYBACK_STATE_SAVE_INTERVAL_MS, activePageCountBvids, failedPageCountBvids, libraryState, observedPageCountTargets, pageCountLookupQueue, pageModalOpeners, pendingPageCacheTargets, playerState, queuedPageCountBvids, videoPageCounts, videoPagesByBvid, visiblePageCountTargets };
