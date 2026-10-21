import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { collectBusinessScripts } from "../helpers/module-graph.ts";
import { loadMountedApplication as loadNativeModules } from "../../scripts/vue/startup-probe.ts";
import { wireMiniHostApi } from "../helpers/startup-api-fixture.ts";
import { createMiniHostFixture } from "../helpers/mini-host-fixture.ts";

test("startup four deferred controllers retain their phases and first trackchange reaches only dynamic background", async () => {
  const ui = path.join(import.meta.dirname, "../../ui"), html = fs.readFileSync(path.join(ui, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)].flatMap(tag => {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[1]);
    return src ? [{ file: src[1].replace(/^\.\//, ""), module: /\btype\s*=\s*["']module["']/i.test(tag[1]) }] : [];
  });
  const loaded = await loadNativeModules(ui, collectBusinessScripts(ui).files, "app.ts", scripts);
  const first = (pattern: RegExp) => loaded.events.findIndex(event => pattern.test(String(event.stack)));
  const phases = [/window-controls\.ts:/, /dynamic-background\.ts:/, /[/\\]main\.ts:/, /startAppearance .*appearance\.ts/, /lyrics\.ts:/, /mini-player-host\.ts:/].map(first);
  assert.ok(phases.every(index => index >= 0));
  assert.deepEqual([...phases].sort((a, b) => a - b), phases);
  const dispatch = loaded.events.findIndex(event => event.action === "dispatch" && event.type === "bilibili-music-trackchange");
  assert.equal(dispatch, 140);
  const receivers = loaded.events.slice(0, dispatch).filter(event => event.action === "listen" && event.target === "window" && event.type === "bilibili-music-trackchange");
  assert.equal(receivers.length, 2);
  assert.match(String(receivers[0].stack), /dynamic-background\.ts:/);
  assert.match(String(receivers[1].stack), /playback-core\.ts:/);
  assert.equal(receivers.filter(event => /(?:window-controls|dynamic-background|lyrics|mini-player-host)\.ts:/.test(String(event.stack))).length, 1);
  assert.ok(first(/lyrics\.ts:/) > dispatch);
});


test("startup mini host consumes all seven ports with real commands snapshot messages and theme notifications", async () => {
  const h = await createMiniHostFixture(); h.setTrack();
  wireMiniHostApi(h.context, h.library);
  const listeners = new Map<string, (event: { payload: { action: string } }) => void>(), frames: FrameRequestCallback[] = [];
  const emissions: MiniPlayerStatePayload[] = [];
  const createHost = vm.runInContext("createMiniPlayerHost", h.context);
  const host = createHost({ window: h.context.window, document: h.context.document, console,
    // src-tauri/src/mini_player.rs:29,85: open/close commands return unit; an open error is a rejected string.
    invoke: async () => { throw "窗口创建失败"; }, setTimeoutFn: () => 0, clearTimeoutFn() {},
    requestFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }, cancelFrame() {},
    eventApi: { listen: async (name: string, callback: (event: { payload: { action: string } }) => void) => { listeners.set(name, callback); return () => {}; },
      emitTo: async (_label: string, _name: string, payload: MiniPlayerStatePayload) => { emissions.push(payload); } } });
  await host.start();
  const command = listeners.get("mini-player-command")!;
  command({ payload: { action: "previous" } }); command({ payload: { action: "next" } });
  assert.deepEqual(h.navigation, ["previous", "next"]);
  command({ payload: { action: "toggle_play" } }); await h.flush(); assert.deepEqual(h.audio.operations, ["play"]);
  command({ payload: { action: "toggle_favorite" } }); await h.flush(); assert.deepEqual(h.invoked, ["toggle_favorite"]);
  listeners.get("mini-player-ready")!({ payload: { action: "" } }); await h.flush();
  assert.equal(emissions.length, 1); assert.equal(emissions[0].title, "曲目"); assert.equal(emissions[0].isFavorited, true);
  h.store.actions.settings.setTheme("light", false);
  assert.equal(frames.length, 1); frames.shift()!(0); await h.flush();
  assert.equal(emissions.length, 2); assert.equal(emissions[1].theme, "light");
  await host.openMiniPlayer();
  assert.equal(h.store.getState().playbackMessages.status, "迷你播放器打开失败：窗口创建失败");
});
