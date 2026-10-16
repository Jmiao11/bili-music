import type { DeepReadonly } from "../../store/state-store.ts";

type LyricsLine = { time: number; text: string };
type LyricsCandidate = { songId: string; name: string; singer: string; duration: number };
type ManualLyricsResult = LyricsCandidate & { metadata: string };
function initialLyricsDisplayState() {
  return { lines: [] as LyricsLine[], generation: 0, activeIndex: -1, full: false, offset: "0.0s", placeholder: "暂无歌词",
    matchHidden: true, idle: false, hint: "", hintHidden: false,
    candidates: [] as LyricsCandidate[], candidatesHidden: false, rejectCandidate: false,
    manualHidden: true, manualBusy: false, resultsHidden: true, results: [] as ManualLyricsResult[], resultMessage: null as string | null };
}
type LyricsDisplaySnapshot = DeepReadonly<ReturnType<typeof initialLyricsDisplayState>>;
function createLyricsDisplayActions(read: () => LyricsDisplaySnapshot, commit: (state: LyricsDisplaySnapshot) => void) {
  return {
    showLines(lines: readonly LyricsLine[]) { commit({ ...read(), lines: lines.map(line => ({ ...line })), generation: read().generation + 1, activeIndex: -1 }); },
    clearLines() { commit({ ...read(), lines: [], activeIndex: -1 }); },
    setActive(activeIndex: number) { commit({ ...read(), activeIndex }); },
    setMode(full: boolean) { commit({ ...read(), full }); },
    setOffset(offset: string) { commit({ ...read(), offset }); },
    setPlaceholder(placeholder: string) { commit({ ...read(), placeholder }); },
    setMatchHidden(matchHidden: boolean) { commit({ ...read(), matchHidden }); },
    setIdle(idle: boolean) { commit({ ...read(), idle }); },
    setHint(hint: string) { commit({ ...read(), hint, hintHidden: !hint }); },
    showCandidates(candidates: readonly LyricsCandidate[]) { commit({ ...read(), candidates: candidates.map(candidate => ({ ...candidate })), candidatesHidden: false, rejectCandidate: true }); },
    clearCandidates() { commit({ ...read(), candidates: [], candidatesHidden: true, rejectCandidate: false }); },
    setManualHidden(manualHidden: boolean) { commit({ ...read(), manualHidden }); },
    setManualBusy(manualBusy: boolean) { commit({ ...read(), manualBusy }); },
    clearResults() { commit({ ...read(), results: [], resultMessage: null, resultsHidden: true }); },
    showResults(results: readonly ManualLyricsResult[]) { commit({ ...read(), results: results.map(entry => ({ ...entry })), resultMessage: null, resultsHidden: false }); },
    showResultMessage(resultMessage: string) { commit({ ...read(), results: [], resultMessage, resultsHidden: false }); },
  };
}
export { createLyricsDisplayActions, initialLyricsDisplayState };
export type { LyricsCandidate, LyricsDisplaySnapshot };
