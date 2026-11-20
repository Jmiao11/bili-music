import assert from "node:assert/strict";
import { test } from "node:test";
import { createMiniHostFixture } from "./helpers/mini-host-fixture.ts";

test("mini commands preserve navigation, media and favorite effects exactly once", async () => {
  const h = await createMiniHostFixture(); const track = h.setTrack();
  await h.fire("mini-player-command", "previous"); await h.fire("mini-player-command", "next");
  assert.deepEqual(h.navigation, ["previous", "next"]);
  await h.fire("mini-player-command", "toggle_play"); await h.fire("mini-player-command", "toggle_play");
  assert.deepEqual(h.audio.operations, ["play", "pause"]);
  await h.fire("mini-player-command", "toggle_favorite", track.bvid);
  assert.deepEqual(h.invoked, ["toggle_favorite"]);
  assert.equal(h.library.getState().library.favoriteBvids.has("bv0000000001"), true);
  assert.deepEqual(h.changes, ["bilibili-music-favorite-change"]);
  assert.equal(h.context.document.activeElement, h.focused);
});

test("mini favorite with no current track has no invoke, state change or prompt", async () => {
  const h = await createMiniHostFixture(), before = h.library.getState();
  await h.fire("mini-player-command", "toggle_favorite", "BV0000000001");
  assert.deepEqual(h.invoked, []); assert.equal(h.library.getState(), before);
  assert.equal(h.node("#status").textContent, ""); assert.deepEqual(h.changes, []);
});

test("mini favorite ignores a delayed click captured before the main window changed its displayed track", async () => {
  const h = await createMiniHostFixture();
  const a = h.setTrack();
  await h.fire("mini-player-ready");
  const clickedBvid = h.emissions.at(-1)!.payload.favoriteBvid;
  assert.equal(clickedBvid, a.bvid);
  const b = { ...a, bvid: "BV0000000002", title: "下一首" };
  h.store.actions.playbackQueue.replaceQueue([b]);
  h.store.actions.playbackQueue.selectIndex(0, false, null);
  await h.publishEvent("bilibili-music-trackchange");
  assert.equal(h.emissions.at(-1)!.payload.favoriteBvid, a.bvid);
  await h.fire("mini-player-command", "toggle_favorite", " " + a.bvid.toLowerCase());
  assert.equal(h.library.getState().library.favoriteBvids.has(a.bvid.toLowerCase()), true);
  await h.fire("mini-player-command", "toggle_favorite", a.bvid);
  assert.equal(h.library.getState().library.favoriteBvids.size, 0);

  h.store.actions.playbackDisplay.setRenderedTrack({ ...b, actionTrack: b });
  await h.publishEvent("bilibili-music-trackchange");
  assert.equal(h.emissions.at(-1)!.payload.favoriteBvid, b.bvid);
  const before = h.library.getState();
  const emitted = h.emissions.length;
  await h.fire("mini-player-command", "toggle_favorite", clickedBvid);
  await h.fire("mini-player-command", "toggle_favorite");
  assert.deepEqual(h.invoked, ["toggle_favorite", "toggle_favorite"]);
  assert.equal(h.library.getState(), before);
  assert.equal(h.emissions.length, emitted);
});

test("mini play during pending or active resume runs only recovery and unknown commands do nothing", async () => {
  const h = await createMiniHostFixture(); h.context.getSessionActions().setPendingResume(true);
  await h.fire("mini-player-command", "toggle_play"); assert.equal(h.context.resumes, 1);
  h.context.getSessionActions().setPendingResume(false); h.context.getSessionActions().setResumeInProgress(true);
  await h.fire("mini-player-command", "toggle_play"); assert.equal(h.context.resumes, 2);
  await h.fire("mini-player-command", "unknown");
  assert.deepEqual(h.audio.operations, []); assert.deepEqual(h.navigation, []); assert.deepEqual(h.invoked, []);
});

test("mini ready publishes every empty queue field with original defaults", async () => {
  const h = await createMiniHostFixture(); await h.fire("mini-player-ready");
  assert.deepEqual(h.emissions, [{ label: "mini", name: "mini-player-state", payload: {
    title: "尚未播放", uploader: "—", thumbnailUrl: "", status: "", notice: "", hasCurrent: false, progress: { seq: 1 },
    canPrevious: true, canNext: true, isPlaying: false, isFavorited: false, theme: "dark", accent: { r: 251, g: 114, b: 153 },
  } }]);
});

