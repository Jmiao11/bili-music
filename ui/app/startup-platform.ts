import { initializeSidebar } from "./sidebar.ts";

function initializeStartupPlatform(): void {
  document.documentElement.dataset.platform = /Macintosh|Mac OS X/i.test(navigator.userAgent) ? "macos" : "windows";
  window.onerror = () => {
    document.documentElement.dataset.startupFailed = "true";
  };
  initializeSidebar();
}

export { initializeStartupPlatform };
