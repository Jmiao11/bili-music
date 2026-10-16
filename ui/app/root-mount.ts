import { pageCallbacks, projectHomeControls } from "./root-controls.ts";
import { createModalProjection, libraryCallbacks, pagesCallbacks } from "./root-modals.ts";
import { settingsCallbacks } from "../features/settings/root-settings.ts";
import { createSettingsControlsProjection } from "../features/settings/settings-controls.ts";
import App from "./components/App.vue";
import { playbackCallbacks, projectRootPlayback } from "../features/playback/root-playback.ts";
import { h, render } from "vue";
import { initializeStartupPlatform } from "./startup-platform.ts";
import { initializeApplicationStore, readApplicationStore } from "../store/application-store.ts";
import type { ApplicationSnapshot } from "../store/application-store.ts";
import { installRootRefresh, projectRootLists } from "../features/tracks/root-lists.ts";
import { createSettingsPlatform } from "../features/settings/settings-adapter.ts";
import { invoke } from "../platform/runtime-api.ts";
const projectSettingsControls=createSettingsControlsProjection();
const projectModals = createModalProjection();
let lastPages: ReturnType<typeof projectModals>["pages"] = null;
function renderRoot(snapshot: ApplicationSnapshot): void {
  const host = document.querySelector("#app");
  if (!host) throw new Error("Application root host is missing");
  const lists = projectRootLists(snapshot);
  const modals = projectModals(snapshot);
  const pageFocus = snapshot.pages.modal && modals.pages !== lastPages &&
    (document.querySelector("#pages-modal-list")?.contains(document.activeElement) || document.activeElement === document.querySelector("#pages-modal-restore-all"));
  lastPages = modals.pages;
  render(h(App, { modals, libraryCallbacks, pagesCallbacks, settingsCallbacks, settingsControls:projectSettingsControls(snapshot.settings,document.documentElement.dataset.platform),homeControls: projectHomeControls(snapshot.home), pageCallbacks, snapshot, callbacks: playbackCallbacks, lists, playback: projectRootPlayback(snapshot) }), host);
  if (pageFocus) document.querySelector<HTMLElement>("#pages-modal-close")?.focus({preventScroll:true});
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
