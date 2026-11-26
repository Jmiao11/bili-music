import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fixture as realFixture, deferred } from "./tracks-fixture.ts";
import { nextDomEventTurn } from "./event-turn.ts";
const track = (index: number) => ({ bvid: "BV" + String(index).padStart(10, "0"), title: "曲目" + index, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, playCount: 1, pubdate: 1 });

type Snapshot = { results: ReturnType<typeof track>[]; requestVersion: number; page: number; isLoadingMore: boolean; hasMore: boolean; tids: number; sortMode: string; rerank: boolean; userKeyword: string; requestKeyword: string };

type FixtureNode = HTMLElement & { readonly children: HTMLCollectionOf<FixtureNode>; fire(type: string, detail?: unknown): Promise<void> };
async function fixture(saved = "", draft = "") {
  const h = await realFixture({ saved, draft, legacySortTabs: true, playback: true });
  const dispatch = async (target: EventTarget, type: string, detail?: unknown) => {
    if (type === "bilibili-music-viewchange") { target.dispatchEvent(new h.window.CustomEvent(type, { detail })); await h.microtasks(); }
    else await h.fire(target, type, type === "click" ? { detail: 0 } : {});
  };
  for (const node of [h.doc, h.window, h.window.HTMLElement.prototype]) Object.defineProperty(node, "fire", { configurable: true, value: function(this: EventTarget, type: string, detail?: unknown) { return dispatch(this, type, detail); } });
  const source = path.resolve(import.meta.dirname, "../../ui");
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, "platform/main-window-refs.ts"), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean);
  assert.ok(names);
  for (const name of ["features/library/library-ui.ts", "features/pages/video-pages.ts", "features/settings/appearance.ts", "features/playback/playback-notice.ts", "features/playback/playback-diagnostics.ts"]) {
    const exports = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, name), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean); assert.ok(exports);
  }
  const nodes = h.nodes as unknown as { [K in keyof typeof h.nodes]: typeof h.nodes[K] extends HTMLElement ? FixtureNode & Omit<typeof h.nodes[K], "children"> : typeof h.nodes[K] };
  return { ...h, nodes, musicTabs: h.nodes.musicTabs as unknown as FixtureNode[], sortModeTabs: h.nodes.sortModeTabs as unknown as FixtureNode[], windowNode: h.window as typeof h.window & FixtureNode, storage: { get: (key: string) => h.window.localStorage.getItem(key) },
    queueActions: h.store.actions.playbackQueue, get player() { return h.store.getState().playbackQueue; }, state: () => h.search.getSearchSnapshot(), flush: h.microtasks };
}

test("search navigation never requests on first entry or return with a restored keyword", async () => {
  const h = await fixture("  恢复词  "); try {
    assert.equal(h.nodes.searchKeyword.value, "恢复词");
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
    const navigate = (view: string) => h.fire(h.doc.querySelector(`#sidebar [data-view="${view}"]`)!, "click");
    await navigate("search");
    const firstVisit = h.calls.filter(x => x.command === "search_videos").length;
    assert.equal(h.calls.filter(x => x.command === "record_search_history").length, 0);
    await navigate("home"); await navigate("search");
    assert.equal(h.calls.filter(x => x.command === "search_videos").length - firstVisit, 0);
    assert.equal(firstVisit, 0);
    assert.equal(h.nodes.searchKeyword.value, "恢复词");
    await h.fire(h.nodes.searchForm, "submit");
    assert.equal(h.calls.find(x => x.command === "search_videos")?.args.keyword, "恢复词");
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 1);
  } finally { h.dispose(); }
});
test("search navigation stays passive with existing results and after a BV resets the results", async () => {
  const h = await fixture("恢复词"); try {
    h.store.actions.search.appendResults([track(1)]);
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
    h.store.actions.search.resetForBv();
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
  } finally { h.dispose(); }
});
test("search navigation stays passive while a user edits the restored draft", async () => {
  const h = await fixture("恢复词"); try {
    h.nodes.searchKeyword.value = "用户草稿";
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
    h.nodes.searchKeyword.value = "恢复词";
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
  } finally { h.dispose(); }
});
test("search navigation does not read the draft or start a request from reentrant draft access", async () => {
  const h = await fixture("恢复词"); try {
    let reads = 0;
    Object.defineProperty(h.nodes.searchKeyword, "value", { configurable: true, get() {
      if (reads++ === 0) void h.windowNode.fire("bilibili-music-viewchange", { view: "search" });
      return "恢复词";
    } });
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(reads, 0);
    assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
    assert.equal(h.calls.filter(x => x.command === "record_search_history").length, 0);
  } finally { h.dispose(); }
});
test("search restore does nothing without a saved keyword or when the startup draft already exists", async () => {
  for (const [saved, draft] of [["", ""], ["恢复词", "已有草稿"]]) {
    const h = await fixture(saved, draft); try {
      assert.equal(h.nodes.searchKeyword.value, draft);
      await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
      assert.equal(h.calls.filter(x => x.command === "search_videos").length, 0);
    } finally { h.dispose(); }
  }
});

