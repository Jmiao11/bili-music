import { normalizeShuffleCollectionPrefs } from "./page-selection.ts";
import { MAX_AUDIO_RECOVERIES } from "./player-state.ts";

function shuffled(values: readonly number[]): number[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function readShuffleCollectionPrefs(): ReturnType<typeof normalizeShuffleCollectionPrefs> {
  try {
    return normalizeShuffleCollectionPrefs(
      localStorage.getItem("bilibili-music.shuffle-collection-order"),
      localStorage.getItem("bilibili-music.shuffle-collection-limit"),
    );
  } catch {
    return normalizeShuffleCollectionPrefs(null, null);
  }
}

function shouldRecoverAudio(errorCode: number, isCurrent: boolean, hasPlayed: boolean, attempts: number): boolean {
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

export { lufsToGain, readShuffleCollectionPrefs, shouldRecoverAudio, shuffled };
