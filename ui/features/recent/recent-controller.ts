import type { ApplicationStore } from "../../store/application-store.ts";

function installRecentController(store: ApplicationStore, target: Window): () => void {
  let visible = false, quality = store.getState().settings.audioQuality, cleared = false;
  const online = () => store.actions.recent.connectivity(target.navigator.onLine);
  const sync = () => {
    const state = store.getState();
    const nextVisible = state.settings.session.currentView === "recent" && !state.collection.active;
    const nextCleared = state.settings.view.cache.status?.text === "缓存已清空";
    const refresh = state.settings.audioQuality !== quality || nextCleared && !cleared;
    quality = state.settings.audioQuality; cleared = nextCleared;
    if (nextVisible !== visible) {
      visible = nextVisible;
      if (visible) {
        target.addEventListener("online", online); target.addEventListener("offline", online);
        online(); void store.actions.recent.load(() => store.getState().settings.audioQuality, Date.now());
      } else {
        target.removeEventListener("online", online); target.removeEventListener("offline", online);
      }
    } else if (visible && refresh) void store.actions.recent.refreshCache(quality);
  };
  const unsubscribe = store.subscribe(sync); sync();
  return () => { unsubscribe(); target.removeEventListener("online", online); target.removeEventListener("offline", online); };
}
export { installRecentController };
