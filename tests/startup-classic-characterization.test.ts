import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { collectBusinessScripts } from "./helpers/module-graph.ts";
import { loadNativeModules } from "./helpers/native-module-loader.ts";
import { createMascotFixture, wireMiniHostApi } from "./helpers/startup-api-fixture.ts";
import { createMiniHostFixture } from "./helpers/mini-host-fixture.ts";

test("startup five deferred controllers retain their phases and first trackchange reaches only dynamic background", async () => {
  const ui = path.join(import.meta.dirname, "../ui"), html = fs.readFileSync(path.join(ui, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)].flatMap(tag => {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[1]);
    return src ? [{ file: src[1].replace(/^\.\//, ""), module: /\btype\s*=\s*["']module["']/i.test(tag[1]) }] : [];
  });
  const loaded = await loadNativeModules(ui, collectBusinessScripts(ui).files, "app.ts", scripts);
  const first = (pattern: RegExp) => loaded.events.findIndex(event => pattern.test(String(event.stack)));
  const phases = [/window-controls\.ts:/, /dynamic-background\.ts:/, /[/\\]main\.ts:/, /startAppearance .*appearance\.ts/, /lyrics\.ts:/, /mascot\.ts:/, /mini-player-host\.ts:/].map(first);
  assert.ok(phases.every(index => index >= 0));
  assert.deepEqual([...phases].sort((a, b) => a - b), phases);
  const dispatch = loaded.events.findIndex(event => event.action === "dispatch" && event.type === "bilibili-music-trackchange");
  assert.equal(dispatch, 70);
  const receivers = loaded.events.slice(0, dispatch).filter(event => event.action === "listen" && event.target === "window" && event.type === "bilibili-music-trackchange");
  assert.equal(receivers.length, 2);
  assert.match(String(receivers[0].stack), /dynamic-background\.ts:/);
  assert.match(String(receivers[1].stack), /playback-core\.ts:/);
  assert.equal(receivers.filter(event => /(?:window-controls|dynamic-background|lyrics|mascot|mini-player-host)\.ts:/.test(String(event.stack))).length, 1);
  assert.ok(first(/lyrics\.ts:/) > dispatch && first(/mascot\.ts:/) > dispatch);
});

test("startup mascot API and appearance picker retain switching persistence and unknown id fallback", () => {
  const h = createMascotFixture();
  assert.equal(h.api.getActive(), "kuro");
  const ids = h.api.list().map(item => item.id);
  assert.deepEqual(Array.from(ids), ["kuro", "nuomi", "juzi"]);
  assert.ok(h.api.list().every(item => item.name && item.svg.includes("<svg")));
  for (const id of ids) {
    assert.equal(h.api.setActive(id), id); assert.equal(h.api.getActive(), id);
    assert.deepEqual(h.writes.at(-1), ["bili-music-mascot", id]);
  }
  assert.equal(h.api.setActive("unknown"), "kuro");
  assert.deepEqual(h.writes.at(-1), ["bili-music-mascot", "kuro"]);
  assert.equal(h.api.setActive("none"), "none"); assert.equal(h.slot.innerHTML, "");
  h.renderPicker(); assert.equal(h.picker.children.length, ids.length + 1);
  h.picker.children[1].click(); assert.equal(h.api.getActive(), ids[1]);
  assert.deepEqual(h.writes.at(-1), ["bili-music-mascot", ids[1]]);
  h.picker.children.at(-1)!.click(); assert.equal(h.api.getActive(), "none");
  assert.equal(createMascotFixture("unknown").api.getActive(), "kuro");
  assert.equal(createMascotFixture("none").api.getActive(), "none");
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
