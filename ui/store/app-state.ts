import { createLyricsDisplayActions, initialLyricsDisplayState } from "../features/immersive/lyrics-display-state.ts";
import { createPlaybackMessagesActions, initialPlaybackMessagesState, messagesWithStatus } from "../features/playback/playback-messages-state.ts";
import { createPlaybackRequestActions, initialPlaybackRequestState } from "../features/playback/playback-request-state.ts";
import type { PlaybackRequestState } from "../features/playback/playback-request-state.ts";
import { createPlaybackSessionActions, initialPlaybackSessionState } from "../features/playback/playback-session-state.ts";
import type { PlaybackSessionState } from "../features/playback/playback-session-state.ts";
import { createPlaybackQueueActions, initialPlaybackQueueState } from "../features/playback/playback-queue-state.ts";
import { createPlaybackDisplayActions, initialPlaybackDisplayState } from "../features/playback/playback-display-state.ts";
import { createPlaybackSettingsActions, initialPlaybackSettingsState } from "../features/playback/playback-settings-state.ts";
import { createSettingsActions, initialSettingsState } from "../features/settings/settings-state.ts";
import type { SettingsCommand, SettingsPlatform } from "../features/settings/settings-state.ts";
import { createPagesActions, initialPagesState, pagesWithDisabledError } from "../features/pages/pages-state.ts";
import { createRecentActions, initialRecentState } from "../features/recent/recent-state.ts";
import { createStateStore } from "./state-store.ts";
import type { DeepReadonly, StoreOptions } from "./state-store.ts";
import { normalizeTrack } from "../shared/track-utils.ts";
import { createSearchActions, initialSearchState } from "../features/search/search-state.ts";
import { createLibraryActions, initialLibraryState } from "../features/library/library-state.ts";
import { createCollectionActions, initialCollectionState } from "../features/collections/collection-state.ts";
import type { LibraryCommand } from "../features/library/library-state.ts";

type FeedSource = CommandMap["get_music_ranking"]["args"]["source"];
type FeedMode = CommandMap["get_music_ranking"]["args"]["mode"];
type FeedView = { fetchedAt: number; date: string; timestamp: string; busy: boolean; notice: string; restricted: boolean };
const emptyFeed = (): FeedView => ({ fetchedAt: 0, date: "", timestamp: "", busy: false, notice: "", restricted: false });
type HomeState = {
  feed: Record<FeedSource, FeedView>;
  newSongs: ReturnType<typeof normalizeTrack>[];
  cooling: boolean;
  update: { version: string | null; opening: boolean; error: boolean };
  ranking: ReturnType<typeof normalizeTrack>[];
  recommendations: ReturnType<typeof normalizeTrack>[];
  loaded: boolean;
  loading: boolean;
  error: string;
  recommendationLoaded: boolean;
  recommendationLoading: boolean;
  recommendationError: string;
  userHint: string;
  aiHasKey: boolean | null;
  view: {
    section: FeedSource | null;
    content: { kind: "mode" | "ranking" | "recommendations" };
    status: string | null;
    rankingError: { text: string } | null;
    hintDisabled: boolean | null;
    hintText: string | null;
    refreshDisabled: boolean | null;
  };
};
type HomeSnapshot = DeepReadonly<HomeState>;
type ApplicationStoreOptions = StoreOptions & { playbackRequest?: PlaybackRequestState; playbackSession?: PlaybackSessionState };

type HomeAdapter = {
  now?: () => number;
  settings?: SettingsPlatform;
  invoke: <K extends "check_for_update" | "open_update_download" | "get_ai_config" | "get_music_ranking" | "get_saved_recommendations" | "get_recommendations" | "search_videos" | "record_search_history" | LibraryCommand | SettingsCommand | "get_video_meta" | "get_cached_video_pages" | "get_collection_page" | "get_play_history" | "check_audio_cache">(command: K, ...args: CommandArguments<K>) => Promise<CommandMap[K]["result"]>;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
  report: (level: "warn" | "error", message: string, error: unknown) => void;
};

