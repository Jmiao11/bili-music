import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlaybackCommands } from "../ui/features/playback/playback-commands.ts";
import { createMediaAdapter } from "../ui/platform/media-adapter.ts";
import { createControllerContext as createSessionContext } from "./helpers/controller-context.ts";
import vm from "node:vm";

function fixture() {
  const calls: (string | number)[] = [];
  const session = { pendingResume: null as unknown, resumeInProgress: false };
  const target = { src: "fixture", currentSrc: "fixture", currentTime: 10, duration: 100, volume: 1, paused: true,
    load() {}, async play() { calls.push("play"); }, pause() { calls.push("pause"); }, addEventListener() {}, removeEventListener() {} };
  const media = createMediaAdapter(target);
  const commands = createPlaybackCommands({ session: () => session, resume: () => calls.push("resume"),
    shuffle: () => false, retreat: () => false, advance: () => false,
    previous: () => calls.push("previous"), next: () => calls.push("next"),
    clearResume: () => calls.push("clear-resume"), clearNotice: () => calls.push("clear-notice"),
    media: () => media, observe: () => media.getObservation(), setSeeking: value => calls.push(String(value)), syncPosition: () => calls.push("position"),
    diagnostic() {}, status: message => calls.push(message),
  });
  return { calls, session, target, commands };
}

test("playback commands use media adapter and preserve currentSrc rather than assigned src", async () => {
  const h = fixture(); await h.commands.togglePlayPause(); h.target.paused = false; await h.commands.togglePlayPause();
  assert.deepEqual(h.calls, ["play", "pause"]);
  h.calls.length = 0; h.target.currentSrc = ""; await h.commands.togglePlayPause();
  assert.deepEqual(h.calls, ["请先从队列中选择一首歌曲。"]);
});

test("playback commands intercept both recovery states before media actions", async () => {
  const h = fixture(); h.session.pendingResume = { positionSeconds: 5 }; await h.commands.togglePlayPause();
  h.session.pendingResume = null; h.session.resumeInProgress = true; await h.commands.togglePlayPause();
  assert.deepEqual(h.calls, ["resume", "resume"]);
});

test("playback commands navigate once and preserve slider versus Media Session duration rules", () => {
  const h = fixture(); h.commands.previous(); h.commands.next(); assert.deepEqual(h.calls, ["previous", "next"]);
  h.target.duration = 0; h.commands.seekTo(60); assert.equal(h.target.currentTime, 10);
  h.commands.seekSlider(60); assert.equal(h.target.currentTime, 60); assert.equal(h.calls.at(-1), "false");
  h.target.duration = 100; h.commands.seekBy(-1, 0); assert.equal(h.target.currentTime, 50);
  h.commands.seekBy(1, 300); assert.equal(h.target.currentTime, 100);
});

test("session fixture exposes the real command factory while retaining legacy resume boundary inputs", async () => {
  let resumed = 0;
  const context = createSessionContext({ resumePendingPlayback() { resumed++; } });
  context.getSessionActions().setPendingResume({ positionSeconds: 5 });
  vm.runInContext("function runCommand() { return getPlaybackCommands().togglePlayPause(); }", context);
  await context.runCommand();
  assert.equal(resumed, 1);
  assert.equal(typeof context.createPlaybackCommands, "function");
});
