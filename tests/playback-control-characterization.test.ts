import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlaybackControlFixture } from "./helpers/playback-control-fixture.ts";

type Harness = Awaited<ReturnType<typeof createPlaybackControlFixture>>;
const controls = {
  main: (h: Harness) => h.node("#play-pause-button").click(),
  immersive: (h: Harness) => h.node("#immersive-play-pause-button").click(),
  taskbar: (h: Harness) => h.events.get("taskbar-media-control")!({ payload: "play_pause" }),
  shortcut: (h: Harness) => h.events.get("global-shortcut")!({ payload: "play_pause" }),
};
for (const [name, trigger] of Object.entries(controls)) {
  test(`external ${name} toggles exactly once and preserves focused input`, async () => {
    const h = await createPlaybackControlFixture();
    trigger(h); await h.flush(); assert.deepEqual(h.audio.operations, ["play"]);
    trigger(h); await h.flush(); assert.deepEqual(h.audio.operations, ["play", "pause"]);
    assert.equal(h.context.document.activeElement, h.focused);
  });
  test(`external ${name} preserves capture resume interception and source failure messages`, async () => {
    const h = await createPlaybackControlFixture();
    h.context.getSessionActions().setPendingResume(true); trigger(h); await h.flush();
    assert.equal(h.context.resumes, 1); assert.deepEqual(h.audio.operations, []);
    h.context.getSessionActions().setPendingResume(false); h.context.getSessionActions().setResumeInProgress(true); trigger(h); await h.flush();
    assert.equal(h.context.resumes, 2); assert.deepEqual(h.audio.operations, []);
    h.context.getSessionActions().setResumeInProgress(false); h.audio.currentSrc = ""; trigger(h); await h.flush();
    assert.equal(h.node("#status").textContent, "请先从队列中选择一首歌曲。");
    h.audio.currentSrc = "fixture"; h.audio.rejectPlay = true; trigger(h); await h.flush();
    assert.equal(h.node("#status").textContent, "音频暂时无法播放，请稍后重试。");
  });
}

test("external navigation mappings execute each real main handler once", async () => {
  for (const kind of ["main", "immersive", "taskbar-media-control", "global-shortcut", "media"] as const) {
    const h = await createPlaybackControlFixture();
    for (const action of ["previous", "next"] as const) {
      if (kind === "main") h.node(`#${action}-button`).click();
      else if (kind === "immersive") h.node(`#immersive-${action}-button`).click();
      else if (kind === "media") h.handlers.get(action === "previous" ? "previoustrack" : "nexttrack")!({});
      else h.events.get(kind)!({ payload: action });
      await h.flush();
    }
    assert.deepEqual(h.navigation, ["previous", "next"]);
    assert.equal(h.context.document.activeElement, h.focused);
  }
});

test("external navigation attempts current video pages before queue and clears resume before notice", async () => {
  const h = await createPlaybackControlFixture(), order: string[] = [];
  h.context.retreatPageWithinCurrentBv = () => { order.push("retreat"); return true; };
  h.context.advancePageWithinCurrentBv = () => { order.push("advance"); return true; };
  h.context.clearPendingResume = () => order.push("resume");
  h.context.clearPlaybackNotice = () => order.push("notice");
  h.node("#previous-button").click(); await h.flush(); h.node("#next-button").click(); await h.flush();
  assert.deepEqual(order, ["retreat", "resume", "notice", "advance", "resume", "notice"]);
  assert.deepEqual(h.navigation, []);
});

test("external Media Session registers all actions and preserves paused guards during pending resume", async () => {
  const h = await createPlaybackControlFixture();
  assert.deepEqual([...h.handlers.keys()], ["play", "pause", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"]);
  h.context.getSessionActions().setPendingResume(true); h.handlers.get("pause")!({}); await h.flush(); assert.equal(h.context.resumes, 0);
  h.handlers.get("play")!({}); await h.flush(); assert.equal(h.context.resumes, 1); assert.deepEqual(h.audio.operations, []);
  h.audio.paused = false; h.context.getSessionActions().setPendingResume(false); h.context.getSessionActions().setResumeInProgress(true);
  h.handlers.get("play")!({}); await h.flush(); assert.equal(h.context.resumes, 1);
  h.handlers.get("pause")!({}); await h.flush(); assert.equal(h.context.resumes, 2); assert.deepEqual(h.audio.operations, []);
});

test("external Media Session seek and both slider changes preserve exact targets and focus", async () => {
  const h = await createPlaybackControlFixture(); h.audio.duration = 100;
  h.handlers.get("seekto")!({ seekTime: 34 }); assert.equal(h.audio.currentTime, 34);
  h.handlers.get("seekbackward")!({ seekOffset: 50 }); assert.equal(h.audio.currentTime, 0);
  h.handlers.get("seekforward")!({ seekOffset: 200 }); assert.equal(h.audio.currentTime, 100);
  for (const prefix of ["", "immersive-"]) {
    const slider = h.node(`#${prefix}progress-slider`); slider.value = "47"; await slider.fire("change"); assert.equal(h.audio.currentTime, 47);
  }
  assert.equal(h.context.document.activeElement, h.focused);
});

test("external Tauri listeners keep names and ignore unknown controls", async () => {
  const h = await createPlaybackControlFixture();
  assert.deepEqual(h.registration, ["taskbar-media-control", "global-shortcut"]);
  for (const receive of h.events.values()) receive({ payload: "unknown" }); await h.flush();
  assert.deepEqual(h.audio.operations, []); assert.deepEqual(h.navigation, []); assert.equal(h.node("#status").textContent, "");
});
