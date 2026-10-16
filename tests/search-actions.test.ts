import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/store/app-state.ts";
import type { HomeAdapter } from "../ui/store/app-state.ts";
import type { SearchSnapshot } from "../ui/features/search/search-state.ts";

const track = (index: number) => ({ bvid: `BV${String(index).padStart(10, "0")}`, title: `曲目${index}`, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, playCount: 0, pubdate: 0 });
const page = Array.from({ length: 20 }, (_, i) => track(i));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const calls: { command: string; args: unknown }[] = [];
  const reports: unknown[][] = [];
  let reply: (command: string) => Promise<unknown> = async () => page;
  const adapter: HomeAdapter = {
    invoke: ((command: string, args: unknown) => { calls.push({ command, args }); return reply(command); }) as HomeAdapter["invoke"],
    setTimeout: () => 0, clearTimeout() {}, report(...args) { reports.push(args); },
  };
  const store = createApplicationStore(adapter, { freeze: true, onSubscriberError: error => reports.push([error]) });
  return { store, actions: store.actions.search, read: () => store.getState().search, calls, reports, reply(next: typeof reply) { reply = next; } };
}

test("search actions run without DOM and publish complete immutable phases with home isolation", async () => {
  assert.equal("window" in globalThis, false);
  assert.equal("document" in globalThis, false);
  const h = fixture();
  const initial = h.store.getState();
  const phases: SearchSnapshot[] = [];
  h.store.subscribe(state => phases.push(state.search));
  h.store.subscribe(() => { throw new Error("listener failure"); });
  await h.actions.runSearch({ userKeyword: "  歌曲  " });
  assert.equal(phases.length, 2);
  assert.equal(phases[0].searchBusy, true);
  assert.equal(phases[0].view.buttonDisabled, true);
  assert.equal(phases[1].searchBusy, false);
  assert.equal(phases[1].view.buttonDisabled, false);
  assert.equal(phases[1].results.length, 20);
  assert.equal(initial.search.results.length, 0);
  assert.equal(phases[0].results.length, 0);
  assert.equal(h.store.getState().home, initial.home);
  assert.equal(h.reports.length, 2);
  assert.throws(() => { (phases[1].results as unknown as { title: string }[])[0].title = "修改"; }, TypeError);
  assert.throws(() => { (phases[1].results as unknown as unknown[]).push({}); }, TypeError);
});

test("search actions discard obsolete success failure and pagination after a new version", async () => {
  const h = fixture();
  const old = deferred<CommandContract.SearchVideo[]>();
  h.reply(() => old.promise);
  const pending = h.actions.runSearch({ userKeyword: "旧" });
  h.reply(async () => page);
  await h.actions.runSearch({ userKeyword: "新" });
  const current = h.read();
  old.resolve([track(100)]); await pending;
  assert.equal(h.read(), current);
  const late = deferred<CommandContract.SearchVideo[]>();
  h.reply(() => late.promise);
  const pagination = h.actions.loadMoreSearchResults(() => "新");
  h.reply(async () => [track(101)]);
  await h.actions.runSearch({ userKeyword: "下一次" });
  const next = h.read();
  late.reject(new Error("旧分页失败")); await pagination;
  assert.equal(h.read(), next);
  const failure = deferred<CommandContract.SearchVideo[]>();
  h.reply(() => failure.promise);
  const failing = h.actions.runSearch({ userKeyword: "失败" });
  const version = h.actions.resetForBv();
  assert.equal(h.read().requestVersion, version);
  assert.equal(h.read().searchBusy, false);
  const reset = h.read();
  failure.reject(new Error("迟到")); await failing;
  assert.equal(h.read(), reset);
});

test("search actions discard edited drafts and deduplicate pages before queue coordination", async () => {
  const h = fixture();
  await h.actions.runSearch({ userKeyword: "歌曲" });
  const first = h.read();
  h.reply(async () => [track(20)]);
  await h.actions.loadMoreSearchResults(() => "已修改");
  assert.equal(h.read().results, first.results);
  assert.equal(h.read().page, 1);
  assert.equal(h.read().isLoadingMore, false);
  h.reply(async () => [track(0), track(20), track(20), ...Array.from({ length: 17 }, () => track(1))]);
  const coordinated: string[][] = [];
  await h.actions.loadMoreSearchResults(() => "歌曲", (videos, completed) => {
    const unique = h.actions.appendResults(videos, entries => coordinated.push(entries.map(v => v.bvid)), completed);
    return unique.length;
  });
  assert.deepEqual(coordinated, [[track(20).bvid]]);
  assert.equal(h.read().results.length, 21);
  assert.equal(h.read().page, 2);
  assert.equal(h.read().hasMore, true);
  assert.equal(h.read().isLoadingMore, false);
  h.reply(async () => [track(20)]);
  await h.actions.loadMoreSearchResults(() => "歌曲");
  assert.equal(h.read().results.length, 21);
  assert.equal(h.read().hasMore, false);
  assert.equal(h.read().view.status, "没有更多了");
  assert.equal(first.results.length, 20);
});