function searchSidebar(h: Awaited<ReturnType<typeof realFixture>>, view = "search") {
  return h.doc.querySelector<HTMLButtonElement>(`#sidebar [data-view="${view}"]`)!;
}

function searchCalls(h: Awaited<ReturnType<typeof realFixture>>) {
  return h.calls.filter(call => call.command === "search_videos");
}

function savedSearch(savedAt: number): NonNullable<CommandContract.SavedSearchState["lastResult"]> {
  return { keyword: "合成前次", tids: 31, sortMode: "single", items: [track(1)], page: 3, hasMore: true, savedAt };
}

test("search history filters the focused draft and supports keyboard, delete, clear and click", async t => {
  const initial = ["夜曲", "海风", "夜航"].map((keyword, i) => ({ keyword, searchedAt: 100 - i }));
  const h = await realFixture({ playback: true, searchState: { version: 1, history: initial, lastResult: null } });
  t.after(h.dispose);
  let history = initial;
  h.reply(async (command, args) => {
    if (command === "search_videos") return [track(1)];
    if (command === "write_search_state") return history;
    if (command === "delete_search_state_history") return history = history.filter(item => item.keyword !== args.keyword);
    if (command === "clear_search_state_history") return history = [];
    return null;
  });
  await h.fire(searchSidebar(h), "click");
  const draft = h.nodes.searchKeyword;
  const displayed = () => [...h.doc.querySelectorAll(".search-history-keyword")].map(button => button.textContent);
  const focus = async () => { await nextDomEventTurn(); draft.focus(); await h.microtasks(); };
  await focus();
  assert.deepEqual(displayed(), ["夜曲", "海风", "夜航"]);
  draft.value = "夜"; await h.fire(draft, "input");
  assert.deepEqual(displayed(), ["夜曲", "夜航"]);
  await h.fire(draft, "keydown", { key: "ArrowDown" });
  assert.equal(h.doc.querySelector(".search-history-keyword[aria-selected=true]")?.textContent, "夜曲");
  await h.fire(draft, "keydown", { key: "ArrowUp" });
  assert.equal(h.doc.querySelector(".search-history-keyword[aria-selected=true]")?.textContent, "夜航");
  await h.fire(draft, "keydown", { key: "Enter" });
  assert.equal(draft.value, "夜航");
  assert.equal(searchCalls(h).length, 1);
  assert.equal(searchCalls(h)[0].args.keyword, "夜航");
  assert.equal(h.doc.querySelector(".search-history"), null);
  draft.value = ""; await h.fire(draft, "input");
  await h.fire(draft, "keydown", { key: "Escape" });
  assert.equal(h.doc.querySelector(".search-history"), null);
  await h.fire(draft, "input");
  await h.fire(h.doc.querySelector("#search-results")!, "click");
  assert.equal(h.doc.querySelector(".search-history"), null);
  await h.fire(draft, "input");
  await h.fire(h.doc.querySelector('[aria-label="删除历史 夜曲"]')!, "click");
  assert.deepEqual(displayed(), ["海风", "夜航"]);
  await h.fire(h.doc.querySelector(".search-history-keyword")!, "click");
  assert.equal(searchCalls(h).length, 2);
  assert.equal(searchCalls(h)[1].args.keyword, "海风");
  await h.fire(draft, "input");
  await h.fire(h.doc.querySelector(".search-history-clear")!, "click");
  assert.equal(h.doc.querySelector(".search-history"), null);
  assert.equal(h.calls.filter(call => call.command === "clear_search_state_history").length, 1);
});

