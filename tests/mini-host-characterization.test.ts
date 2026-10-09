import assert from "node:assert/strict";
import { test } from "node:test";
import { createMiniHostFixture } from "./helpers/mini-host-fixture.ts";

test("mini commands preserve navigation, media and favorite effects exactly once", async () => {
  const h = await createMiniHostFixture(); h.setTrack();
  await h.fire("mini-player-command", "previous"); await h.fire("mini-player-command", "next");
  assert.deepEqual(h.navigation, ["previous", "next"]);
  await h.fire("mini-player-command", "toggle_play"); await h.fire("mini-player-command", "toggle_play");
  assert.deepEqual(h.audio.operations, ["play", "pause"]);
  await h.fire("mini-player-command", "toggle_favorite");
  assert.deepEqual(h.invoked, ["toggle_favorite"]);
  assert.equal(h.library.getState().library.favoriteBvids.has("bv0000000001"), true);
  assert.deepEqual(h.changes, ["bilibili-music-favorite-change", "bilibili-music-favorite"]);
  assert.equal(h.context.document.activeElement, h.focused);
});

test("mini favorite with no current track has no invoke, state change or prompt", async () => {
  const h = await createMiniHostFixture(), before = h.library.getState();
  await h.fire("mini-player-command", "toggle_favorite");
  assert.deepEqual(h.invoked, []); assert.equal(h.library.getState(), before);
  assert.equal(h.node("#status").textContent, ""); assert.deepEqual(h.changes, []);
});

test("mini play during pending or active resume runs only recovery and unknown commands do nothing", async () => {
  const h = await createMiniHostFixture(); h.context.pendingResume = true;
  await h.fire("mini-player-command", "toggle_play"); assert.equal(h.context.resumes, 1);
  h.context.pendingResume = false; h.context.resumeInProgress = true;
  await h.fire("mini-player-command", "toggle_play"); assert.equal(h.context.resumes, 2);
  await h.fire("mini-player-command", "unknown");
  assert.deepEqual(h.audio.operations, []); assert.deepEqual(h.navigation, []); assert.deepEqual(h.invoked, []);
});

test("mini ready publishes every empty queue field with original defaults", async () => {
  const h = await createMiniHostFixture(); await h.fire("mini-player-ready");
  assert.deepEqual(h.emissions, [{ label: "mini", name: "mini-player-state", payload: {
    title: "尚未播放", uploader: "—", thumbnailUrl: "", status: "", notice: "", hasCurrent: false,
    canPrevious: true, canNext: true, isPlaying: false, isFavorited: false, theme: "dark", accent: { r: 251, g: 114, b: 153 },
  } }]);
});

test("mini payload preserves single and multi page titles, favorites, playing and paused fields", async () => {
  for (const pages of [1, 2]) {
    const h = await createMiniHostFixture(); h.setTrack(pages);
    h.node("#status").textContent = "在线播放中。"; h.node("#playback-notice").textContent = "已经是第一首了";
    await h.fire("mini-player-ready");
    assert.deepEqual(h.emissions[0].payload, { title: pages === 1 ? "曲目" : "分P1", uploader: "作者", thumbnailUrl: "https://example.com/cover.jpg",
      status: "在线播放中。", notice: "已经是第一首了", hasCurrent: true, canPrevious: true, canNext: true,
      isPlaying: false, isFavorited: false, theme: "dark", accent: { r: 251, g: 114, b: 153 } });
    await h.fire("mini-player-command", "toggle_favorite");
    assert.equal(h.emissions.at(-1)!.payload.isFavorited, true);
    await h.fire("mini-player-command", "toggle_play"); assert.equal(h.emissions.at(-1)!.payload.isPlaying, true);
    await h.fire("mini-player-command", "toggle_play"); assert.equal(h.emissions.at(-1)!.payload.isPlaying, false);
  }
});

test("mini publishes once per registered event after ready and never for progress or volume", async () => {
  const h = await createMiniHostFixture();
  for (const name of ["play", "pause", "ended", "emptied", "error"]) await h.audio.fire(name);
  await h.publishEvent("bilibili-music-trackchange"); assert.equal(h.emissions.length, 0);
  await h.fire("mini-player-ready"); let count = 1;
  for (const name of ["play", "pause", "ended", "emptied", "error"]) { await h.audio.fire(name); assert.equal(h.emissions.length, ++count); }
  for (const name of ["bilibili-music-trackchange", "bilibili-music-favorite-change", "bilibili-music-notice-change"]) {
    await h.publishEvent(name); assert.equal(h.emissions.length, ++count);
  }
  for (const name of ["timeupdate", "durationchange", "volumechange"]) await h.audio.fire(name);
  h.store.actions.playbackSettings.setUserVolume(0.4); await h.flush();
  assert.equal(h.emissions.length, count);
});

test("mini theme and accent changes wait for next existing publish event", async () => {
  const h = await createMiniHostFixture(); await h.fire("mini-player-ready");
  h.root.dataset.theme = "light"; h.channels.set("--accent-r", "40"); h.channels.set("--accent-g", "88"); h.channels.set("--accent-b", "161");
  await h.flush(); assert.equal(h.emissions.length, 1); assert.equal(h.emissions[0].payload.theme, "dark");
  await h.publishEvent("bilibili-music-favorite-change");
  assert.equal(h.emissions.length, 2); assert.equal(h.emissions[1].payload.theme, "light");
  assert.deepEqual(h.emissions[1].payload.accent, { r: 40, g: 88, b: 161 });
});

test("mini installs ready and command listeners before attaching publication listeners", async () => {
  const h = await createMiniHostFixture();
  assert.deepEqual(h.installed, ["window:beforeunload", "tauri:mini-player-ready", "tauri:mini-player-command",
    "window:bilibili-music-trackchange", "window:bilibili-music-favorite-change", "window:bilibili-music-notice-change"]);
  await h.host.openMiniPlayer(); assert.deepEqual(h.invoked, ["open_mini_player"]);
  assert.equal(h.timers[0].delay, 5000);
  await h.fire("mini-player-ready"); assert.equal(h.emissions.length, 1);
});
