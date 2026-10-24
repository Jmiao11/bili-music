import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/store/app-state.ts";

test("lyrics display copies external rows and candidates without changing playback domains", () => {
  const store = createApplicationStore({ invoke: async () => null, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const before = store.getState(), lines = [{ time: 1, text: "歌词" }], candidates = [{ songId: "one", name: "曲目", singer: "作者", duration: 60 }];
  store.actions.lyricsDisplay.showLines(lines); store.actions.lyricsDisplay.showCandidates(candidates);
  lines[0].text = "外部写入"; candidates[0].name = "外部写入";
  assert.equal(store.getState().lyricsDisplay.lines[0].text, "歌词"); assert.equal(store.getState().lyricsDisplay.candidates[0].name, "曲目");
  assert.throws(() => { (store.getState().lyricsDisplay.lines[0] as { text: string }).text = "违规"; }, TypeError);
  for (const domain of ["home", "search", "library", "playbackQueue", "playbackSession", "playbackRequest", "playbackSettings", "playbackDisplay"] as const) assert.equal(store.getState()[domain], before[domain]);
  const rendered = store.getState().lyricsDisplay.lines;
  store.actions.lyricsDisplay.setActive(0); store.actions.lyricsDisplay.setOffset("+0.5s");
  assert.equal(store.getState().lyricsDisplay.lines, rendered);
  assert.deepEqual(before.lyricsDisplay.lines, []);
});

test("unchanged lyric scalars preserve the snapshot while changes notify synchronously", () => {
  const store = createApplicationStore({ invoke: async () => null, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const a = store.actions.lyricsDisplay;
  let notifications = 0;
  store.subscribe(() => { notifications++; });
  const cases = [
    { same: () => a.setIdle(false), change: () => a.setIdle(true) },
    { same: () => a.setMatchHidden(true), change: () => a.setMatchHidden(false) },
    { same: () => a.setManualHidden(true), change: () => a.setManualHidden(false) },
    { same: () => a.setManualBusy(false), change: () => a.setManualBusy(true) },
    { same: () => a.setActive(-1), change: () => a.setActive(0) },
    { same: () => a.setMode(false), change: () => a.setMode(true) },
    { same: () => a.setOffset("0.0s"), change: () => a.setOffset("+0.5s") },
    { same: () => a.setPlaceholder("暂无歌词"), change: () => a.setPlaceholder("正在匹配") },
  ];
  for (const item of cases) {
    const before = store.getState(), count = notifications;
    item.same(); assert.equal(store.getState(), before); assert.equal(notifications, count);
    item.change(); assert.equal(notifications, count + 1); assert.notEqual(store.getState(), before);
    const changed = store.getState();
    item.change(); assert.equal(store.getState(), changed); assert.equal(notifications, count + 1);
  }
});

test("lyric reset short circuits still apply changed companion flags and preserve line generations", () => {
  const store = createApplicationStore({ invoke: async () => null, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const a = store.actions.lyricsDisplay;
  let notifications = 0; store.subscribe(() => { notifications++; });
  a.clearLines(); a.clearResults(); assert.equal(notifications, 0);
  a.setHint(""); assert.equal(store.getState().lyricsDisplay.hintHidden, true); assert.equal(notifications, 1);
  a.setHint(""); assert.equal(notifications, 1);
  a.clearCandidates(); assert.equal(store.getState().lyricsDisplay.candidatesHidden, true); assert.equal(notifications, 2);
  a.clearCandidates(); assert.equal(notifications, 2);
  a.showResultMessage("没有结果"); assert.equal(notifications, 3);
  a.showResultMessage("没有结果"); assert.equal(notifications, 3);
  a.clearResults(); assert.equal(store.getState().lyricsDisplay.resultMessage, null); assert.equal(notifications, 4);
  a.clearResults(); assert.equal(notifications, 4);
  const lines = [{ time: 0, text: "歌词" }];
  a.showLines(lines); a.showLines(lines); assert.equal(store.getState().lyricsDisplay.generation, 2);
  a.clearLines(); const cleared = store.getState(); a.clearLines(); assert.equal(store.getState(), cleared);
});
