import { createPagesActions, initialPagesState, pagesWithDisabledError } from "./pages-state.ts";
import { createStateStore } from "./state-store.ts";
import type { DeepReadonly, StoreOptions } from "./state-store.ts";
import { normalizeTrack } from "./track-utils.ts";
import { createSearchActions, initialSearchState } from "./search-state.ts";
import { createLibraryActions, initialLibraryState } from "./library-state.ts";
import type { LibraryCommand } from "./library-state.ts";

type HomeState = {
  mode: string;
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
    content: { kind: "mode" | "ranking" | "recommendations" };
    status: string | null;
    rankingError: { text: string } | null;
    hintDisabled: boolean | null;
    hintText: string | null;
    refreshDisabled: boolean | null;
  };
};
type HomeSnapshot = DeepReadonly<HomeState>;
type HomeAdapter = {
  invoke: <K extends "get_ai_config" | "get_music_ranking" | "get_saved_recommendations" | "get_recommendations" | "search_videos" | "record_search_history" | LibraryCommand | "get_video_meta" | "get_cached_video_pages">(command: K, ...args: CommandArguments<K>) => Promise<CommandMap[K]["result"]>;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
  report: (level: "warn" | "error", message: string, error: unknown) => void;
};

function isHomePopular(home: HomeSnapshot): boolean {
  return home.mode === "recommendation" && home.aiHasKey === false;
}

