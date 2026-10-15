import { readApplicationStore } from "./application-store.ts";
import type { createApplicationStore } from "./app-state.ts";
import { homeHintInput } from "./player-dom.ts";
import { refreshHomeRows, renderHomeRows } from "./track-list-ui.ts";
import { renderHomeSnapshot } from "./home-view.ts";
import { playListItem, updateQueueUi } from "./playback-core.ts";

let homeMounted = false;

function getApplicationStore(): ReturnType<typeof createApplicationStore> {
  const applicationStore = readApplicationStore();
  if (!homeMounted) {
    homeMounted = true;
    let previous: ReturnType<typeof getHomeSnapshot> | null = null;
    const render = (state: ReturnType<ReturnType<typeof createApplicationStore>["getState"]>) => {
      const refreshQueue = renderHomeSnapshot(state.home, previous, (videos, source, skeleton) =>
        renderHomeRows(state, videos, source, skeleton, (targetIndex, pageSelection) => {
          const current = getHomeSnapshot();
          playListItem(source, source === "ranking" ? current.ranking : current.recommendations, targetIndex, pageSelection);
        }));
      refreshHomeRows(state);
      previous = state.home;
      if (refreshQueue) updateQueueUi();
    };
    applicationStore.subscribe(render);
    render(applicationStore.getState());
  }
  return applicationStore;
}

function getHomeSnapshot() { return getApplicationStore().getState().home; }
function updateHomeModeUi(): void { getApplicationStore(); }
function loadHomeRanking(options: { forceRefresh?: boolean } = {}): Promise<void> { return getApplicationStore().actions.loadHomeRanking(options); }
function loadRecommendationHome(): Promise<void> { return getApplicationStore().actions.loadRecommendationHome(); }
function loadRecommendations(options: { forceRefresh?: boolean } = {}): Promise<void> {
  return getApplicationStore().actions.loadRecommendations({ ...options, userHint: homeHintInput ? homeHintInput.value : getHomeSnapshot().userHint });
}
function refreshAiKeyState(): Promise<void> { return getApplicationStore().actions.refreshAiKeyState(); }
function setHomeMode(mode: string): void { getApplicationStore().actions.setHomeMode(mode); }
function setHomeHint(hint: string): void { getApplicationStore().actions.setHomeHint(hint); }

export { getApplicationStore, getHomeSnapshot, loadHomeRanking, loadRecommendationHome, loadRecommendations, refreshAiKeyState, setHomeHint, setHomeMode, updateHomeModeUi };
