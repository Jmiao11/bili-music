import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, fixture, responses, track, videoMeta } from "./library-lists-fixture.ts";

const history = () => [
  { ...track(1), lastPlayedAt: "1793232000000", count: 2, lastCid: 22, lastPage: 2, lastPartName: "第二P" },
  { ...track(2), lastPlayedAt: "1793145600000", count: 1, lastCid: null },
];
async function setup() {
  const h = await fixture({ playback: true });
  const base = responses();
  h.reply(async (command, args) => command === "get_play_history" ? history() : command === "check_audio_cache" ? [true] : base(command));
  h.store.actions.settings.navigate("recent"); await h.microtasks();
  const list = h.doc.querySelector<HTMLUListElement>("#recent-list")!;
  return { ...h, list, base };
}
test("recent page reuses rows, shows cached/offline state and clicks the list into the queue at the recorded part", async () => {
  const h = await setup();
  try {
    assert.equal(h.list.children.length, 2);
    assert.equal(h.doc.querySelector("#view-recent h1")?.textContent, "最近播放");
    assert.equal(h.doc.querySelector("#recent-list-columns .column-play > span")?.textContent, "播放时间");
    assert.equal(h.list.querySelectorAll('.track-cached[title="已缓存,可离线播放"]').length, 1);
    Object.defineProperty(h.window.navigator, "onLine", { configurable: true, value: false });
    await h.fire(h.window, "offline");
    assert.equal(h.list.children[0].classList.contains("needs-network"), false);
    assert.equal(h.list.children[1].classList.contains("needs-network"), true);
    assert.equal(h.list.children[1].getAttribute("title"), "需要联网");
    await h.fire(h.list.children[0].querySelector("button.track")!, "click", { detail: 0 });
    assert.equal(h.store.getState().playbackQueue.queueSource, "recent");
    assert.deepEqual(h.store.getState().playbackQueue.queue.map(row => row.bvid), history().map(row => row.bvid));
    assert.equal(h.calls.filter(call => call.command === "prepare_audio").at(-1)?.args.cacheCid, 22);
    const audio = h.doc.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { configurable: true, value: 60 });
    audio.currentTime = 31;
    await h.fire(audio, "timeupdate");
    const record = h.calls.filter(call => call.command === "record_play").at(-1)?.args;
    assert.equal(record?.lastCid, 22);
    assert.equal(record?.lastPage, 2);
    assert.equal(record?.lastPartName, "二");
    await h.fire(h.doc.querySelector("#previous-button")!, "click", { detail: 0 });
    assert.equal(h.calls.filter(call => call.command === "prepare_audio").at(-1)?.args.cacheCid, 11);
    h.reply(async command => command === "get_play_history" ? history() : command === "check_audio_cache" ? [false] : h.base(command));
    h.store.actions.settings.setAudioQuality("64k"); await h.microtasks();
    assert.equal(h.list.querySelectorAll(".track-cached").length, 0);
    assert.equal(h.list.querySelectorAll(".needs-network").length, 2);
    h.store.actions.settings.navigate("favorites");
    Object.defineProperty(h.window.navigator, "onLine", { configurable: true, value: true });
    await h.fire(h.window, "online");
    assert.equal(h.store.getState().recent.online, false);
    h.reply(async command => command === "get_play_history" ? [] : h.base(command));
    h.store.actions.settings.navigate("recent"); await h.microtasks();
    assert.equal(h.list.children.length, 0);
    assert.equal(h.doc.querySelector(".recent-empty")?.textContent, "还没有播放记录");
  } finally { h.dispose(); }
});
for (const fallback of ["disk", "known", "none"] as const) {
  test(`failed page request falls back through ${fallback} and passes the matching cacheCid`, async () => {
    const h = await setup();
    try {
      h.reply(async command => {
        if (command === "get_video_pages") throw Error("offline");
        if (command === "get_cached_video_pages") return fallback === "disk" ? { [track(1).bvid]: videoMeta } : {};
        return h.base(command);
      });
      if (fallback === "none") h.core.playListItem("favorites", [track(1)], 0);
      else await h.fire(h.list.children[0].querySelector("button.track")!, "click", { detail: 0 });
      await h.microtasks();
      const args = h.calls.filter(call => call.command === "prepare_audio").at(-1)?.args;
      assert.equal(args?.cacheCid, fallback === "none" ? null : 22);
      assert.equal(h.store.getState().playbackMessages.notice.text.includes("暂按单个视频播放"), fallback === "none");
    } finally { h.dispose(); }
  });
}

test("late disk fallback cannot overwrite pages or prepare audio for a new selection", async () => {
  const h = await setup(), gate = deferred();
  try {
    h.reply(async (command, args) => {
      if (command === "get_video_pages" && args.bvId === track(1).bvid) throw Error("offline");
      if (command === "get_cached_video_pages") return gate.promise;
      return h.base(command);
    });
    await h.fire(h.list.children[0].querySelector("button.track")!, "click", { detail: 0 });
    h.core.playListItem("favorites", [track(2)], 0); await h.microtasks();
    gate.resolve({ [track(1).bvid]: videoMeta }); await h.microtasks();
    assert.deepEqual(h.calls.filter(call => call.command === "prepare_audio").map(call => call.args.bvId), [track(2).bvid]);
    assert.equal(h.store.getState().playbackQueue.queue[0].bvid, track(2).bvid);
    assert.equal(h.store.getState().playbackSession.currentPages[0].cid, 11);
  } finally { h.dispose(); }
});
