import type { HomeSnapshot } from "./app-state.ts";
import { isHomePopular } from "./app-state.ts";
import { homeCacheNote, homeHintApply, homeHintRow, homeListLabel, homeModeTabs, homePanel, homeRankingError, homeRankingList, homeRankingStatus, homeSetupHint, homeSetupSub, homeSetupTitle, homeSourceLabel, homeSubtitle, homeTitle, refreshRankingButton } from "./player-dom.ts";

type HomeRowFactory = (video: HomeSnapshot["ranking"][number], index: number, source: string, options: { showPlayCount: boolean }) => HTMLElement;

function renderRankingSkeleton(): void {
  if (!homeRankingList) {
    return;
  }
  homeRankingList.replaceChildren();
  for (let index = 0; index < 8; index += 1) {
    const item = document.createElement("li");
    item.className = "track-row skeleton-row";
    item.innerHTML = `
      <span class="track skeleton-track">
        <span class="skeleton-cover"></span>
        <span class="skeleton-meta">
          <span></span>
          <small></small>
        </span>
      </span>
    `;
    homeRankingList.append(item);
  }
}

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
  if (homeHintRow) {
    homeHintRow.hidden = !isRecommendation || showPopular;
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

function renderHomeRanking(homeState: HomeSnapshot, createRow: HomeRowFactory): boolean {
  if (!homeRankingList) {
    return false;
  }
  renderHomeMode(homeState);
  homeRankingList.replaceChildren();
  if (homeSetupHint) {
    homeSetupHint.hidden = true;
    homeSetupHint.classList.remove("is-inline");
  }
  homePanel?.classList.remove("needs-setup");
  if (homeState.loading) {
    renderRankingSkeleton();
    return false;
  }
  if (homeState.error) {
    homeRankingError.textContent = "拉取失败，点击重试";
    return false;
  }
  homeRankingError.textContent = "";
  for (const [index, video] of homeState.ranking.entries()) {
    homeRankingList.append(
      createRow(
        video,
        index,
        "ranking",
        { showPlayCount: true },
      ),
    );
  }
  if (isHomePopular(homeState)) {
    showHomeNotice("配置 API Key 后可生成专属推荐", "", true);
  }
  return true;
}

function showHomeNotice(title: string, sub: string, inline: boolean = false): void {
  homeSetupTitle.textContent = title;
  homeSetupSub.textContent = sub;
  homeSetupHint.hidden = false;
  homeSetupHint.classList.toggle("is-inline", inline);
  homePanel?.classList.toggle("needs-setup", !inline);
}

function renderRecommendations(homeState: HomeSnapshot, createRow: HomeRowFactory): boolean {
  if (!homeRankingList) {
    return false;
  }
  renderHomeMode(homeState);
  homeRankingList.replaceChildren();
  if (homeSetupHint) {
    homeSetupHint.hidden = true;
    homeSetupHint.classList.remove("is-inline");
  }
  homePanel?.classList.remove("needs-setup");
  if (homeState.recommendationLoading) {
    renderRankingSkeleton();
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
  for (const [index, video] of homeState.recommendations.entries()) {
    homeRankingList.append(
      createRow(
        video,
        index,
        "recommendation",
        { showPlayCount: true },
      ),
    );
  }
  return true;
}

function renderHomeSnapshot(home: HomeSnapshot, previous: HomeSnapshot | null, createRow: HomeRowFactory): boolean {
  const view = home.view;
  if (view.status !== null && view.status !== previous?.view.status) homeRankingStatus.textContent = view.status;
  if (view.rankingError !== null && view.rankingError !== previous?.view.rankingError) homeRankingError.textContent = view.rankingError.text;
  if (view.hintDisabled !== null && view.hintDisabled !== previous?.view.hintDisabled) homeHintApply.disabled = view.hintDisabled;
  if (view.hintText !== null && view.hintText !== previous?.view.hintText) homeHintApply.textContent = view.hintText;
  if (view.refreshDisabled !== null && view.refreshDisabled !== previous?.view.refreshDisabled) refreshRankingButton.disabled = view.refreshDisabled;
  if (view.content === previous?.view.content) return false;
  if (view.content.kind === "ranking") return renderHomeRanking(home, createRow);
  if (view.content.kind === "recommendations") return renderRecommendations(home, createRow);
  renderHomeMode(home);
  return false;
}

export { renderHomeSnapshot };
