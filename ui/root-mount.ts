import App from "./components/App.vue";
import { playbackCallbacks, projectRootPlayback } from "./root-playback.ts";
import { h, render } from "vue";
import { initializeStartupPlatform } from "./startup-platform.ts";
import { initializeApplicationStore, readApplicationStore } from "./application-store.ts";
import type { ApplicationSnapshot } from "./application-store.ts";
import { installRootRefresh, projectRootLists } from "./root-lists.ts";
import { createSettingsPlatform } from "./settings-adapter.ts";
import { invoke } from "./runtime-api.ts";



function renderRoot(snapshot: ApplicationSnapshot): void {
  const host = document.querySelector("#app");
  if (!host) throw new Error("Application root host is missing");
  const lists = projectRootLists(snapshot);
  render(h(App, { snapshot, callbacks: playbackCallbacks, lists, playback: projectRootPlayback(snapshot) }), host);
}
function mountApplication(): void {
  initializeStartupPlatform();
  initializeApplicationStore({
    settings: createSettingsPlatform(), invoke, setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: id => window.clearTimeout(id), report: (level, message, error) => console[level](message, error),
  }, renderRoot);
  installRootRefresh(() => renderRoot(readApplicationStore().getState()));
}

mountApplication();

export {};
