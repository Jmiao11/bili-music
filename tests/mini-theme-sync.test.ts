import assert from "node:assert/strict";
import { test } from "node:test";
import { createMiniHostFixture } from "./helpers/mini-host-fixture.ts";

test("mini theme notifications pass no arguments and select only changed effective theme and accent", async () => {
  const h = await createMiniHostFixture(), sizes: number[] = [];
  const unlisten = h.context.subscribeMiniPlayerTheme((...args: unknown[]) => sizes.push(args.length));
  h.store.actions.settings.setSlider("blur", 55, false);
  h.store.actions.settings.panel(true);
  h.store.actions.playbackSettings.setUserVolume(0.5);
  h.store.actions.settings.setTheme("dark", false);
  assert.deepEqual(sizes, []);
  h.store.actions.settings.setTheme("light", false);
  h.store.actions.settings.setAccent("blue", "light", false);
  assert.deepEqual(sizes, [0, 0]);
  h.store.actions.settings.setAccent("blue", "light", false);
  assert.equal(sizes.length, 2);
  unlisten(); h.store.actions.settings.setTheme("dark", false);
  assert.equal(sizes.length, 2);
});

test("mini theme changes coalesce within each frame and publish final values in a complete payload", async () => {
  const h = await createMiniHostFixture(); await h.fire("mini-player-ready");
  h.store.actions.settings.setTheme("light", false);
  h.store.actions.settings.setAccent("blue", "light", false);
  h.store.actions.settings.setAccent("green", "light", false);
  assert.equal(h.emissions.length, 1); assert.equal(h.frameCount(), 1);
  await h.flushFrame();
  assert.equal(h.emissions.length, 2);
  assert.equal(h.emissions[1].payload.theme, "light");
  assert.deepEqual(h.emissions[1].payload.accent, { r: 40, g: 102, b: 25 });
  assert.deepEqual(Object.keys(h.emissions[1].payload).sort(), Object.keys(h.emissions[0].payload).sort());
  h.store.actions.settings.setAccent("purple", "light", false);
  h.store.actions.settings.setAccent("orange", "light", false);
  assert.equal(h.emissions.length, 2); await h.flushFrame();
  assert.equal(h.emissions.length, 3);
  assert.deepEqual(h.emissions[2].payload.accent, { r: 128, g: 77, b: 32 });
});

test("mini theme synchronization ignores other settings and unchanged projected values", async () => {
  const h = await createMiniHostFixture(); await h.fire("mini-player-ready");
  h.store.actions.settings.setSlider("blur", 55, false);
  h.store.actions.settings.setSlider("alpha", 80, false);
  h.store.actions.settings.setSlider("dim", 70, false);
  h.store.actions.settings.setAiFormat("openai");
  h.store.actions.settings.setTheme("dark", false);
  h.store.actions.settings.setAccent("pink", "dark", false);
  await h.flush(); assert.equal(h.emissions.length, 1); assert.equal(h.frameCount(), 0);
});

test("mini theme synchronization waits for ready and later changes publish", async () => {
  const h = await createMiniHostFixture();
  h.store.actions.settings.setTheme("light", false);
  assert.equal(h.frameCount(), 0); await h.flush(); assert.equal(h.emissions.length, 0);
  await h.fire("mini-player-ready");
  assert.equal(h.emissions.length, 1); assert.equal(h.emissions[0].payload.theme, "light");
  h.store.actions.settings.setAccent("blue", "light", false); await h.flush();
  assert.equal(h.emissions.length, 2); assert.deepEqual(h.emissions[1].payload.accent, { r: 40, g: 88, b: 161 });
});

test("mini close cancels theme subscription and pending frame and reopening subscribes again", async () => {
  const h = await createMiniHostFixture(); await h.fire("mini-player-ready");
  const target = h.listenTargets.find(item => item.name === "tauri://destroyed")?.target;
  assert.equal(target?.kind, "Window"); assert.equal(target?.label, "mini");
  assert.equal(h.themeSubscriberCount(), 1);
  h.store.actions.settings.setTheme("light", false); assert.equal(h.frameCount(), 1);
  // tauri-2.11.3/src/manager/window.rs:177: destroyed emits unit (JSON null); handler does not inspect payload.
  await h.fire("tauri://destroyed");
  assert.equal(h.themeSubscriberCount(), 0); assert.equal(h.frameCount(), 0);
  h.store.actions.settings.setAccent("blue", "light", false); await h.flush();
  assert.equal(h.emissions.length, 1);
  await h.fire("mini-player-ready"); assert.equal(h.themeSubscriberCount(), 1);
  h.store.actions.settings.setAccent("green", "light", false); await h.flush();
  assert.equal(h.emissions.length, 3); assert.deepEqual(h.emissions[2].payload.accent, { r: 40, g: 102, b: 25 });
});

test("mini beforeunload cancels theme subscription and pending frame", async () => {
  const h = await createMiniHostFixture(); await h.fire("mini-player-ready");
  h.store.actions.settings.setTheme("light", false);
  await h.publishEvent("beforeunload");
  assert.equal(h.themeSubscriberCount(), 0); assert.equal(h.frameCount(), 0);
  h.store.actions.settings.setAccent("blue", "light", false); await h.flush();
  assert.equal(h.emissions.length, 1);
});

test("mini theme frame reads latest full non-sensitive payload and leaves existing publish events immediate", async () => {
  const h = await createMiniHostFixture(); h.setTrack(); await h.fire("mini-player-ready");
  h.store.actions.settings.setTheme("light", false);
  h.store.actions.playbackRequest.activateAudio(1, "private-theme-audio-sentinel", 1);
  h.node("#status").textContent = "最新提示";
  await h.publishEvent("bilibili-music-notice-change");
  assert.equal(h.emissions.length, 2);
  await h.flushFrame(); assert.equal(h.emissions.length, 3);
  assert.equal(h.emissions[2].payload.status, "最新提示");
  assert.equal(JSON.stringify(h.emissions[2].payload).includes("private-theme-audio-sentinel"), false);
});
