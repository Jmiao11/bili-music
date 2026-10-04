import { audio } from "./player-dom.ts";

function initPlaybackDiagnostics(): void {
window.__playbackDiagLog = [];
window.recordPlaybackDiag = (category: string, message: string): void => {
  const entry: PlaybackDiagEntry = {
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
