import type { HomeSnapshot } from "../../store/app-state.ts";
import { isHomePopular } from "../../store/app-state.ts";
import { homeCacheNote, homeListLabel, homeModeTabs, homePanel, homeRankingError, homeRankingList, homeRankingStatus, homeSourceLabel, homeSubtitle, homeTitle, refreshRankingButton } from "../../platform/player-dom.ts";
type HomeRowsRenderer = (videos: HomeSnapshot["ranking"], source: string, skeleton: boolean) => void;

function renderHomeMode(homeState: HomeSnapshot): void {
  const isRecommendation = homeState.mode === "recommendation";
  const showPopular = isHomePopular(homeState);
  homePanel?.setAttribute("data-home-mode", showPopular ? "popular" : homeState.mode);
  for (const tab of homeModeTabs) {
    const active = tab.dataset.homeMode === homeState.mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  if (homeSourceLabel) {
    homeSourceLabel.textContent = isRecommendation && !showPopular ? "AI 推荐" : "B站音乐区";
  }
  if (homeTitle) {
    homeTitle.textContent = showPopular ? "热门音乐" : isRecommendation ? "为你推荐" : "音乐飙升榜";
  }
  if (homeSubtitle) {
    homeSubtitle.textContent = showPopular
      ? "未配置 AI 推荐 · 展示 B站 音乐热门榜"
      : isRecommendation
        ? "根据收藏、搜索、歌单和听歌记录生成"
        : "B站音乐区热门视频";
  }
  if (homeCacheNote) {
    homeCacheNote.textContent = "";
  }
  refreshRankingButton.title = isRecommendation && !showPopular
    ? "本次会话缓存，手动刷新会重新生成推荐"
    : "游客榜单，本次运行缓存";
  if (homeListLabel) {
    homeListLabel.textContent = showPopular
      ? "热门音乐榜"
      : isRecommendation
        ? "推荐列表"
        : "上升中的音乐视频";
  }
}

function renderHomeRanking(homeState: HomeSnapshot, renderRows: HomeRowsRenderer): boolean {
  if (!homeRankingList) {
    return false;
  }
  renderHomeMode(homeState);
  renderRows([], homeState.view.content.kind === "recommendations" ? "recommendation" : "ranking", false);

  homePanel?.classList.remove("needs-setup");
  if (homeState.loading) {
    renderRows([], homeState.view.content.kind === "recommendations" ? "recommendation" : "ranking", true);
    return false;
  }
  if (homeState.error) {
    homeRankingError.textContent = "拉取失败，点击重试";
    return false;
  }
  homeRankingError.textContent = "";
  renderRows(homeState.ranking, "ranking", false);
  if (isHomePopular(homeState)) {
    showHomeNotice("配置 API Key 后可生成专属推荐", "", true);
  }
  return true;
}

function showHomeNotice(title: string, sub: string, inline: boolean = false): void {

  homePanel?.classList.toggle("needs-setup", !inline);
}

function renderRecommendations(homeState: HomeSnapshot, renderRows: HomeRowsRenderer): boolean {
  if (!homeRankingList) {
    return false;
  }
  renderHomeMode(homeState);
  renderRows([], homeState.view.content.kind === "recommendations" ? "recommendation" : "ranking", false);

  homePanel?.classList.remove("needs-setup");
  if (homeState.recommendationLoading) {
    renderRows([], homeState.view.content.kind === "recommendations" ? "recommendation" : "ranking", true);
    return false;
  }
  if (homeState.recommendationError) {
    showHomeNotice(
      "推荐生成失败",
      `${homeState.recommendationError}｜请在「设置 → AI 推荐」检查 API Key 与模型配置`,
    );
    homeRankingError.textContent = "";
    return false;
  }
  if (homeState.recommendations.length === 0) {
    homeRankingError.textContent = "";
    return false;
  }
  homeRankingError.textContent = "";
  renderRows(homeState.recommendations, "recommendation", false);
  return true;
}

function renderHomeSnapshot(home: HomeSnapshot, previous: HomeSnapshot | null, renderRows: HomeRowsRenderer): boolean {
  const view = home.view;
  if (view.status !== null && view.status !== previous?.view.status) homeRankingStatus.textContent = view.status;
  if (view.rankingError !== null && view.rankingError !== previous?.view.rankingError) homeRankingError.textContent = view.rankingError.text;
  if (view.refreshDisabled !== null && view.refreshDisabled !== previous?.view.refreshDisabled) refreshRankingButton.disabled = view.refreshDisabled;
  if (view.content === previous?.view.content) return false;
  if (view.content.kind === "ranking") return renderHomeRanking(home, renderRows);
  if (view.content.kind === "recommendations") return renderRecommendations(home, renderRows);
  renderHomeMode(home);
  return false;
}

export { renderHomeSnapshot };
