import { normalizeTrack } from "./track-utils.ts";
import { invoke } from "./runtime-api.ts";
import { homeCacheNote, homeHintApply, homeHintInput, homeHintRow, homeListLabel, homeModeTabs, homePanel, homeRankingError, homeRankingList, homeRankingStatus, homeSetupHint, homeSetupSub, homeSetupTitle, homeSourceLabel, homeSubtitle, homeTitle, refreshRankingButton } from "./player-dom.ts";
import { homeState } from "./player-state.ts";
import { createTrackRow, playListItem, updateQueueUi } from "./playback-core.js";

function renderRankingSkeleton() {
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

function isPopularFallback() {
  return homeState.mode === "recommendation" && homeState.aiHasKey === false;
}

function updateHomeModeUi() {
  const isRecommendation = homeState.mode === "recommendation";
  const showPopular = isPopularFallback();
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

function renderHomeRanking() {
  if (!homeRankingList) {
    return;
  }
  updateHomeModeUi();
  homeRankingList.replaceChildren();
  if (homeSetupHint) {
    homeSetupHint.hidden = true;
    homeSetupHint.classList.remove("is-inline");
  }
  homePanel?.classList.remove("needs-setup");
  if (homeState.loading) {
    renderRankingSkeleton();
    return;
  }
  if (homeState.error) {
    homeRankingError.textContent = "拉取失败，点击重试";
    return;
  }
  homeRankingError.textContent = "";
  for (const [index, video] of homeState.ranking.entries()) {
    homeRankingList.append(
      createTrackRow(
        video,
        index,
        (targetIndex, pageSelection) =>
          playListItem("ranking", homeState.ranking, targetIndex, pageSelection),
        { showPlayCount: true },
      ),
    );
  }
  if (isPopularFallback()) {
    showHomeNotice("配置 API Key 后可生成专属推荐", "", true);
  }
  updateQueueUi();
}

function showHomeNotice(title, sub, inline = false) {
  homeSetupTitle.textContent = title;
  homeSetupSub.textContent = sub;
  homeSetupHint.hidden = false;
  homeSetupHint.classList.toggle("is-inline", inline);
  homePanel?.classList.toggle("needs-setup", !inline);
}

function renderRecommendations() {
  if (!homeRankingList) {
    return;
  }
  updateHomeModeUi();
  homeRankingList.replaceChildren();
  if (homeSetupHint) {
    homeSetupHint.hidden = true;
    homeSetupHint.classList.remove("is-inline");
  }
  homePanel?.classList.remove("needs-setup");
  if (homeState.recommendationLoading) {
    renderRankingSkeleton();
    return;
  }
  if (homeState.recommendationError) {
    showHomeNotice(
      "推荐生成失败",
      `${homeState.recommendationError}｜请在「设置 → AI 推荐」检查 API Key 与模型配置`,
    );
    homeRankingError.textContent = "";
    return;
  }
  if (homeState.recommendations.length === 0) {
    homeRankingError.textContent = "";
    return;
  }
  homeRankingError.textContent = "";
  for (const [index, video] of homeState.recommendations.entries()) {
    homeRankingList.append(
      createTrackRow(
        video,
        index,
        (targetIndex, pageSelection) =>
          playListItem("recommendation", homeState.recommendations, targetIndex, pageSelection),
        { showPlayCount: true },
      ),
    );
  }
  updateQueueUi();
}

function renderHomeContent() {
  if (homeState.mode === "recommendation" && !isPopularFallback()) {
    renderRecommendations();
  } else {
    renderHomeRanking();
  }
}

async function refreshAiKeyState() {
  try {
    const config = await invoke("get_ai_config");
    homeState.aiHasKey = !!config.hasKey;
  } catch (error) {
    homeState.aiHasKey = null;
  }
  if (homeState.mode === "recommendation") {
    await loadRecommendationHome();
  }
}

/**
 * @template {keyof CommandMap} K
 * @param {K} command
 * @param {CommandMap[K]["args"]} args
 * @param {number} timeoutMs
 * @returns {Promise<CommandMap[K]["result"]>}
 */
function invokeWithTimeout(command, args, timeoutMs) {
  let timeoutId = 0;
  /** @type {Promise<never>} */
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("request timeout")), timeoutMs);
  });
  return Promise.race([invoke(command, args), timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

async function loadHomeRanking({ forceRefresh = false } = {}) {
  if (!forceRefresh && homeState.loaded && homeState.ranking.length > 0) {
    renderHomeRanking();
    return;
  }
  homeState.loading = true;
  homeState.error = "";
  homeRankingStatus.textContent = forceRefresh
    ? "正在刷新音乐飙升榜…"
    : "正在拉取 B站音乐区热门内容…";
  refreshRankingButton.disabled = true;
  if (homeState.mode === "ranking" || isPopularFallback()) {
    renderHomeRanking();
  }
  try {
    const tracks = await invoke("get_music_ranking", { forceRefresh });
    homeState.ranking = tracks.map(normalizeTrack);
    homeState.loaded = true;
    homeState.error = "";
    homeRankingStatus.textContent = `已加载 ${homeState.ranking.length} 首音乐区热门视频。`;
  } catch (error) {
    if (isPopularFallback()) {
      homeState.error = "";
      homeRankingStatus.textContent = "";
    } else {
      homeState.error = String(error);
      homeRankingStatus.textContent = "音乐飙升榜拉取失败。";
      homeRankingError.textContent = "拉取失败，点击重试";
      console.error("music ranking load failed:", error);
    }
  } finally {
    homeState.loading = false;
    refreshRankingButton.disabled = false;
    if (homeState.mode === "ranking" || isPopularFallback()) {
      renderHomeRanking();
    }
  }
}

async function loadSavedRecommendations() {
  if (homeState.recommendationLoaded || homeState.recommendationLoading) {
    renderRecommendations();
    return;
  }
  homeState.recommendationLoading = true;
  homeState.recommendationError = "";
  homeHintApply.disabled = true;
  refreshRankingButton.disabled = true;
  homeRankingStatus.textContent = "正在读取上次推荐…";
  renderRecommendations();
  try {
    const tracks = await invoke("get_saved_recommendations");
    homeState.recommendations = tracks.map(normalizeTrack);
    homeState.recommendationLoaded = true;
    homeRankingStatus.textContent = homeState.recommendations.length > 0
      ? `已加载 ${homeState.recommendations.length} 首上次推荐。`
      : "点击「生成推荐」获取你的专属推荐";
  } catch (_error) {
    homeState.recommendationLoaded = true;
    homeState.recommendationError = "";
    homeRankingStatus.textContent = "";
  } finally {
    homeState.recommendationLoading = false;
    homeHintApply.disabled = false;
    refreshRankingButton.disabled = false;
    if (homeState.mode === "recommendation" && !isPopularFallback()) {
      renderRecommendations();
    }
  }
}

function loadRecommendationHome() {
  return homeState.aiHasKey === false ? loadHomeRanking() : loadSavedRecommendations();
}

async function loadRecommendations({ forceRefresh = false } = {}) {
  if (homeHintInput) {
    homeState.userHint = homeHintInput.value;
  }
  if (!forceRefresh && homeState.recommendationLoaded) {
    renderRecommendations();
    return;
  }
  homeState.recommendationLoading = true;
  if (homeHintApply) {
    homeHintApply.disabled = true;
    homeHintApply.textContent = "生成中…";
  }
  homeState.recommendationError = "";
  homeRankingStatus.textContent = forceRefresh
    ? "正在重新生成推荐…"
    : "正在根据搜索与收藏生成推荐…";
  refreshRankingButton.disabled = true;
  if (homeState.mode === "recommendation") {
    renderRecommendations();
  }
  try {
    const hint = homeState.userHint.trim();
    const tracks = await invokeWithTimeout(
      "get_recommendations",
      hint ? { userHint: hint } : {},
      95000,
    );
    homeState.recommendations = tracks.map(normalizeTrack);
    homeState.recommendationLoaded = true;
    homeState.recommendationError = "";
    homeRankingStatus.textContent = homeState.recommendations.length > 0
      ? `已生成 ${homeState.recommendations.length} 首推荐。`
      : "暂无推荐结果。";
  } catch (error) {
    homeState.recommendationError = String(error?.message ?? error);
    homeRankingStatus.textContent = "为你推荐生成失败。";
    console.warn("recommendations load failed:", error);
  } finally {
    homeState.recommendationLoading = false;
    refreshRankingButton.disabled = false;
    if (homeHintApply) {
      homeHintApply.disabled = false;
      homeHintApply.textContent = "生成推荐";
    }
    if (homeState.mode === "recommendation") {
      renderRecommendations();
    }
  }
}

function setHomeMode(mode) {
  const nextMode = mode === "recommendation" ? "recommendation" : "ranking";
  if (homeState.mode === nextMode) {
    renderHomeContent();
  } else {
    homeState.mode = nextMode;
    homeRankingError.textContent = "";
    updateHomeModeUi();
  }
  if (homeState.mode === "recommendation") {
    loadRecommendationHome();
  } else {
    loadHomeRanking();
  }
}

export { loadHomeRanking, loadRecommendationHome, loadRecommendations, refreshAiKeyState, setHomeMode, updateHomeModeUi };
