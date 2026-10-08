import { readSettingsCollectionPrefs } from "./settings-adapter.ts";
import { MAX_AUDIO_RECOVERIES } from "./player-state.ts";

function readShuffleCollectionPrefs(): ReturnType<typeof readSettingsCollectionPrefs> { return readSettingsCollectionPrefs(); }

function shouldRecoverAudio(errorCode: number | undefined, isCurrent: boolean, hasPlayed: boolean, attempts: number): boolean {
  return errorCode === 2 && isCurrent && hasPlayed && attempts < MAX_AUDIO_RECOVERIES;
}

// 与 src-tauri/src/loudness.rs::lufs_to_gain 有两份公式实现，改一处必须同步。
function lufsToGain(lufs: number | null | undefined): number {
  if (lufs === null || lufs === undefined || !Number.isFinite(lufs)) {
    return 1.0;
  }
  const gainDb = Math.min(0, Math.max(-12, -14 - lufs));
  return 10 ** (gainDb / 20);
}

export { lufsToGain, readShuffleCollectionPrefs, shouldRecoverAudio };
