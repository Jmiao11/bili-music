import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/app-state.ts";
import { createMessagesFixture } from "./helpers/playback-messages-fixture.ts";
import { selectMiniPlayerMessages } from "../ui/playback-mini-view.ts";
import { createMiniHostFixture } from "./helpers/mini-host-fixture.ts";

const create = () => createApplicationStore({ invoke: async () => { throw Error("Unexpected command"); }, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
test("message actions preserve immutable snapshots and increment repeated writes", () => {
  const store = create(), first = store.getState(), seen: number[] = [];
  store.subscribe(state => seen.push(state.playbackMessages.statusVersion));
  store.actions.playbackMessages.setStatus("相同文字"); store.actions.playbackMessages.setStatus("相同文字");
  assert.deepEqual(seen, [1, 2]); assert.equal(first.playbackMessages.status, "");
  assert.equal(first.playbackQueue, store.getState().playbackQueue);
  assert.throws(() => { Object.assign(store.getState().playbackMessages, { status: "违规" }); }, TypeError);
});
test("message actions retain kind on clear and reject info without any commit", () => {
  const store = create(); store.actions.playbackMessages.showNotice("错误", "error");
  const before = store.getState(); assert.equal(store.actions.playbackMessages.showNotice("信息", "info"), false);
  assert.equal(store.getState(), before); store.actions.playbackMessages.clearNotice();
  assert.deepEqual(store.getState().playbackMessages.notice, { text: "", visible: false, kind: "error", version: 2 });
  store.actions.playbackMessages.clearNotice(); assert.equal(store.getState().playbackMessages.notice.version, 3);
});
test("library and pages commit their messages atomically with their own state", async () => {
  const store = create(), seen: string[] = [];
  store.subscribe(state => seen.push(state.playbackMessages.status));
  await store.actions.library.toggleFavorite(null);
  assert.deepEqual(seen, ["请先选择一首歌曲。"]);
  store.actions.pages.showSinglePage(); assert.deepEqual(seen, ["请先选择一首歌曲。", "该视频只有一个分P"]);
});
test("message fixture renders newer reentrant status instead of a stale notification", () => {
  const h = createMessagesFixture(store => store.subscribe(state => {
    if (state.playbackMessages.status === "先写") store.actions.playbackMessages.setStatus("后写");
  }));
  h.context.setPlaybackStatus("先写"); assert.equal(h.status.textContent, "后写");
  assert.equal(h.store.getState().playbackMessages.status, "后写");
});
test("message fixture uses actual actions and synchronous renderer before dispatch", () => {
  const h = createMessagesFixture(); h.show("新提示");
  assert.equal(h.store.getState().playbackMessages.notice.text, "新提示");
  assert.equal(h.events[0].text, "新提示"); h.context.setPlaybackStatus("新状态");
  assert.equal(h.status.textContent, "新状态");
  const projection = selectMiniPlayerMessages(h.store.getState());
  assert.deepEqual(projection, { status: "新状态", notice: "新提示" });
});
test("message status controller updates mini projection without publishing until an existing event", async () => {
  const h = await createMiniHostFixture(); await h.fire("mini-player-ready");
  h.context.setPlaybackStatus("新状态"); await h.flush();
  assert.equal(h.emissions.length, 1);
  await h.publishEvent("bilibili-music-trackchange");
  assert.equal(h.emissions.length, 2); assert.equal(h.emissions[1].payload.status, "新状态");
});
test("message mini projection excludes private request identities", () => {
  const store = create(); store.actions.playbackRequest.activateAudio(1, "private-request-sentinel", 123);
  store.actions.playbackMessages.setStatus("状态");
  assert.equal(JSON.stringify(selectMiniPlayerMessages(store.getState())).includes("private-request-sentinel"), false);
});
