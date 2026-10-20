import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, deferred, responses } from "./library-lists-fixture.ts";
import { collection, collectionEntry, collectionPage, videoEntry } from "../helpers/collections.ts";
import { libraryQueueEntries } from "../../ui/features/playback/playback-queue-state.ts";
import { selectMiniPlayerSnapshot } from "../../ui/mini/mini-player-projection.ts";

async function setup(count = 12) {
  const h = await fixture({ playback: true }), data = collection(count), entry = collectionEntry(data);
  const entries = [entry, videoEntry({ ...data.snapshot.items[0], bvid: "BV9999999999", title: "独立视频" })];
  const pages = [1, 2].map(page => ({ page, cid: page * 11, part: `P${page}`, durationSeconds: 60 }));
  const reply = async (command: string, args: Record<string, unknown>): Promise<unknown> => {
    if (command === "list_favorites") return entries;
    if (["list_playlists", "list_unavailable_tracks"].includes(command)) return [];
    if (["list_disabled_pages", "get_cached_video_pages"].includes(command)) return {};
    if (command === "get_collection_page") return collectionPage(data);
    if (command === "update_collection_entry") return true;
    if (command === "get_video_pages") return pages;
    if (command === "prepare_audio") return { audioUrl: `http://127.0.0.1/audio/${args.bvId}-${args.cid}`, title: `音频${args.bvId}`, uploader: "真实作者", thumbnailUrl: "", durationSeconds: 60 };
    return responses()(command);
  };
  h.reply(reply); await h.library.loadLibrary();
  const audio = h.doc.querySelector<HTMLAudioElement>("audio")!;
  Object.defineProperties(audio, { currentSrc: { configurable: true, get: () => audio.src }, paused: { configurable: true, get: () => false }, ended: { configurable: true, get: () => true }, readyState: { configurable: true, value: 1 }, duration: { configurable: true, value: 60 } });
  const start = () => { h.core.playListItem("favorites", libraryQueueEntries(entries), 0); };
  const units = () => h.calls.filter(call => call.command === "prepare_audio").map(call => [call.args.bvId, call.args.cid]);
  return { ...h, data, entry, entries, pages, audio, start, units, baseReply: reply };
}

test("collection controller shares one quota across member pages and displays the real audio", async () => {
  const h = await setup();
  try {
    h.window.localStorage.setItem("bilibili-music.shuffle-collection-order", "sequential");
    h.window.localStorage.setItem("bilibili-music.shuffle-collection-limit", "3");
    h.store.actions.playbackQueue.changeShuffle(true, () => 0); h.start(); await h.microtasks();
    await h.fire(h.audio, "ended"); await h.fire(h.audio, "ended");
    assert.deepEqual(h.units(), [[h.data.snapshot.items[0].bvid, 11], [h.data.snapshot.items[0].bvid, 22], [h.data.snapshot.items[1].bvid, 11]]);
    assert.equal(h.core.currentPlayableTrack()?.bvid, h.data.snapshot.items[1].bvid);
    assert.equal(h.core.currentVideoPage()?.cid, 11);
    assert.equal(h.doc.querySelector("#title")?.textContent, "P1");
    assert.equal(h.store.getState().playbackQueue.queue[0].collection?.playedCount, 2);
    await h.fire(h.audio, "ended");
    assert.equal(h.core.currentPlayableTrack()?.bvid, "BV9999999999");
    assert.equal(h.store.getState().playbackQueue.queue[0].collection?.playedCount, 3);
    assert.equal(h.calls.filter(call => call.command === "get_collection_page").length, 1);
  } finally { h.dispose(); }
});

test("library collection single click waits 250ms and highlights the parent rather than its standalone member", async () => {
  const h = await setup(3);
  try {
    const entries = [h.entry, videoEntry(h.data.snapshot.items[0])];
    h.reply(async (command, args) => command === "list_favorites" ? entries : h.baseReply(command, args));
    await h.library.loadLibrary();
    const list = h.nodes.favoritesList;
    await h.fire(list.children[0].querySelector("button.track")!, "click", { detail: 1 });
    await h.advance(249);
    assert.equal(h.units().length, 0);
    assert.equal(h.calls.some(call => call.command === "get_collection_page"), false);
    await h.advance(1);
    assert.equal(h.units().length, 1);
    assert.equal(h.store.getState().playbackQueue.queue.length, 2);
    assert.ok(h.store.getState().playbackQueue.queue[0].collection);
    assert.equal(list.children[0].querySelector("button.track")?.getAttribute("aria-current"), "true");
    assert.notEqual(list.children[1].querySelector("button.track")?.getAttribute("aria-current"), "true");
    const mini = selectMiniPlayerSnapshot(h.store.getState());
    assert.equal(mini.title, "P1");
    assert.equal(mini.isFavorited, true);
  } finally { h.dispose(); }
});

