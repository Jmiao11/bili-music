import { createApplicationStore } from "./app-state.ts";
import { invoke } from "./runtime-api.ts";
import { homeHintInput } from "./player-dom.ts";
import { renderHomeSnapshot } from "./home-view.ts";
import { createTrackRow, playListItem, updateQueueUi } from "./playback-core.ts";

let applicationStore: ReturnType<typeof createApplicationStore> | null = null;

function getApplicationStore(): ReturnType<typeof createApplicationStore> {
  if (!applicationStore) {
    applicationStore = createApplicationStore({
      invoke, setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: id => window.clearTimeout(id), report: (level, message, error) => console[level](message, error),
    });
    let previous: ReturnType<typeof getHomeSnapshot> | null = null;
    const render = (state: ReturnType<ReturnType<typeof createApplicationStore>["getState"]>) => {
      const refreshQueue = renderHomeSnapshot(state.home, previous, (video, index, source, options) =>
        createTrackRow(video, index, (targetIndex, pageSelection) => {
          const current = getHomeSnapshot();
          playListItem(source, source === "ranking" ? current.ranking : current.recommendations, targetIndex, pageSelection);
        }, options));
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

export { getHomeSnapshot, loadHomeRanking, loadRecommendationHome, loadRecommendations, refreshAiKeyState, setHomeHint, setHomeMode, updateHomeModeUi };
