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