test("library collection double click cancels playback and its badge opens without changing the queue", async () => {
  const h = await setup(3);
  try {
    const row = h.nodes.favoritesList.children[0], button = row.querySelector("button.track")!;
    await h.fire(button, "click", { detail: 1 });
    await h.fire(button, "click", { detail: 2 });
    await h.fire(row, "dblclick", { detail: 2 });
    await h.advance(250);
    assert.equal(h.store.getState().collection.active, true);
    assert.equal(h.units().length, 0);
    assert.equal(h.store.getState().playbackQueue.queue.length, 0);
    await h.fire(row.querySelector(".page-count-badge")!, "click", { detail: 0 });
    assert.equal(h.units().length, 0);
    assert.equal(h.store.getState().playbackQueue.queue.length, 0);
  } finally { h.dispose(); }
});

test("playlist keyboard activation includes collection parents and displays actual audio", async () => {
  const h = await setup(3);
  try {
    h.reply(async (command, args) => command === "list_playlists" ? [{ id: "a", name: "混排", createdAt: "1", items: h.entries }] : h.baseReply(command, args));
    await h.library.loadLibrary();
    await h.fire(h.nodes.playlistTracks.children[0].querySelector("button.track")!, "click", { detail: 0 });
    assert.equal(h.store.getState().playbackQueue.queueSource, "playlist");
    assert.equal(h.store.getState().playbackQueue.queue.length, 2);
    assert.equal(h.core.currentPlayableTrack()?.bvid, h.data.snapshot.items[0].bvid);
    assert.equal(h.nodes.playlistTracks.children[0].querySelector("button.track")?.getAttribute("aria-current"), "true");
  } finally { h.dispose(); }
});

test("collection previous returns to the actual member and CID without refreshing or charging again", async () => {
  const h = await setup();
  try {
    h.start(); await h.microtasks();
    await h.fire(h.audio, "ended"); await h.fire(h.audio, "ended");
    assert.equal(h.core.currentPlayableTrack()?.bvid, h.data.snapshot.items[1].bvid);
    h.core.playPrevious(); await h.microtasks();
    assert.equal(h.core.currentPlayableTrack()?.bvid, h.data.snapshot.items[0].bvid);
    assert.equal(h.core.currentVideoPage()?.cid, 22);
    const count = h.store.getState().playbackQueue.queue[0].collection?.playedCount;
    await h.fire(h.audio, "ended");
    assert.equal(h.store.getState().playbackQueue.queue[0].collection?.playedCount, count);
    assert.equal(h.calls.filter(call => call.command === "get_collection_page").length, 1);
  } finally { h.dispose(); }
});

test("collection refresh failure plays the dated snapshot and a later view refresh cannot reorder playback", async () => {
  const h = await setup(4);
  try {
    h.reply(async (command, args) => { if (command === "get_collection_page") throw Error("HTTP 412"); return h.baseReply(command, args); });
    h.start(); await h.microtasks();
    assert.equal(h.units()[0][0], h.data.snapshot.items[0].bvid);
    assert.equal(h.store.getState().playbackQueue.queue[0].collection?.data.snapshot.fetchedAt, h.data.snapshot.fetchedAt);
    assert.match(h.store.getState().playbackMessages.notice.text, /来源无法校验/);
    const frozen = h.store.getState().playbackQueue.queue[0].collection;
    const fresh = { ...h.data, snapshot: { fetchedAt: "1800000000000", items: [...h.data.snapshot.items].reverse() } };
    h.reply(async (command, args) => command === "get_collection_page" ? collectionPage(fresh) : h.baseReply(command, args));
    h.store.actions.collection.open({ kind: "collection", bvid: h.data.anchorBvid, id: h.data.collectionId }, h.data.title, h.data.videoCount, "favorites", 0, h.data, { entryId: h.entry.entryId, playlistId: null });
    await h.microtasks();
    assert.equal(h.store.getState().collection.fullSnapshot?.snapshot.fetchedAt, "1800000000000");
    assert.equal(h.store.getState().playbackQueue.queue[0].collection, frozen);
    await h.fire(h.audio, "ended"); await h.fire(h.audio, "ended");
    assert.equal(h.core.currentPlayableTrack()?.bvid, h.data.snapshot.items[1].bvid);
  } finally { h.dispose(); }
});

