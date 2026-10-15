import { invoke } from "./runtime-api.ts";

function initializeMainWindowReady(): void {
  window.addEventListener("DOMContentLoaded", () => {
    const startupRoot = document.documentElement;
    if (startupRoot.dataset.startupFailed === "true") return;
    startupRoot.dataset.startupComplete = "true";
    window.onerror = null;
    void invoke("main_window_ready").catch(error => {
      console.error("main window ready failed:", error);
    });
  }, { once: true });
}

export { initializeMainWindowReady };