test("mini payload preserves single and multi page titles, favorites, playing and paused fields", async () => {
  for (const pages of [1, 2]) {
    const h = await createMiniHostFixture(); const track = h.setTrack(pages);
    h.node("#status").textContent = "在线播放中。"; h.node("#playback-notice").textContent = "已经是第一首了";
    await h.fire("mini-player-ready");
    assert.deepEqual(h.emissions[0].payload, { title: pages === 1 ? "曲目" : "分P1", uploader: "作者", thumbnailUrl: "https://example.com/cover.jpg",
      status: "在线播放中。", notice: "已经是第一首了", hasCurrent: true, canPrevious: true, canNext: true,
      isPlaying: false, isFavorited: false, favoriteBvid: track.bvid, progress: { seq: 1 }, theme: "dark", accent: { r: 251, g: 114, b: 153 } });
    await h.fire("mini-player-command", "toggle_favorite", track.bvid);
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

test("mini progress observes only a ready session and pairs its listeners across close and reopen", async () => {
  const h = await createMiniHostFixture();
  const types = ["loadstart", "playing", "waiting", "seeking", "seeked", "durationchange", "loadedmetadata", "ratechange", "timeupdate"];
  const listenerCounts = () => types.map(type => h.audio.listeners.get(type)?.length ?? 0);
  const baseline = listenerCounts();
  await h.audio.fire("playing");
  assert.equal(h.emissions.length, 0);
  await h.fire("mini-player-ready");
  assert.deepEqual(h.emissions.at(-1)!.payload.progress, { seq: 1 });
  assert.deepEqual(listenerCounts(), baseline.map(count => count + 1));
  await h.fire("mini-player-ready");
  assert.deepEqual(listenerCounts(), baseline.map(count => count + 1));
  await h.fire("tauri://destroyed");
  assert.deepEqual(listenerCounts(), baseline);
  await h.audio.fire("pause");
  await h.publishEvent("bilibili-music-trackchange");
  assert.equal(h.emissions.length, 1);
  await h.fire("mini-player-ready");
  assert.deepEqual(h.emissions.at(-1)!.payload.progress, { seq: 2 });
  assert.deepEqual(listenerCounts(), baseline.map(count => count + 1));
  await h.publishEvent("beforeunload");
  assert.deepEqual(listenerCounts(), baseline);
});

test("mini progress samples actual media, calibrates at ten seconds and stops on buffering and pause", async () => {
  const h = await createMiniHostFixture();
  h.setTrack();
  const media = Object.assign(h.audio, { currentTime: 7, currentSrc: "fixture", duration: 60, readyState: 3, paused: false, seeking: false });
  let now = 1000;
  h.context.performance = { now: () => now };
  const progress = () => h.emissions.at(-1)!.payload.progress;
  await h.fire("mini-player-ready");
  assert.partialDeepStrictEqual(progress(), { seq: 1, positionSeconds: 7, durationSeconds: 60, advancing: true, playbackRate: 1 });
  media.currentTime = 15;
  now += 9999;
  await h.audio.fire("timeupdate");
  assert.equal(h.emissions.length, 1);
  now++;
  await h.audio.fire("timeupdate");
  assert.equal(h.emissions.length, 2);
  assert.partialDeepStrictEqual(progress(), { positionSeconds: 15 });

  h.store.actions.playbackDisplay.setSeeking(true);
  h.store.actions.playbackDisplay.observeProgress({ currentTime: 15, duration: 60, paused: false, ended: false, playbackRate: 1 }, 53);
  assert.equal(h.emissions.length, 2);
  media.seeking = true;
  media.currentTime = 30;
  await h.audio.fire("seeking");
  assert.partialDeepStrictEqual(progress(), { positionSeconds: 30 });
  assert.partialDeepStrictEqual(progress(), { advancing: false });
  media.seeking = false;
  await h.audio.fire("seeked");
  assert.partialDeepStrictEqual(progress(), { advancing: true });
  media.playbackRate = 1.5;
  await h.audio.fire("ratechange");
  assert.partialDeepStrictEqual(progress(), { playbackRate: 1.5 });

  media.readyState = 2;
  await h.audio.fire("waiting");
  assert.partialDeepStrictEqual(progress(), { advancing: false });
  const buffered = h.emissions.length;
  now += 10_000;
  await h.audio.fire("timeupdate");
  assert.equal(h.emissions.length, buffered);
  media.readyState = 3;
  await h.audio.fire("playing");
  assert.partialDeepStrictEqual(progress(), { advancing: true });

  media.currentTime = 33;
  media.paused = true;
  await h.audio.fire("pause");
  assert.partialDeepStrictEqual(progress(), { positionSeconds: 33 });
  assert.partialDeepStrictEqual(progress(), { advancing: false });
  assert.equal(h.emissions.at(-1)!.payload.isPlaying, false);
  media.duration = Infinity;
  await h.audio.fire("durationchange");
  assert.deepEqual(progress(), { seq: progress().seq });
});

test("mini progress clears old audio across same-request recovery and samples the saved position before resume", async () => {
  const h = await createMiniHostFixture();
  h.setTrack();
  const media = Object.assign(h.audio, { currentTime: 0, currentSrc: "", duration: NaN, readyState: 0, paused: true });
  const session = h.store.actions.playbackSession;
  const progress = () => h.emissions.at(-1)!.payload.progress;
  session.setPendingResume({ positionSeconds: 26, page: 1, cid: 9 });
  await h.fire("mini-player-ready");
  assert.partialDeepStrictEqual(progress(), { positionSeconds: 26 });
  assert.partialDeepStrictEqual(progress(), { advancing: false });
  media.src = "private-mini-recovery-source";
  await h.audio.fire("loadstart");
  Object.assign(media, { currentSrc: media.src, duration: 60, readyState: 3 });
  await h.audio.fire("loadedmetadata");
  assert.partialDeepStrictEqual(progress(), { positionSeconds: 26 });
  media.currentTime = 26;
  session.setPendingResume(null);
  media.paused = false;
  await h.audio.fire("playing");
  assert.partialDeepStrictEqual(progress(), { advancing: true });
  assert.doesNotMatch(JSON.stringify(h.emissions.at(-1)), /private-mini-recovery-source/);

  media.readyState = 0;
  await h.audio.fire("emptied");
  await h.audio.fire("loadstart");
  assert.deepEqual(progress(), { seq: progress().seq });
  Object.assign(media, { currentTime: 26, readyState: 3 });
  await h.audio.fire("loadedmetadata");
  await h.audio.fire("seeked");
  await h.audio.fire("playing");
  assert.partialDeepStrictEqual(progress(), { positionSeconds: 26 });
  assert.partialDeepStrictEqual(progress(), { advancing: true });

  media.src = "other-mini-source";
  await h.audio.fire("loadstart");
  assert.deepEqual(progress(), { seq: progress().seq });
  await h.audio.fire("playing");
  assert.deepEqual(progress(), { seq: progress().seq });
});

test("mini theme and accent changes publish immediately and existing events still publish", async () => {
  const h = await createMiniHostFixture(); await h.fire("mini-player-ready");
  h.root.dataset.theme = "light"; h.channels.set("--accent-r", "40"); h.channels.set("--accent-g", "88"); h.channels.set("--accent-b", "161");
  await h.flush(); assert.equal(h.emissions.length, 2); assert.equal(h.emissions[0].payload.theme, "dark");
  await h.publishEvent("bilibili-music-favorite-change");
  assert.equal(h.emissions.length, 3); assert.equal(h.emissions[1].payload.theme, "light");
  assert.deepEqual(h.emissions[1].payload.accent, { r: 40, g: 88, b: 161 });
  assert.equal(h.emissions[2].payload.theme, "light");
});

test("mini installs ready and command listeners before attaching publication listeners", async () => {
  const h = await createMiniHostFixture();
  assert.deepEqual(h.installed, ["window:beforeunload", "tauri:mini-player-ready", "tauri:mini-player-command",
    "window:bilibili-music-trackchange", "window:bilibili-music-favorite-change", "window:bilibili-music-notice-change"]);
  await h.host.openMiniPlayer(); assert.deepEqual(h.invoked, ["open_mini_player"]);
  assert.equal(h.timers[0].delay, 5000);
  await h.fire("mini-player-ready"); assert.equal(h.emissions.length, 1);
});