test("cancelled and late collection preparations consume no quota and cannot change the new audio", async () => {
  for (const outcome of ["success", "failure"]) {
    const h = await setup(), gate = deferred();
    try {
      let first = true;
      h.reply(async (command, args) => { if (command === "prepare_audio" && first) { first = false; return gate.promise; } return h.baseReply(command, args); });
      h.start(); await h.microtasks();
      h.core.playNext(); await h.microtasks();
      const current = h.core.currentPlayableTrack()?.bvid;
      if (outcome === "success") gate.resolve({ audioUrl: "http://127.0.0.1/audio/late", title: "迟到", uploader: "", thumbnailUrl: "", durationSeconds: 60 });
      else gate.reject(Error("late failure"));
      await h.microtasks();
      assert.equal(h.core.currentPlayableTrack()?.bvid, current);
      assert.equal(h.store.getState().playbackQueue.queue[0].collection?.playedCount, 0);
      assert.equal(h.store.getState().playbackRequest.consecutiveResolveFailures, 0);
      assert.equal(h.store.getState().playbackQueue.history.length, 0);
      assert.notEqual(h.audio.src, "http://127.0.0.1/audio/late");
    } finally { h.dispose(); }
  }
});

test("view and playback share one collection refresh and a cancelled late list cannot replace the new queue", async () => {
  const h = await setup(3), gate = deferred();
  try {
    h.reply(async (command, args) => command === "get_collection_page" ? gate.promise : h.baseReply(command, args));
    h.store.actions.collection.open({ kind: "collection", bvid: h.data.anchorBvid, id: h.data.collectionId }, h.data.title, h.data.videoCount, "favorites", 0, h.data, { entryId: h.entry.entryId, playlistId: null });
    h.start(); await h.microtasks();
    assert.equal(h.calls.filter(call => call.command === "get_collection_page").length, 1);
    h.core.playListItem("favorites", libraryQueueEntries(h.entries), 1); await h.microtasks();
    const queue = h.store.getState().playbackQueue.queue;
    gate.resolve(collectionPage(h.data)); await h.microtasks();
    assert.equal(h.store.getState().playbackQueue.queue, queue);
    assert.equal(h.core.currentPlayableTrack()?.bvid, "BV9999999999");
    assert.deepEqual(h.units().map(unit => unit[0]), ["BV9999999999"]);
    assert.equal(h.store.getState().playbackQueue.queue[0].collection?.playedCount, 0);
  } finally { h.dispose(); }
});

test("five real failed collection audio units consume five slots and apply the existing brake", async () => {
  const h = await setup();
  try {
    h.reply(async (command, args) => { if (command === "prepare_audio") throw Error("fixture resolution failed"); return h.baseReply(command, args); });
    h.start(); await h.microtasks();
    assert.equal(h.units().length, 5);
    assert.equal(h.store.getState().playbackQueue.queue[0].collection?.playedCount, 5);
    assert.equal(h.store.getState().playbackRequest.consecutiveResolveFailures, 5);
    assert.match(h.doc.querySelector("#status")?.textContent ?? "", /多首无法播放，已停止/);
    assert.equal(h.store.getState().playbackQueue.history.length, 0);
  } finally { h.dispose(); }
});

test("collection resume restores the frozen member page position and round without a fresh list request", async () => {
  const first = await setup(4);
  let saved: CommandContract.PlaybackState | undefined;
  try {
    first.start(); await first.microtasks();
    await first.fire(first.audio, "ended"); await first.fire(first.audio, "ended");
    first.audio.currentTime = 17; first.core.savePlaybackState(); await first.microtasks();
    saved = first.calls.filter(call => call.command === "save_playback_state").at(-1)?.args.state as CommandContract.PlaybackState;
    assert.equal(saved.version, 2);
  } finally { first.dispose(); }
  const h = await setup(4);
  try {
    h.reply(async (command, args) => command === "get_playback_state" ? saved : h.baseReply(command, args));
    await h.core.restorePlaybackState();
    assert.equal(h.core.currentPlayableTrack()?.bvid, h.data.snapshot.items[1].bvid);
    await h.core.resumePendingPlayback(); await h.microtasks();
    assert.equal(h.core.currentPlayableTrack()?.bvid, h.data.snapshot.items[1].bvid);
    assert.equal(h.core.currentVideoPage()?.cid, 11);
    assert.equal(h.audio.currentTime, 17);
    assert.equal(h.store.getState().playbackQueue.queue[0].collection?.playedCount, 2);
    assert.equal(h.calls.filter(call => call.command === "get_collection_page").length, 0);
  } finally { h.dispose(); }
});
