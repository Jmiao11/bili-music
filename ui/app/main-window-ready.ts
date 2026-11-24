import { invoke } from "../platform/runtime-api.ts";

let releaseStartup: () => void;
const windowReady = new Promise<void>(resolve => { releaseStartup = resolve; });

function initializeMainWindowReady(): void {
  window.addEventListener("DOMContentLoaded", () => {
    const startupRoot = document.documentElement;
    if (startupRoot.dataset.startupFailed === "true") return;
    startupRoot.dataset.startupComplete = "true";
    window.onerror = null;
    void invoke("main_window_ready").then(releaseStartup).catch(error => {
      console.error("main window ready failed:", error);
    });
  }, { once: true });
}

export { initializeMainWindowReady, windowReady };
