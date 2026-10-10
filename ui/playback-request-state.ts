import type { DeepReadonly } from "./state-store.ts";

type PlaybackRequestState = { requestVersion: number; activeAudioVersion: number; activeAudioUrl: string; audioActivatedAt: number; consecutiveResolveFailures: number };
function initialPlaybackRequestState(): PlaybackRequestState {
  return { requestVersion: 0, activeAudioVersion: -1, activeAudioUrl: "", audioActivatedAt: Number.POSITIVE_INFINITY, consecutiveResolveFailures: 0 };
}

function createPlaybackRequestActions(read: () => DeepReadonly<PlaybackRequestState>, commit: (state: DeepReadonly<PlaybackRequestState>) => void) {
  function beginRequest() { const version = read().requestVersion + 1; commit({ ...read(), requestVersion: version }); return version; }
  function invalidateAudio() { commit({ ...read(), activeAudioVersion: -1, activeAudioUrl: "", audioActivatedAt: Number.POSITIVE_INFINITY }); }
  function activateAudio(activeAudioVersion: number, activeAudioUrl: string, audioActivatedAt: number) { commit({ ...read(), activeAudioVersion, activeAudioUrl, audioActivatedAt }); }
  function replaceAudio(activeAudioUrl: string, audioActivatedAt: number) { commit({ ...read(), activeAudioUrl, audioActivatedAt }); }
  function resetFailures() { commit({ ...read(), consecutiveResolveFailures: 0 }); }
  function recordFailure() { const count = read().consecutiveResolveFailures + 1; commit({ ...read(), consecutiveResolveFailures: count }); return count; }
  function isCurrent(version: number) { return version === read().requestVersion; }
  return { beginRequest, invalidateAudio, activateAudio, replaceAudio, resetFailures, recordFailure, isCurrent };
}
export { createPlaybackRequestActions, initialPlaybackRequestState };
export type { PlaybackRequestState };
