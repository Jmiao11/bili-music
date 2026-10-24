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
    clearLines() { const state = read(); if (state.lines.length || state.activeIndex !== -1) commit({ ...state, lines: [], activeIndex: -1 }); },
    setActive(activeIndex: number) { const state = read(); if (state.activeIndex !== activeIndex) commit({ ...state, activeIndex }); },
    setMode(full: boolean) { const state = read(); if (state.full !== full) commit({ ...state, full }); },
    setOffset(offset: string) { const state = read(); if (state.offset !== offset) commit({ ...state, offset }); },
    setPlaceholder(placeholder: string) { const state = read(); if (state.placeholder !== placeholder) commit({ ...state, placeholder }); },
    setMatchHidden(matchHidden: boolean) { const state = read(); if (state.matchHidden !== matchHidden) commit({ ...state, matchHidden }); },
    setIdle(idle: boolean) { const state = read(); if (state.idle !== idle) commit({ ...state, idle }); },
    setHint(hint: string) { const state = read(); if (state.hint !== hint || state.hintHidden !== !hint) commit({ ...state, hint, hintHidden: !hint }); },
    showCandidates(candidates: readonly LyricsCandidate[]) { commit({ ...read(), candidates: candidates.map(candidate => ({ ...candidate })), candidatesHidden: false, rejectCandidate: true }); },
    clearCandidates() { const state = read(); if (state.candidates.length || !state.candidatesHidden || state.rejectCandidate) commit({ ...state, candidates: [], candidatesHidden: true, rejectCandidate: false }); },
    setManualHidden(manualHidden: boolean) { const state = read(); if (state.manualHidden !== manualHidden) commit({ ...state, manualHidden }); },
    setManualBusy(manualBusy: boolean) { const state = read(); if (state.manualBusy !== manualBusy) commit({ ...state, manualBusy }); },
    clearResults() { const state = read(); if (state.results.length || state.resultMessage !== null || !state.resultsHidden) commit({ ...state, results: [], resultMessage: null, resultsHidden: true }); },
    showResults(results: readonly ManualLyricsResult[]) { commit({ ...read(), results: results.map(entry => ({ ...entry })), resultMessage: null, resultsHidden: false }); },
    showResultMessage(resultMessage: string) { const state = read(); if (state.results.length || state.resultMessage !== resultMessage || state.resultsHidden) commit({ ...state, results: [], resultMessage, resultsHidden: false }); },
  };
}
export { createLyricsDisplayActions, initialLyricsDisplayState };
export type { LyricsCandidate, LyricsDisplaySnapshot };
