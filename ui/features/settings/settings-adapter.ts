import { normalizeShuffleCollectionPrefs } from "../pages/page-selection.ts";
import type { SettingsPlatform } from "./settings-state.ts";
function readSettingsPreference(key: string): string | null {
  return localStorage.getItem(key);
}
function readSettingsCollectionPrefs(): ReturnType<typeof normalizeShuffleCollectionPrefs> {
  try {
    return normalizeShuffleCollectionPrefs(localStorage.getItem("bilibili-music.shuffle-collection-order"), localStorage.getItem("bilibili-music.shuffle-collection-limit"));
  } catch {
    return normalizeShuffleCollectionPrefs(null, null);
  }
}
function createSettingsPlatform(): SettingsPlatform {
  let noticeTimer: ReturnType<typeof window.setTimeout> | null = null;
  return {
    getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key), cancelCacheNotice() {
      if (noticeTimer !== null) clearTimeout(noticeTimer);
      noticeTimer = null;
    }, scheduleCacheNotice(callback) {
      noticeTimer = setTimeout(() => {
        callback();
        noticeTimer = null;
      }, 3000);
    }
  };
}
export { createSettingsPlatform, readSettingsCollectionPrefs, readSettingsPreference };