function isHomePopular(home: HomeSnapshot): boolean {
  return home.aiHasKey === false;
}

function createApplicationStore(adapter: HomeAdapter, options: ApplicationStoreOptions = {}) {
  const initial: { recent: ReturnType<typeof initialRecentState>; lyricsDisplay: ReturnType<typeof initialLyricsDisplayState>; playbackMessages: ReturnType<typeof initialPlaybackMessagesState>; playbackSession: PlaybackSessionState; playbackRequest: PlaybackRequestState; playbackQueue: ReturnType<typeof initialPlaybackQueueState>; playbackDisplay: ReturnType<typeof initialPlaybackDisplayState>; playbackSettings: ReturnType<typeof initialPlaybackSettingsState>; settings: ReturnType<typeof initialSettingsState>; pages: ReturnType<typeof initialPagesState>; home: HomeState; search: ReturnType<typeof initialSearchState>; library: ReturnType<typeof initialLibraryState>; collection: ReturnType<typeof initialCollectionState> } = { recent: initialRecentState(), lyricsDisplay: initialLyricsDisplayState(), playbackMessages: initialPlaybackMessagesState(), collection: initialCollectionState(), home: {
    update: { version: null, opening: false, error: false },
    feed: {ranking: emptyFeed(),newSongs: emptyFeed()}, cooling:false,newSongs:[], ranking: [], recommendations: [], loaded: false, loading: false,
    error: "", recommendationLoaded: false, recommendationLoading: false, recommendationError: "",
    userHint: "", aiHasKey: null,
    view: { section: null, content: { kind: "mode" }, status: null, rankingError: null, hintDisabled: null, hintText: null, refreshDisabled: null },
  }, search: initialSearchState(), library: initialLibraryState(), pages: initialPagesState(), settings: initialSettingsState(), playbackSettings: initialPlaybackSettingsState(), playbackDisplay: initialPlaybackDisplayState(), playbackQueue: initialPlaybackQueueState(), playbackRequest: options.playbackRequest ?? initialPlaybackRequestState(), playbackSession: options.playbackSession ?? initialPlaybackSessionState() };
  return createStateStore(initial, (getState, commit) => {
    let recommendationRequestVersion = 0;
    const home = () => getState().home;
    const update = (fields: Partial<HomeSnapshot>, view: Partial<HomeSnapshot["view"]> = {}) => {
      const current = getState();
      commit({ ...current, home: { ...current.home, ...fields, view: Object.keys(view).length ? { ...current.home.view, ...view } : current.home.view } });
    };
    const content = (kind: "mode" | "ranking" | "recommendations") => ({ kind });
    function openHomeSection(section: FeedSource | null) {
      if (home().view.section !== section && (section === null || isHomePopular(home()))) update({}, { section });
    }
    const rankingVisible = () => isHomePopular(home());
    const recommendationVisible = () => !isHomePopular(home());

    const clock = () => {
      if (!adapter.now) throw new Error("首页缺少时钟适配器");
      return adapter.now();
    };
    let cooldownTimer = 0;
    let cooldownUntil = 0;
    let feedSequence = -1;

    function localDate(ms: number) {
      const d = new Date(ms);
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
    }

    function markRequest(start: number) {
      const deadline = start + 60_000;
      if (deadline <= cooldownUntil || deadline <= clock()) return;
      cooldownUntil = deadline;
      adapter.clearTimeout(cooldownTimer);
      update({ cooling: true });
      cooldownTimer = adapter.setTimeout(() => {
        cooldownUntil = 0;
        const { aiHasKey, feed } = home();
        update({ cooling: false }, aiHasKey === true ? {} : { refreshDisabled: feed.ranking.busy || feed.newSongs.busy });
      }, deadline - clock());
    }

    function sourceNotice(mode: FeedMode, hasItems: boolean) {
      if (!hasItems) return "拉取失败，点击重试";
      return mode === "retry" || mode === "refresh" ? "更新失败，点击重试" : "";
    }

    async function loadSection(source: FeedSource, mode: FeedMode, start = clock()) {
      const today = localDate(start);
      const previous = home().feed[source];
      const oldItems = home()[source];
      if (previous.busy || (mode === "retry" && previous.restricted && cooldownUntil > start)) return;
      if (mode === "auto" && previous.date === today && oldItems.length) return;

      const isRanking = source === "ranking";
      const patchSection = (fields: Partial<FeedView>) => ({
        ...home().feed, [source]: { ...home().feed[source], ...fields },
      });
      const contentView = () => home().aiHasKey === true ? {} : { content: content("ranking") };
      const refreshDisabled = (feed: HomeSnapshot["feed"]) => home().aiHasKey === true
        ? home().view.refreshDisabled : home().cooling || feed.ranking.busy || feed.newSongs.busy;
      update({
        feed: patchSection({ busy: true, notice: "" }),
        ...(isRanking ? { loading: true, error: "" } : {}),
      }, {
        ...contentView(), refreshDisabled: true,
        ...(isRanking ? { status: mode === "refresh" ? "正在刷新音乐热门…" : "正在加载音乐热门…" } : {}),
      });
      if (mode === "refresh" || mode === "retry") markRequest(start);
      try {
        const reply = await adapter.invoke("get_music_ranking", { source, mode, today });
        if (reply.requestAt !== null) markRequest(Math.min(start,reply.requestAt));
        const { section } = reply;
        const time = new Date(section.fetchedAt).toTimeString().slice(0, 5);
        const timestamp = section.fetchedAt ? (section.date === today ? "" : section.date + " ") + time : "";
        const notice = reply.error ? sourceNotice(mode, section.items.length > 0) : "";
        const feed = patchSection({ busy: false, fetchedAt: section.fetchedAt, date: section.date, timestamp, notice, restricted: reply.restricted });

        const replaceRanking = isRanking && (!reply.error || section.fetchedAt !== previous.fetchedAt || !home().loaded);
        const ranking = replaceRanking ? section.items.map(normalizeTrack) : home().ranking;
        const sameSongs = reply.newSongs.length === home().newSongs.length && reply.newSongs.every((row, i) => {
          const prior = home().newSongs[i];
          return row.bvid === prior.bvid && row.title === prior.title && row.uploader === prior.uploader &&
            row.durationSeconds === prior.durationSeconds && row.thumbnailUrl === prior.thumbnailUrl;
        });
        const newSongs = reply.sequence >= feedSequence && !sameSongs ? reply.newSongs.map(normalizeTrack) : home().newSongs;
        feedSequence = Math.max(feedSequence, reply.sequence);
        update({
          feed, newSongs,
          ...(isRanking ? { ranking, loaded: true, loading: false, error: ranking.length ? "" : notice } : {}),
        }, {
          ...contentView(), refreshDisabled: refreshDisabled(feed),
          ...(isRanking ? { status: reply.error ? "" : "已加载 " + ranking.length + " 首音乐区热门视频。", rankingError: { text: notice } } : {}),
        });
      } catch (error) {
        if (mode !== "cache") markRequest(start);
        const notice = sourceNotice(mode, oldItems.length > 0);
        const feed = patchSection({ busy: false, notice, restricted: false });
        update({
          feed, ...(isRanking ? { loading: false, error: oldItems.length ? "" : notice } : {}),
        }, {
          ...contentView(), refreshDisabled: refreshDisabled(feed),
          ...(isRanking ? { status: oldItems.length ? "" : "音乐热门拉取失败。", rankingError: { text: notice } } : {}),
        });
        adapter.report("error", "homepage section failed", error);
      }
    }

    async function loadRanking({ forceRefresh = false, cacheOnly = false }: { forceRefresh?: boolean; cacheOnly?: boolean } = {}) {
      const start = clock();
      const { ranking, newSongs } = home().feed;
      if (forceRefresh && (cooldownUntil > start || ranking.busy || newSongs.busy)) return;
      const mode = cacheOnly ? "cache" : forceRefresh ? "refresh" : "auto";
      await Promise.all([loadSection("ranking", mode, start), loadSection("newSongs", mode, start)]);
    }

    async function loadSavedRecommendations(): Promise<void> {
      if (home().recommendationLoaded || home().recommendationLoading) {
        update({}, { content: content("recommendations") }); return;
      }
      const version = ++recommendationRequestVersion;
      update({ recommendationLoading: true, recommendationError: "" }, {
        hintDisabled: true, refreshDisabled: true, status: "正在读取上次推荐…", content: content("recommendations"),
      });
      try {
        const recommendations = (await adapter.invoke("get_saved_recommendations")).map(normalizeTrack);
        if (version !== recommendationRequestVersion) return;
        update({ recommendations, recommendationLoaded: true, recommendationLoading: false }, {
          status: recommendations.length > 0 ? `已加载 ${recommendations.length} 首上次推荐。` : "点击「生成推荐」获取你的专属推荐",
          hintDisabled: false, refreshDisabled: false,
          ...(recommendationVisible() ? { content: content("recommendations") } : {}),
        });
      } catch (_error) {
        if (version !== recommendationRequestVersion) return;
        update({ recommendationLoaded: true, recommendationError: "", recommendationLoading: false }, {
          status: "", hintDisabled: false, refreshDisabled: false,
          ...(recommendationVisible() ? { content: content("recommendations") } : {}),
        });
      }
    }

    function loadRecommendation(): Promise<void> {
      return home().aiHasKey === false ? loadRanking() : loadSavedRecommendations();
    }

    async function refreshKey(cacheOnly = false): Promise<void> {
      try {
        const aiHasKey = !!(await adapter.invoke("get_ai_config")).hasKey;
        update({ aiHasKey }, aiHasKey ? { section: null } : {});
      }
      catch (_error) { update({ aiHasKey: null }, { section: null }); }
      if(cacheOnly && home().aiHasKey===false) await loadRanking({cacheOnly:true});
      else await loadRecommendation();
    }

    async function generateRecommendations({ forceRefresh = false, userHint = home().userHint }: { forceRefresh?: boolean; userHint?: string } = {}): Promise<void> {
      if (home().recommendationLoading) return;
      if (!forceRefresh && home().recommendationLoaded) {
        update({ userHint }, { content: content("recommendations") }); return;
      }
      const version = ++recommendationRequestVersion;
      update({ userHint, recommendationLoading: true, recommendationError: "" }, {
        hintDisabled: true, hintText: "生成中…", refreshDisabled: true,
        status: forceRefresh ? "正在重新生成推荐…" : "正在根据搜索与收藏生成推荐…",
        content: content("recommendations"),
      });
      let timeoutId = 0;
      try {
        const hint = home().userHint.trim();
        const timeout: Promise<never> = new Promise((_, reject) => {
          timeoutId = adapter.setTimeout(() => reject(new Error("推荐耗时较长，请稍后重试。")), 95000);
        });
        const tracks = await Promise.race([adapter.invoke("get_recommendations", hint ? { userHint: hint } : {}), timeout])
          .finally(() => adapter.clearTimeout(timeoutId));
        if (version !== recommendationRequestVersion) return;
        const recommendations = tracks.map(normalizeTrack);
        update({ recommendations, recommendationLoaded: true, recommendationError: "", recommendationLoading: false }, {
          status: recommendations.length > 0 ? `已生成 ${recommendations.length} 首推荐。` : "暂无推荐结果。",
          refreshDisabled: false, hintDisabled: false, hintText: "生成推荐", content: content("recommendations"),
        });
      } catch (error) {
        if (version !== recommendationRequestVersion) return;
        update({ recommendationError: String((error as { message?: unknown } | null | undefined)?.message ?? error), recommendationLoading: false }, {
          status: "为你推荐生成失败。", refreshDisabled: false, hintDisabled: false, hintText: "生成推荐", content: content("recommendations"),
        });
        adapter.report("warn", "recommendations load failed:", error);
      }
    }

    function changeHint(userHint: string): void { update({ userHint }); }
    let updateChecked = false;
    async function checkForUpdate(): Promise<void> {
      if (updateChecked) return;
      updateChecked = true;
      try {
        const result = await adapter.invoke("check_for_update");
        if (result?.version) update({ update: { version: result.version, opening: false, error: false } });
      } catch (error) {
        adapter.report("warn", "update check failed:", error);
      }
    }
    async function openUpdateDownload(): Promise<void> {
      if (!home().update.version || home().update.opening) return;
      update({ update: { ...home().update, opening: true, error: false } });
      try {
        await adapter.invoke("open_update_download");
        update({ update: { ...home().update, opening: false } });
      } catch (error) {
        update({ update: { ...home().update, opening: false, error: true } });
        adapter.report("warn", "update download page open failed:", error);
      }
    }
    const recent = createRecentActions(() => getState().recent, next => commit({ ...getState(), recent: next }), adapter);
    const lyricsDisplay = createLyricsDisplayActions(() => getState().lyricsDisplay, next => commit({ ...getState(), lyricsDisplay: next }));
    const playbackSession = createPlaybackSessionActions(() => getState().playbackSession, next => commit({ ...getState(), playbackSession: next }));
    const playbackRequest = createPlaybackRequestActions(() => getState().playbackRequest, next => commit({ ...getState(), playbackRequest: next }));
    const search = createSearchActions(() => getState().search, next => commit({ ...getState(), search: next }), adapter);
    const collection = createCollectionActions(() => getState().collection, next => commit({ ...getState(), collection: next }), adapter, (reference, snapshot) => library.refreshCollectionEntry(reference, snapshot));
    const playbackQueue = createPlaybackQueueActions(() => getState().playbackQueue, next => commit({ ...getState(), playbackQueue: next }));
    const playbackDisplay = createPlaybackDisplayActions(() => getState().playbackDisplay, next => commit({ ...getState(), playbackDisplay: next }));
    const playbackSettings = createPlaybackSettingsActions(() => getState().playbackSettings, next => commit({ ...getState(), playbackSettings: next }));
    const settings = createSettingsActions(() => getState().settings, next => commit({ ...getState(), settings: next }), adapter);
    const pages = createPagesActions(() => getState().pages, next => {
      const current = getState();
      commit({ ...current, pages: next, playbackMessages: next.view.status && next.view.status !== current.pages.view.status
        ? messagesWithStatus(current.playbackMessages, next.view.status.text ?? "") : current.playbackMessages });
    });
    const library = createLibraryActions(() => getState().library, (next, disabledResult) => {
      const current = getState();
      commit({ ...current, library: next,
        playbackMessages: next.view.playbackVersion !== current.library.view.playbackVersion && next.view.playbackStatus !== null
          ? messagesWithStatus(current.playbackMessages, next.view.playbackStatus) : current.playbackMessages,
        ...(disabledResult ? { pages: pagesWithDisabledError(current.pages, disabledResult.bvid, disabledResult.error) } : {}) });
    }, adapter);
    const playbackMessages = createPlaybackMessagesActions(() => getState().playbackMessages, next => commit({ ...getState(), playbackMessages: next }));
    return { recent, lyricsDisplay, playbackMessages, playbackSession, playbackRequest, playbackQueue, playbackDisplay, playbackSettings, settings, pages, library, search, collection, checkForUpdate, openUpdateDownload, openHomeSection, loadHomeRanking: loadRanking, retryHomeSection: (source:FeedSource)=>loadSection(source,"retry"), loadRecommendationHome: loadRecommendation, loadRecommendations: generateRecommendations, refreshAiKeyState: refreshKey, setHomeHint: changeHint };
  }, options);
}

export { createApplicationStore, isHomePopular };
export type { HomeAdapter, HomeSnapshot };
