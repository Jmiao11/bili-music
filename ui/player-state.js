const LOOP_MODES = [
  { id: "sequence", label: "顺序播放" },
  { id: "list", label: "列表循环" },
  { id: "single", label: "单曲循环" },
];

const MAX_CONSECUTIVE_RESOLVE_FAILURES = 5;

const MAX_AUDIO_RECOVERIES = 2;

const SEARCH_PAGE_SIZE = 20;

const LOAD_MORE_THRESHOLD_PX = 96;

const DEFAULT_MUSIC_TIDS = 3;

const MUSIC_HOT_KEYWORD = "音乐";

const PLAYBACK_STATE_SAVE_INTERVAL_MS = 15_000;

const playerState = {
  queue: [],
  queueSource: "none",
  queueSearchVersion: null,
  queuePlaylistId: null,
  currentIndex: -1,
  loopMode: "sequence",
  shuffle: false,
  randomRemaining: [],
  history: [],
  requestVersion: 0,
  activeAudioVersion: -1,
  activeAudioUrl: "",
  audioActivatedAt: Number.POSITIVE_INFINITY,
  consecutiveResolveFailures: 0,
  currentPages: [],
  currentPageIndex: 0,
  currentDisplayTrack: null,
};

const searchState = {
  results: [],
  userKeyword: "",
  requestKeyword: "",
  tids: DEFAULT_MUSIC_TIDS,
  order: null,
  rerank: true,
  sortMode: "all",
  page: 0,
  isLoadingMore: false,
  hasMore: false,
  requestVersion: 0,
};

const LAST_SEARCH_KEY = "bilibili-music.last-search";

const homeState = {
  mode: "recommendation",
  ranking: [],
  recommendations: [],
  loaded: false,
  loading: false,
  error: "",
  recommendationLoaded: false,
  recommendationLoading: false,
  recommendationError: "",
  userHint: "",
  aiHasKey: null,
};

const libraryState = {
  favorites: [],
  favoriteBvids: new Set(),
  playlists: [],
  unavailableBvids: new Map(),
  disabledPages: new Map(),
  disabledPagePending: new Map(),
  selectedPlaylistId: "",
  loadError: "",
};

const favoriteDragState = {
  drag: null,
  saving: false,
  suppressClickUntil: 0,
};

const playlistDragState = {
  drag: null,
  saving: false,
  suppressClickUntil: 0,
};

const playlistListDragState = {
  drag: null,
  saving: false,
  suppressClickUntil: 0,
};

const videoPageCounts = new Map();

const videoPagesByBvid = new Map();

const pageModalOpeners = new WeakMap();

const failedPageCountBvids = new Set();

const queuedPageCountBvids = new Set();

const activePageCountBvids = new Set();

const observedPageCountTargets = new Map();

const visiblePageCountTargets = new Map();

const pageCountLookupQueue = [];

const PAGE_COUNT_LOOKUP_CONCURRENCY = 2;

const PAGE_COUNT_LOOKUP_INTERVAL_MS = 300;

const pendingPageCacheTargets = new Map();

export { DEFAULT_MUSIC_TIDS, LAST_SEARCH_KEY, LOAD_MORE_THRESHOLD_PX, LOOP_MODES, MAX_AUDIO_RECOVERIES, MAX_CONSECUTIVE_RESOLVE_FAILURES, MUSIC_HOT_KEYWORD, PAGE_COUNT_LOOKUP_CONCURRENCY, PAGE_COUNT_LOOKUP_INTERVAL_MS, PLAYBACK_STATE_SAVE_INTERVAL_MS, SEARCH_PAGE_SIZE, activePageCountBvids, failedPageCountBvids, favoriteDragState, homeState, libraryState, observedPageCountTargets, pageCountLookupQueue, pageModalOpeners, pendingPageCacheTargets, playerState, playlistDragState, playlistListDragState, queuedPageCountBvids, searchState, videoPageCounts, videoPagesByBvid, visiblePageCountTargets };
