import type { ApplicationSnapshot } from "../store/application-store.ts";
import { isHomePopular } from "../store/app-state.ts";
type PageCallbacks = {
  submit(event: SubmitEvent): void; hint(): void; hintKey(event: KeyboardEvent): void; setup(): void;
  division(tids: string): void; sort(mode: string): void;
  createPlaylist(): void; renamePlaylist(): void; deletePlaylist(): void; importPlaylist(): void;
};
const pageHandlers: Partial<PageCallbacks> = {};
const pageCallbacks = Object.freeze<PageCallbacks>({
  submit: event => pageHandlers.submit?.(event), hint: () => pageHandlers.hint?.(), hintKey: event => pageHandlers.hintKey?.(event), setup: () => pageHandlers.setup?.(),
  division: tids => pageHandlers.division?.(tids), sort: mode => pageHandlers.sort?.(mode),
  createPlaylist: () => pageHandlers.createPlaylist?.(), renamePlaylist: () => pageHandlers.renamePlaylist?.(), deletePlaylist: () => pageHandlers.deletePlaylist?.(), importPlaylist: () => pageHandlers.importPlaylist?.(),
});
function installPageCallbacks(handlers: Partial<PageCallbacks>): void { Object.assign(pageHandlers, handlers); }

let homeControls = { hintHidden: true, hintDisabled: false, hintText: "生成推荐", setupHidden: true, setupInline: false, setupSettingsHidden: false, setupTitle: "「为你推荐」需要你自己的大模型 API Key", setupSub: "在「设置 → AI 推荐」填入 API Key，即可根据你的收藏、歌单与听歌记录生成推荐。不配置也能正常搜索与播放。" };
let previousHome: ApplicationSnapshot["home"] | null = null;
function projectHomeControls(home: ApplicationSnapshot["home"]): HomeControls {
  if (home === previousHome) return homeControls;
  const next = { ...homeControls };
  if (home.view.hintDisabled !== null) next.hintDisabled = home.view.hintDisabled;
  if (home.view.hintText !== null) next.hintText = home.view.hintText;
  if (home.view.content !== previousHome?.view.content) {
    const popular = isHomePopular(home), kind = home.view.content.kind;
    next.hintHidden = home.mode !== "recommendation" || popular;
    if (kind !== "mode") {
      next.setupHidden = true; next.setupInline = false; next.setupSettingsHidden = false;
      if (kind === "ranking" && !home.loading && !home.error && popular) Object.assign(next, { setupHidden: false, setupInline: true, setupTitle: "配置 API Key 后可生成专属推荐", setupSub: "" });
      if (kind === "recommendations" && !home.recommendationLoading && home.recommendationError) {
        const needsSettings = /API\s*key|密钥|配置|HTTP\s+(?:400|401|403|404)\b|base_url/i.test(home.recommendationError);
        Object.assign(next, { setupHidden: false, setupInline: home.recommendations.length > 0, setupSettingsHidden: !needsSettings,
          setupTitle: "推荐生成失败", setupSub: needsSettings ? `${home.recommendationError}｜请在「设置 → AI 推荐」检查 API Key 与模型配置` : home.recommendationError });
      }
    }
  }
  previousHome = home;
  if ((Object.keys(next) as (keyof typeof next)[]).some(key => next[key] !== homeControls[key])) homeControls = next;
  return homeControls;
}
export { installPageCallbacks, pageCallbacks, projectHomeControls };
type HomeControls = Readonly<typeof homeControls>;
export type { HomeControls, PageCallbacks };
