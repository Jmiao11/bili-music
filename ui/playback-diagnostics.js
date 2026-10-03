import { audio } from "./player-dom.js";

function initPlaybackDiagnostics() {
window.__playbackDiagLog = [];
window.recordPlaybackDiag = (category, message) => {
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    message,
    paused: audio.paused,
    currentTime: audio.currentTime,
    readyState: audio.readyState,
    networkState: audio.networkState,
    currentSrcTail: audio.currentSrc.slice(-8),
  };
  window.__playbackDiagLog.push(entry);
  if (window.__playbackDiagLog.length > 300) window.__playbackDiagLog.shift();
  console.info("[playback-diag]", entry);
};
}

export {
  initPlaybackDiagnostics
};
