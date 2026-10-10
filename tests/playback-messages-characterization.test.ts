import assert from "node:assert/strict";
import { test } from "node:test";
import { createMessagesFixture } from "./helpers/playback-messages-fixture.ts";
import { createMiniHostFixture } from "./helpers/mini-host-fixture.ts";

test("messages notice priority preserves errors while errors replace info", () => {
  const h = createMessagesFixture();
  h.show("提示", { kind: "info" }); assert.equal(h.playbackNotice.textContent, "提示");
  assert.equal([...h.timers.values()][0].delay, 2000);
  h.show("失败"); assert.equal(h.playbackNotice.textContent, "失败");
  assert.equal([...h.timers.values()][0].delay, 3200);
  const before = h.events.length; h.show("忽略", { kind: "info" });
  assert.equal(h.playbackNotice.textContent, "失败"); assert.equal(h.events.length, before);
  assert.equal(h.timers.size, 1);
});

test("messages persistent and replacement cancel old timers and natural expiry clears", () => {
  const h = createMessagesFixture(); h.show("短提示", { kind: "info" });
  h.show("长提示"); assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 3200);
  h.show("持续提示", { persistent: true }); assert.equal(h.timers.size, 0);
  h.expire(); assert.equal(h.playbackNotice.textContent, "持续提示");
  h.clear(); assert.equal(h.playbackNotice.textContent, "");
  h.show("到期", { kind: "info" }); h.expire();
  assert.equal(h.playbackNotice.textContent, ""); assert.equal(h.playbackNotice.classList.contains("is-visible"), false);
});

test("messages change listeners observe new DOM exactly once including repeated clear", () => {
  const h = createMessagesFixture(); h.show("新提示"); h.clear(); h.clear();
  assert.deepEqual(h.events, [
    { type: "bilibili-music-notice-change", text: "新提示", visible: true },
    { type: "bilibili-music-notice-change", text: "", visible: false },
    { type: "bilibili-music-notice-change", text: "", visible: false },
  ]);
});

test("messages notice change clears pasted pages only during resolve failures", () => {
  const h = createMessagesFixture(), pending = { bvid: "BV0000000001", requestVersion: 1 };
  h.store.actions.playbackSession.setPendingPastedPages(pending); h.show("提示");
  assert.deepEqual(h.store.getState().playbackSession.pendingPastedBvPages, pending);
  h.store.actions.playbackRequest.recordFailure(); h.clear();
  assert.equal(h.store.getState().playbackSession.pendingPastedBvPages, null);
});

test("messages library playback status writes only on version change with non-null text", async () => {
  const h = createMessagesFixture();
  await h.store.actions.library.toggleFavorite(null);
  assert.equal(h.status.textContent, "请先选择一首歌曲。");
  h.status.textContent = "其他写入方";
  h.store.actions.pages.query("BV0000000001", "queued", 0);
  assert.equal(h.status.textContent, "其他写入方");
  await h.store.actions.library.toggleFavorite(null);
  assert.equal(h.status.textContent, "请先选择一首歌曲。");
});

test("messages pages restore captured text even when another writer overwrites during query", () => {
  const h = createMessagesFixture(), video = { bvid: "BV0000000001", title: "曲目", uploader: "作者", thumbnailUrl: "", durationSeconds: 60 };
  h.status.textContent = "查询前";
  const version = h.store.actions.pages.beginModalQuery(h.status.textContent);
  assert.equal(h.status.textContent, "正在获取分P信息…");
  h.status.textContent = "查询期间";
  // src-tauri/src/guest_playurl.rs:45–51: VideoPage fields and durationSeconds.
  h.store.actions.pages.finishModalQuery(version, video, { videos: 2, pages: [
    { cid: 1, page: 1, part: "P1", durationSeconds: 30 }, { cid: 2, page: 2, part: "P2", durationSeconds: 30 },
  ] });
  assert.equal(h.status.textContent, "查询前");
});

test("messages alternating library and pages writers leave the last write visible", async () => {
  const h = createMessagesFixture();
  h.store.actions.pages.showSinglePage(); assert.equal(h.status.textContent, "该视频只有一个分P");
  await h.store.actions.library.toggleFavorite(null); assert.equal(h.status.textContent, "请先选择一首歌曲。");
  h.store.actions.pages.showSinglePage(); assert.equal(h.status.textContent, "该视频只有一个分P");
  await h.store.actions.library.toggleFavorite(null); assert.equal(h.status.textContent, "请先选择一首歌曲。");
});

test("messages mini reads last status and notice only on existing publication events", async () => {
  const h = await createMiniHostFixture(); await h.fire("mini-player-ready");
  h.node("#status").textContent = "第一次"; h.node("#status").textContent = "最后一次";
  h.node("#playback-notice").textContent = "边界提示"; await h.flush();
  assert.equal(h.emissions.length, 1);
  await h.publishEvent("bilibili-music-trackchange");
  assert.equal(h.emissions.length, 2); assert.equal(h.emissions[1].payload.status, "最后一次");
  assert.equal(h.emissions[1].payload.notice, "边界提示");
});