test("search restart renders cached filters and rows with zero requests, then resumes its cursor", async t => {
  const saved = savedSearch(Date.now());
  const h = await realFixture({ playback: true, saved: "旧草稿", searchState: { version: 1, history: [], lastResult: saved } });
  t.after(h.dispose);
  h.reply(async (command, args) => command === "search_videos" ? (args.page === 4 ? [track(2)] : [track(10)]) : null);
  const list = h.nodes.searchResults;
  Object.defineProperties(list, { clientWidth: { value: 750 }, clientHeight: { value: 300 }, scrollHeight: { value: 1000 } });
  await h.fire(searchSidebar(h), "click");
  assert.equal(h.searchStateReads, 1);
  assert.equal(searchCalls(h).length, 0);
  assert.equal(h.nodes.searchKeyword.value, "合成前次");
  assert.equal(list.scrollTop, 0);
  assert.equal(list.querySelector(".track-title")?.textContent, "曲目1");
  assert.equal(h.doc.querySelector('[data-tids="31"]')?.getAttribute("aria-selected"), "true");
  assert.equal(h.doc.querySelector('[data-sort-mode="single"]')?.getAttribute("aria-selected"), "true");
  assert.match(h.doc.querySelector(".search-restored")?.textContent ?? "", /^上次搜索 · 今天 \d\d:\d\d$/);
  list.scrollTop = 690; await h.fire(list, "scroll");
  assert.deepEqual(searchCalls(h)[0].args, { keyword: "合成前次", tids: 31, sortMode: "single", page: 4, rerank: true, order: null });
  assert.deepEqual([...list.querySelectorAll(".track-title")].map(row => row.textContent), ["曲目1", "曲目2"]);
  assert.equal(h.calls.find(call => call.command === "write_search_state")?.args.page !== undefined, true);
  await h.fire(h.nodes.searchForm, "submit");
  assert.equal(h.doc.querySelector(".search-restored"), null);
  assert.equal(list.querySelector(".track-title")?.textContent, "曲目10");
  assert.equal(h.calls.filter(call => call.command === "get_search_state").length, 0);
});

test("clicking the active search sidebar refreshes once, resets scroll and throttles repeat requests", async t => {
  const h = await realFixture({ playback: true }); t.after(h.dispose);
  const pending = deferred();
  let hold = false;
  h.reply(async command => command === "search_videos" ? (hold ? pending.promise : [track(1)]) : null);
  const button = searchSidebar(h);
  await h.fire(button, "click");
  assert.equal(searchCalls(h).length, 0);
  h.nodes.searchKeyword.value = "";
  h.nodes.searchResults.scrollTop = 180;
  await h.fire(button, "click");
  assert.equal(h.nodes.searchResults.scrollTop, 0);
  assert.deepEqual(searchCalls(h)[0].args, { keyword: "音乐", tids: 3, page: 1, rerank: false, order: "click" });
  await h.advance(2999);
  await h.fire(button, "click");
  assert.equal(searchCalls(h).length, 1, "3 秒内再点请求 0 次");
  await h.advance(1);
  hold = true;
  await h.fire(button, "click", { detail: 0 });
  assert.equal(searchCalls(h).length, 2);
  await h.advance(5000);
  await h.fire(button, "click");
  assert.equal(searchCalls(h).length, 2, "进行中再次点击没有请求");
  pending.resolve([track(2)]); await h.microtasks();
  await h.fire(searchSidebar(h, "home"), "click");
  await h.fire(button, "click");
  assert.equal(searchCalls(h).length, 2);
});

test("failed, restricted and cancelled searches do not overwrite the saved last result", async t => {
  const saved = savedSearch(1700000000000);
  const h = await realFixture({ playback: true, searchState: { version: 1, history: [], lastResult: saved } });
  t.after(h.dispose);
  const pending = deferred();
  let disk: unknown = saved;
  h.reply(async (command, args) => {
    if (command === "write_search_state") { disk = args.page; return []; }
    if (command !== "search_videos") return null;
    if (args.keyword === "取消") return pending.promise;
    throw args.keyword === "受限" ? "SEARCH_TEMPORARILY_RESTRICTED" : "合成网络错误";
  });
  await h.search.runSearch({ userKeyword: "失败", recordHistory: true });
  assert.equal(disk, saved, "失败不覆盖");
  await h.search.runSearch({ userKeyword: "受限", recordHistory: true });
  assert.equal(disk, saved, "风控不覆盖");
  const cancelled = h.search.runSearch({ userKeyword: "取消", recordHistory: true });
  await h.search.runSearch({ userKeyword: "替换失败" });
  pending.resolve([track(9)]); await cancelled; await h.microtasks();
  assert.equal(disk, saved, "取消不覆盖");
  assert.equal(h.calls.filter(call => call.command === "record_search_history").length, 0);
});
