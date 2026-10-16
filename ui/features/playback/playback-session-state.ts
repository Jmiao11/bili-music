import type { DeepReadonly } from "../../store/state-store.ts";

function initialPlaybackSessionState() { return { currentPages: [] as CommandContract.VideoPage[], lastEmittedTrackIdentity: "", playRecordedForCurrentTrack: false, cacheRequestedForCurrentTrack: false, pendingResume: null as Pick<CommandContract.PlaybackState, "positionSeconds" | "page" | "cid"> | null, resumeInProgress: false, lastPlaybackStateSavedAt: Number.NEGATIVE_INFINITY, recoveryVersion: -1, recoveryAttempts: 0, playingAudioVersion: -1, playbackIntended: false, pendingPastedBvPages: null as { bvid: string; requestVersion: number } | null, loudnessQueryVersion: 0, loudnessAnalyzedForCurrentTrack: false }; }
type PlaybackSessionState = ReturnType<typeof initialPlaybackSessionState>;
function createPlaybackSessionActions(read: () => DeepReadonly<PlaybackSessionState>, commit: (state: DeepReadonly<PlaybackSessionState>) => void) {
  function setCurrentPages(currentPages: DeepReadonly<PlaybackSessionState>["currentPages"]) { commit({ ...read(), currentPages }); }
  function setTrackIdentity(lastEmittedTrackIdentity: DeepReadonly<PlaybackSessionState>["lastEmittedTrackIdentity"]) { commit({ ...read(), lastEmittedTrackIdentity }); }
  function setPlayRecorded(playRecordedForCurrentTrack: DeepReadonly<PlaybackSessionState>["playRecordedForCurrentTrack"]) { commit({ ...read(), playRecordedForCurrentTrack }); }
  function setCacheRequested(cacheRequestedForCurrentTrack: DeepReadonly<PlaybackSessionState>["cacheRequestedForCurrentTrack"]) { commit({ ...read(), cacheRequestedForCurrentTrack }); }
  function setPendingResume(pendingResume: DeepReadonly<PlaybackSessionState>["pendingResume"]) { commit({ ...read(), pendingResume }); }
  function setResumeInProgress(resumeInProgress: DeepReadonly<PlaybackSessionState>["resumeInProgress"]) { commit({ ...read(), resumeInProgress }); }
  function setLastSavedAt(lastPlaybackStateSavedAt: DeepReadonly<PlaybackSessionState>["lastPlaybackStateSavedAt"]) { commit({ ...read(), lastPlaybackStateSavedAt }); }
  function setRecoveryVersion(recoveryVersion: DeepReadonly<PlaybackSessionState>["recoveryVersion"]) { commit({ ...read(), recoveryVersion }); }
  function setRecoveryAttempts(recoveryAttempts: DeepReadonly<PlaybackSessionState>["recoveryAttempts"]) { commit({ ...read(), recoveryAttempts }); }
  function setPlayingVersion(playingAudioVersion: DeepReadonly<PlaybackSessionState>["playingAudioVersion"]) { commit({ ...read(), playingAudioVersion }); }
  function setPlaybackIntended(playbackIntended: DeepReadonly<PlaybackSessionState>["playbackIntended"]) { commit({ ...read(), playbackIntended }); }
  function setPendingPastedPages(pendingPastedBvPages: DeepReadonly<PlaybackSessionState>["pendingPastedBvPages"]) { commit({ ...read(), pendingPastedBvPages }); }
  function setLoudnessAnalyzed(loudnessAnalyzedForCurrentTrack: DeepReadonly<PlaybackSessionState>["loudnessAnalyzedForCurrentTrack"]) { commit({ ...read(), loudnessAnalyzedForCurrentTrack }); }
  function setLoudnessQueryVersion(loudnessQueryVersion: number) { commit({ ...read(), loudnessQueryVersion }); }
  function nextLoudnessQuery() { const version = read().loudnessQueryVersion + 1; commit({ ...read(), loudnessQueryVersion: version }); return version; }
  return { setCurrentPages, setTrackIdentity, setPlayRecorded, setCacheRequested, setPendingResume, setResumeInProgress, setLastSavedAt, setRecoveryVersion, setRecoveryAttempts, setPlayingVersion, setPlaybackIntended, setPendingPastedPages, setLoudnessAnalyzed, setLoudnessQueryVersion, nextLoudnessQuery };
}

export { createPlaybackSessionActions, initialPlaybackSessionState };
export type { PlaybackSessionState };
