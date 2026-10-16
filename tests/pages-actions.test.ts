import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/store/app-state.ts";
import type { HomeAdapter } from "../ui/store/app-state.ts";
const video = { bvid: "BV1234567890", title: "视频" };
const meta = { videos: 2, pages: [{ page: 1, cid: 11, part: "一", durationSeconds: 60 }, { page: 2, cid: 22, part: "二", durationSeconds: 90 }] };
function fixture() {
  const calls: { command: string; args: unknown }[] = [], reports: unknown[] = [];
  let reply: (command: string) => Promise<unknown> = async command => command === "list_disabled_pages" ? { BV1234567890: [11] } : [];
  const adapter: HomeAdapter = { invoke: ((command: string, args: unknown) => { calls.push({ command, args }); return reply(command); }) as HomeAdapter["invoke"], setTimeout: () => 0, clearTimeout() {}, report() {} };
  const store = createApplicationStore(adapter, { freeze: true, onSubscriberError: error => reports.push(error) });
  return { store, pages: store.actions.pages, library: store.actions.library, read: () => store.getState().pages, calls, reports, reply(next: typeof reply) { reply = next; } };
}
function gate() { let resolve!: (value: unknown) => void, reject!: (error: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("pages actions import without DOM normalize cached metadata and freeze retained snapshots", () => {
  assert.equal("document" in globalThis, false); assert.equal("window" in globalThis, false);
  const h = fixture(), before = h.store.getState(); h.pages.remember(video.bvid, meta); const cached = h.read();
  assert.equal(before.pages.videoPageCounts.size, 0); assert.equal(cached.videoPageCounts.get(video.bvid), 2); assert.equal(h.store.getState().library, before.library); assert.equal(h.store.getState().search, before.search); assert.equal(h.store.getState().home, before.home);
  assert.throws(() => (cached.videoPageCounts as Map<string, number>).set("bad", 1), TypeError);
  assert.throws(() => (cached.videoPagesByBvid.get(video.bvid)!.pages as unknown as { cid: number }[])[0].cid = 99, TypeError);
  h.pages.remember(video.bvid, { videos: 0, pages: [] }); assert.equal(h.read().videoPageCounts.get(video.bvid), 0); assert.equal(h.read().videoPagesByBvid.get(video.bvid)!.videos, 2); assert.equal(cached.videoPageCounts.get(video.bvid), 2);
});
test("pages actions keep query phases timestamps failure deduplication and single completion commits", () => {
  const h = fixture(); let commits = 0; h.store.subscribe(() => { commits++; });
  h.pages.query(video.bvid, "queued", 0); const queued = h.read(); h.pages.query(video.bvid, "active", 300); h.pages.dropQueued(video.bvid, 310);
  assert.equal(h.read().queries.get(video.bvid)?.phase, "active"); assert.equal(queued.queries.get(video.bvid)?.phase, "queued"); assert.equal(commits, 2);
  h.pages.finishLookup(video.bvid, meta, 600); assert.equal(commits, 3); assert.equal(h.read().queries.has(video.bvid), false); assert.equal(h.read().videoPageCounts.get(video.bvid), 2);
  h.pages.finishLookup("bad", null, 900); const failed = h.read(); h.pages.query("bad", null, 950); assert.deepEqual(h.read().queries.get("bad"), { phase: "failed", changedAt: 900 }); assert.equal(failed.queries.get("bad")?.phase, "failed");
});
test("pages modal actions discard stale queries and restore the first captured status in one phase", () => {
  const h = fixture(); const first = h.pages.beginModalQuery("最初"), second = h.pages.beginModalQuery("后来"); const before = h.read();
  h.pages.finishModalQuery(first, video, meta); assert.equal(h.read(), before); assert.equal(h.read().videoPageCounts.size, 0);
  let commits = 0; h.store.subscribe(() => { commits++; }); h.store.subscribe(() => { throw Error("subscriber"); });
  h.pages.finishModalQuery(second, video, meta); assert.equal(commits, 1); assert.equal(h.reports.length, 1); assert.equal(h.read().view.status?.text, "最初"); assert.equal(h.read().statusBeforeLoad, null); assert.equal(h.read().modal?.pages.length, 2);
  const opened = h.read(); h.pages.close(); assert.equal(h.read().modal, null); assert.equal(opened.modal?.video.title, "视频");
});
test("pages modal actions preserve failure and single page status and copy modal inputs", () => {
  const h = fixture(), first = h.pages.beginModalQuery("旧"); h.pages.finishModalQuery(first, video, null); assert.equal(h.read().view.status?.text, "获取分P信息失败");
  const second = h.pages.beginModalQuery("新"); h.pages.finishModalQuery(second, video, { videos: 1, pages: [meta.pages[0]] }); assert.equal(h.read().view.status?.text, "该视频只有一个分P"); assert.equal(h.read().modal, null);
  const input = { ...video }, pages = meta.pages.map(p => ({ ...p })); h.pages.open(input, 2, pages); input.title = "别名"; pages[0].part = "别名"; assert.equal(h.read().modal?.video.title, "视频"); assert.equal(h.read().modal?.pages[0].part, "一");
  h.pages.showSinglePage(); assert.equal(h.read().view.status?.text, "该视频只有一个分P");
});
test("library disabled preferences load and save without DOM with optimistic immutable rollback duplicate guard", async () => {
  const h = fixture(); await h.library.loadLibrary(); assert.equal(h.store.getState().library.disabledPages.get(video.bvid.toLowerCase())?.has(11), true);
  h.pages.open(video, 2, meta.pages); const before = h.store.getState(), pending = gate(); h.reply(() => pending.promise); let phases = 0; h.store.subscribe(() => { phases++; });
  const saving = h.library.changeDisabledPages(video.bvid, 22, true); const optimistic = h.store.getState();
  assert.equal(optimistic.library.disabledPages.get(video.bvid.toLowerCase())?.has(22), true); assert.equal(before.library.disabledPages.get(video.bvid.toLowerCase())?.has(22), false);
  assert.throws(() => (optimistic.library.disabledPages.get(video.bvid.toLowerCase()) as Set<number>).add(99), TypeError);
  await h.library.changeDisabledPages(video.bvid, null); assert.equal(h.calls.filter(c => c.command === "set_page_disabled").length, 1);
  pending.reject(Error("失败")); await saving; assert.equal(phases, 2); assert.equal(h.store.getState().library.disabledPages.get(video.bvid.toLowerCase())?.has(22), false); assert.equal(h.store.getState().library.disabledPagePending.size, 0); assert.match(h.read().modal!.error, /保存分P设置失败：.*失败/);
});
test("library restore all success failure and foreign modal isolate preferences and modal errors", async () => {
  const h = fixture(); await h.library.loadLibrary(); h.pages.open({ ...video, bvid: "BVother" }, 2, meta.pages);
  h.reply(async () => { throw Error("失败"); }); await h.library.changeDisabledPages(video.bvid, null); assert.equal(h.read().modal?.error, ""); assert.equal(h.store.getState().library.disabledPages.get(video.bvid.toLowerCase())?.has(11), true);
  h.reply(async () => []); await h.library.changeDisabledPages(video.bvid, null); assert.equal(h.store.getState().library.disabledPages.size, 0); assert.deepEqual(h.calls.at(-1), { command: "clear_disabled_pages", args: { bvid: video.bvid } });
});
test("library disabled preference read failures never write empty fallback", async () => {
  const h = fixture(); h.reply(async () => { throw Error("坏文件"); }); await h.library.loadLibrary(); assert.equal(h.store.getState().library.disabledPages.size, 0); assert.match(h.store.getState().library.loadError, /坏文件/); assert.deepEqual(h.calls.map(c => c.command), ["list_favorites", "list_playlists", "list_unavailable_tracks", "list_disabled_pages"]);
});