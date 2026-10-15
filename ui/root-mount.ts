import App from "./components/App.vue";
import { h, render } from "vue";
import { initializeStartupPlatform } from "./startup-platform.ts";
import { initializeApplicationStore } from "./application-store.ts";
import type { ApplicationSnapshot } from "./application-store.ts";
import { createSettingsPlatform } from "./settings-adapter.ts";
import { invoke } from "./runtime-api.ts";

const rootCallbacks = Object.freeze({});

function renderRoot(snapshot: ApplicationSnapshot): void {
  const host = document.querySelector("#app");
  if (!host) throw new Error("Application root host is missing");
  render(h(App, { snapshot, callbacks: rootCallbacks }), host);
}
function mountApplication(): void {
  initializeStartupPlatform();
  initializeApplicationStore({
    settings: createSettingsPlatform(), invoke, setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: id => window.clearTimeout(id), report: (level, message, error) => console[level](message, error),
  }, renderRoot);
}

mountApplication();

export {};
