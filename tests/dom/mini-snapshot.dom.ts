import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { collectBusinessScripts } from "../helpers/module-graph.ts";
import { loadMountedApplication as loadNativeModules } from "../../scripts/vue/startup-probe.ts";
import { createMiniHostFixture } from "../helpers/mini-host-fixture.ts";
import { test } from "node:test";
import { createApplicationStore } from "../../ui/store/app-state.ts";
import { selectMiniPlayerSnapshot } from "../../ui/mini/mini-player-projection.ts";
import { libraryQueueEntries } from "../../ui/features/playback/playback-queue-state.ts";
import { playbackFixture } from "./playback-ui-fixture.ts";
import { deferred, responses, track } from "./tracks-fixture.ts";
import { collection, collectionEntry } from "../helpers/collections.ts";

const create = () => createApplicationStore({ invoke: async () => null, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
test("mini snapshot projection preserves displayed track independently of pending queue and media observations", () => {
  const store = create(), track = { bvid: "BV0000000001", title: "队列标题", uploader: "作者", thumbnailUrl: "", durationSeconds: 60 };
  store.actions.playbackQueue.replaceQueue([track]); store.actions.playbackQueue.selectIndex(0, false, null);
  assert.equal(selectMiniPlayerSnapshot(store.getState()).title, "尚未播放");
  store.actions.playbackDisplay.setRenderedTrack({ title: "分P标题", uploader: "作者", thumbnailUrl: "https://example.com/cover.jpg" });
  const media = { currentTime: 0, duration: 60, paused: false, ended: false, playbackRate: 1 };
  store.actions.playbackDisplay.observePlaying(media);
  store.actions.playbackDisplay.observeMedia({ ...media, paused: true });
  const snapshot = selectMiniPlayerSnapshot(store.getState());
  assert.equal(snapshot.title, "分P标题"); assert.equal(snapshot.isPlaying, true); assert.equal(snapshot.hasCurrent, true);
  store.actions.playbackDisplay.observePlaying({ ...media, paused: true });
  assert.equal(selectMiniPlayerSnapshot(store.getState()).isPlaying, false);
  store.actions.playbackQueue.replaceQueue([]);
  assert.equal(selectMiniPlayerSnapshot(store.getState()).hasCurrent, false);
  assert.equal(selectMiniPlayerSnapshot(store.getState()).canPrevious, true);
  assert.equal(selectMiniPlayerSnapshot(store.getState()).canNext, true);
});

test("mini snapshot uses applied accent variant and exposes only approved non-sensitive fields", () => {
  const store = create(); store.actions.settings.setAccent("blue", "dark", false);
  store.actions.settings.setTheme("light", false);
  store.actions.playbackRequest.activateAudio(1, "private-audio-sentinel", 123);
  const snapshot = selectMiniPlayerSnapshot(store.getState());
  assert.equal(JSON.stringify(snapshot).includes("private-audio-sentinel"), false);
  assert.deepEqual(snapshot.accent, { r: 122, g: 166, b: 231 });
  assert.equal(snapshot.theme, "light");
  assert.deepEqual(Object.keys(snapshot).sort(), ["accent", "canNext", "canPrevious", "hasCurrent", "isFavorited", "isPlaying", "theme", "thumbnailUrl", "title", "uploader"]);
  store.actions.playbackDisplay.setCurrentTrack({ bvid: "BV0000000001", title: "沉浸页曲目" });
  assert.equal(store.getState().playbackDisplay.currentTrack.title, "沉浸页曲目");
  assert.equal(selectMiniPlayerSnapshot(store.getState()).title, "尚未播放");
});

test("real playback projects the restored member through failed resolution until the next audio resolves", async t => {
  const h = await playbackFixture();
  t.after(h.dispose);
  const group = collection(2), member = group.snapshot.items[1], failed = track(3), next = track(4);
  const [entry] = libraryQueueEntries([collectionEntry(group)]);
  const rejected = deferred(), resolved = deferred();
  h.reply(async (command, args) => {
    if (command === "get_playback_state") return {
      version: 2, queue: [{ ...entry, collection: { ...entry.collection, memberIndex: 1, remaining: [] } }],
      currentIndex: 0, positionSeconds: 23, page: 1, cid: 11, savedAt: 1,
      traversal: { randomRemaining: [], history: [], randomPageRound: null, shuffle: false, loopMode: "sequence" },
    };
    if (command === "get_video_pages") return [];
    if (command === "prepare_audio") return args.bvId === failed.bvid ? rejected.promise : resolved.promise;
    return responses()(command);
  });
  const snapshot = () => selectMiniPlayerSnapshot(h.store.getState());
  assert.equal(snapshot().favoriteBvid, undefined);
  await h.core.restorePlaybackState();
  assert.equal(snapshot().favoriteBvid, member.bvid);
  h.core.playListItem("direct", [failed, next], 0);
  await h.microtasks();
  assert.equal(snapshot().favoriteBvid, member.bvid);
  rejected.reject(Error("synthetic resolution failure"));
  await h.microtasks();
  assert.equal(h.calls.filter(call => call.command === "prepare_audio").at(-1)?.args.bvId, next.bvid);
  assert.equal(snapshot().favoriteBvid, member.bvid);
  resolved.resolve({ audioUrl: "http://127.0.0.1/audio/fixture", title: next.title, uploader: next.uploader, thumbnailUrl: "", durationSeconds: 60 });
  await h.microtasks();
  assert.equal(snapshot().favoriteBvid, next.bvid);
});

test("mini bridge exposes exactly seven frozen functions backed by actual commands and snapshot projection", async () => {
  const h = await createMiniHostFixture(); h.setTrack();
  h.context.selectMiniPlayerSnapshot = selectMiniPlayerSnapshot;
  const source = fs.readFileSync(path.join(import.meta.dirname, "../../ui/mini/mini-player-host.ts"), "utf8");
  const ports = vm.runInContext("({ getMiniPlayerHostSnapshot, subscribeMiniPlayerTheme })", h.context);
  const commands = h.context.getPlaybackCommands();
  assert.deepEqual(Object.keys(ports).sort(), ["getMiniPlayerHostSnapshot", "subscribeMiniPlayerTheme"]);
  assert.equal(h.context.window.bilibiliMusicMiniHost, undefined);
  commands.previous(); commands.next(); await commands.togglePlayPause();
  assert.deepEqual(h.navigation, ["previous", "next"]); assert.deepEqual(h.audio.operations, ["play"]);
  await h.context.toggleCurrentFavorite(); assert.deepEqual(h.invoked, ["toggle_favorite"]);
  const projection = ports.getMiniPlayerHostSnapshot();
  assert.equal(projection.title, "曲目"); assert.equal(projection.hasCurrent, true);
  assert.doesNotMatch(source, /window\.bilibiliMusicMiniHost/);
});

test("mini default host reports an early command error and uses the bridge after registration", async () => {
  const h = await createMiniHostFixture(); h.setTrack();
  const createHost = vm.runInContext("createMiniPlayerHost", h.context);
  const getCommands = h.context.getPlaybackCommands;
  h.context.getPlaybackCommands = () => undefined;
  let command: ((event: { payload: { action: string } }) => void) | undefined;
  const host = createHost({ document: h.context.document, window: h.context.window, console,
    invoke: async () => null,
    eventApi: { emitTo: async () => {}, listen: async (name: string, handler: typeof command) => {
      if (name === "mini-player-command") command = handler; return () => {};
    } }, setTimeoutFn: () => 0, clearTimeoutFn() {},
  });
  await host.start();
  assert.equal(h.context.window.bilibiliMusicMiniHost, undefined);
  if (!command) throw Error("Command listener missing");
  // A forced invocation before commands are initialized still reports its exception.
  assert.throws(() => command!({ payload: { action: "previous" } }), /Cannot read properties of undefined/);
  assert.deepEqual(h.navigation, []);
  h.context.getPlaybackCommands = getCommands;
  command({ payload: { action: "previous" } }); assert.deepEqual(h.navigation, ["previous"]);
});

test("mini host actual classic execution follows the registered bridge and appearance startup", async () => {
  const ui = path.join(import.meta.dirname, "../../ui"), html = fs.readFileSync(path.join(ui, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)].flatMap(tag => {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[1]);
    return src ? [{ file: src[1].replace(/^\.\//, ""), module: /\btype\s*=\s*["']module["']/i.test(tag[1]) }] : [];
  });
  const loaded = await loadNativeModules(ui, collectBusinessScripts(ui).files, "app.ts", scripts);
  const bridge = loaded.events.findIndex(event => event.action === "window-set" && event.property === "bilibiliMusicMiniHost");
  const host = loaded.events.findIndex(event => /mini-player-host\.ts:/.test(String(event.stack)));
  const appearance = loaded.events.map((event, index) => ({ event, index })).filter(item => /startAppearance .*appearance\.ts/.test(String(item.event.stack)));
  assert.equal(scripts.filter(script => script.module).length, 1);
  assert.equal(scripts.at(-1)!.module, true);
  assert.equal(bridge, -1);
  assert.ok(appearance.length > 0 && appearance.every(item => item.index < host));
});