test("search actions preserve division sorting reranking and hot query pagination parameters", async () => {
  const h = fixture();
  h.actions.chooseDivision(31);
  h.actions.chooseSort("click");
  await h.actions.runSearch({ userKeyword: "" });
  assert.deepEqual(h.calls[0].args, { keyword: "音乐", page: 1, tids: 31, rerank: false, order: "click" });
  await h.actions.loadMoreSearchResults(() => "");
  assert.deepEqual(h.calls[1].args, { keyword: "音乐", page: 2, tids: 31, order: "click", rerank: false });
  h.actions.chooseSort("click");
  assert.equal(h.read().sortMode, "all");
  await h.actions.runSearch({ userKeyword: "歌曲" });
  assert.deepEqual(h.calls[2].args, { keyword: "歌曲", page: 1, tids: 31, rerank: true, sortMode: "all" });
});

test("search actions record history without waiting and restore without recording or saving failures", async () => {
  const h = fixture();
  const history = deferred<unknown>();
  h.reply(command => command === "record_search_history" ? history.promise : Promise.resolve([track(1)]));
  const saved: string[] = [];
  await h.actions.runSearch({ userKeyword: "歌曲", recordHistory: true, saveKeyword: keyword => saved.push(keyword) });
  assert.equal(h.read().searchBusy, false);
  assert.deepEqual(h.calls.map(call => call.command), ["search_videos", "record_search_history"]);
  assert.deepEqual(saved, ["歌曲"]);
  history.reject(new Error("历史失败")); await Promise.resolve();
  assert.equal(h.reports.length, 1);
  await h.actions.runSearch({ userKeyword: "歌曲", restored: true, saveKeyword: keyword => saved.push(keyword) });
  assert.equal(h.calls.filter(call => call.command === "record_search_history").length, 1);
  assert.match(h.read().view.status ?? "", /复用上次搜索/);
  h.reply(async () => { throw new Error("请求失败"); });
  await h.actions.runSearch({ userKeyword: "不保存", saveKeyword: keyword => saved.push(keyword) });
  assert.deepEqual(saved, ["歌曲", "歌曲"]);
  assert.equal(h.read().view.status, "搜索失败：Error: 请求失败");
});

test("search metadata actions copy only the matching result and ignore stale source versions", async () => {
  const h = fixture();
  await h.actions.runSearch({ userKeyword: "歌曲" });
  const before = h.read();
  const metadata = { title: "新标题", uploader: "新作者", thumbnailUrl: "", durationSeconds: 90 };
  h.actions.updateMetadata(0, before.requestVersion - 1, metadata);
  assert.equal(h.read(), before);
  h.actions.updateMetadata(0, before.requestVersion, metadata);
  assert.equal(h.read().results[0].title, "新标题");
  assert.equal(before.results[0].title, "曲目0");
  assert.equal(h.read().results[1], before.results[1]);
  assert.equal(h.read().view, before.view);
  h.actions.refreshResults();
  assert.notEqual(h.read().view.rowsVersion, before.view.rowsVersion);
});

test("search busy actions preserve last writer button behavior across search and BV preparation", async () => {
  const h = fixture();
  const response = deferred<CommandContract.SearchVideo[]>();
  h.reply(() => response.promise);
  const pending = h.actions.runSearch({ userKeyword: "歌曲" });
  h.actions.setPlaybackBusy(true);
  assert.equal(h.read().playbackBusy, true);
  assert.equal(h.read().view.buttonSource, "playback");
  response.resolve([track(1)]); await pending;
  assert.equal(h.read().playbackBusy, true);
  assert.equal(h.read().view.buttonDisabled, false);
  assert.equal(h.read().view.buttonSource, "search");
  h.actions.setPlaybackBusy(true);
  assert.equal(h.read().view.buttonDisabled, true);
  h.actions.setPlaybackBusy(false);
  assert.equal(h.read().view.buttonDisabled, false);
});