function createApplicationStore(adapter: HomeAdapter, options: StoreOptions = {}) {
  const initial: { pages: ReturnType<typeof initialPagesState>; home: HomeState; search: ReturnType<typeof initialSearchState>; library: ReturnType<typeof initialLibraryState> } = { home: {
    mode: "recommendation", ranking: [], recommendations: [], loaded: false, loading: false,
    error: "", recommendationLoaded: false, recommendationLoading: false, recommendationError: "",
    userHint: "", aiHasKey: null,
    view: { content: { kind: "mode" }, status: null, rankingError: null, hintDisabled: null, hintText: null, refreshDisabled: null },
  }, search: initialSearchState(), library: initialLibraryState(), pages: initialPagesState() };
  return createStateStore(initial, (getState, commit) => {
    const home = () => getState().home;
    const update = (fields: Partial<HomeSnapshot>, view: Partial<HomeSnapshot["view"]> = {}) => {
      const current = getState();
      commit({ ...current, home: { ...current.home, ...fields, view: Object.keys(view).length ? { ...current.home.view, ...view } : current.home.view } });
    };
    const content = (kind: "mode" | "ranking" | "recommendations") => ({ kind });
    const rankingVisible = () => home().mode === "ranking" || isHomePopular(home());
    const recommendationVisible = () => home().mode === "recommendation" && !isHomePopular(home());

    async function loadRanking({ forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<void> {
      if (!forceRefresh && home().loaded && home().ranking.length > 0) {
        update({}, { content: content("ranking") }); return;
      }
      update({ loading: true, error: "" }, {
        status: forceRefresh ? "正在刷新音乐飙升榜…" : "正在拉取 B站音乐区热门内容…",
        refreshDisabled: true, ...(rankingVisible() ? { content: content("ranking") } : {}),
      });
      try {
        const ranking = (await adapter.invoke("get_music_ranking", { forceRefresh })).map(normalizeTrack);
        update({ ranking, loaded: true, error: "", loading: false }, {
          status: `已加载 ${ranking.length} 首音乐区热门视频。`, refreshDisabled: false,
          ...(rankingVisible() ? { content: content("ranking") } : {}),
        });
      } catch (error) {
        const popular = isHomePopular(home());
        update({ error: popular ? "" : String(error), loading: false }, {
          status: popular ? "" : "音乐飙升榜拉取失败。", refreshDisabled: false,
          ...(!popular ? { rankingError: { text: "拉取失败，点击重试" } } : {}),
          ...(rankingVisible() ? { content: content("ranking") } : {}),
        });
        if (!popular) adapter.report("error", "music ranking load failed:", error);
      }
    }

    async function loadSavedRecommendations(): Promise<void> {
      if (home().recommendationLoaded || home().recommendationLoading) {
        update({}, { content: content("recommendations") }); return;
      }
      update({ recommendationLoading: true, recommendationError: "" }, {
        hintDisabled: true, refreshDisabled: true, status: "正在读取上次推荐…", content: content("recommendations"),
      });
      try {
        const recommendations = (await adapter.invoke("get_saved_recommendations")).map(normalizeTrack);
        update({ recommendations, recommendationLoaded: true, recommendationLoading: false }, {
          status: recommendations.length > 0 ? `已加载 ${recommendations.length} 首上次推荐。` : "点击「生成推荐」获取你的专属推荐",
          hintDisabled: false, refreshDisabled: false,
          ...(recommendationVisible() ? { content: content("recommendations") } : {}),
        });
      } catch (_error) {
        update({ recommendationLoaded: true, recommendationError: "", recommendationLoading: false }, {
          status: "", hintDisabled: false, refreshDisabled: false,
          ...(recommendationVisible() ? { content: content("recommendations") } : {}),
        });
      }
    }

    function loadRecommendation(): Promise<void> {
      return home().aiHasKey === false ? loadRanking() : loadSavedRecommendations();
    }

    async function refreshKey(): Promise<void> {
      try { update({ aiHasKey: !!(await adapter.invoke("get_ai_config")).hasKey }); }
      catch (_error) { update({ aiHasKey: null }); }
      if (home().mode === "recommendation") await loadRecommendation();
    }

    async function generateRecommendations({ forceRefresh = false, userHint = home().userHint }: { forceRefresh?: boolean; userHint?: string } = {}): Promise<void> {
      if (!forceRefresh && home().recommendationLoaded) {
        update({ userHint }, { content: content("recommendations") }); return;
      }
      update({ userHint, recommendationLoading: true, recommendationError: "" }, {
        hintDisabled: true, hintText: "生成中…", refreshDisabled: true,
        status: forceRefresh ? "正在重新生成推荐…" : "正在根据搜索与收藏生成推荐…",
        ...(home().mode === "recommendation" ? { content: content("recommendations") } : {}),
      });
      let timeoutId = 0;
      try {
        const hint = home().userHint.trim();
        const timeout: Promise<never> = new Promise((_, reject) => {
          timeoutId = adapter.setTimeout(() => reject(new Error("request timeout")), 95000);
        });
        const tracks = await Promise.race([adapter.invoke("get_recommendations", hint ? { userHint: hint } : {}), timeout])
          .finally(() => adapter.clearTimeout(timeoutId));
        const recommendations = tracks.map(normalizeTrack);
        update({ recommendations, recommendationLoaded: true, recommendationError: "", recommendationLoading: false }, {
          status: recommendations.length > 0 ? `已生成 ${recommendations.length} 首推荐。` : "暂无推荐结果。",
          refreshDisabled: false, hintDisabled: false, hintText: "生成推荐",
          ...(home().mode === "recommendation" ? { content: content("recommendations") } : {}),
        });
      } catch (error) {
        update({ recommendationError: String((error as { message?: unknown } | null | undefined)?.message ?? error), recommendationLoading: false }, {
          status: "为你推荐生成失败。", refreshDisabled: false, hintDisabled: false, hintText: "生成推荐",
          ...(home().mode === "recommendation" ? { content: content("recommendations") } : {}),
        });
        adapter.report("warn", "recommendations load failed:", error);
      }
    }

    function changeMode(mode: string): void {
      const nextMode = mode === "recommendation" ? "recommendation" : "ranking";
      update({ mode: nextMode }, home().mode === nextMode
        ? { content: content(recommendationVisible() ? "recommendations" : "ranking") }
        : { rankingError: { text: "" }, content: content("mode") });
      if (home().mode === "recommendation") void loadRecommendation();
      else void loadRanking();
    }

    function changeHint(userHint: string): void { update({ userHint }); }
    const search = createSearchActions(() => getState().search, next => commit({ ...getState(), search: next }), adapter);
    const pages = createPagesActions(() => getState().pages, next => commit({ ...getState(), pages: next }));
    const library = createLibraryActions(() => getState().library, (next, disabledResult) => commit({ ...getState(), library: next, ...(disabledResult ? { pages: pagesWithDisabledError(getState().pages, disabledResult.bvid, disabledResult.error) } : {}) }), adapter);
    return { pages, library, search, loadHomeRanking: loadRanking, loadRecommendationHome: loadRecommendation, loadRecommendations: generateRecommendations, refreshAiKeyState: refreshKey, setHomeHint: changeHint, setHomeMode: changeMode };
  }, options);
}

export { createApplicationStore, isHomePopular };
export type { HomeAdapter, HomeSnapshot };
