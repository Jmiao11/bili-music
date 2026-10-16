import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fixture as realFixture, deferred } from "./tracks-fixture.ts";
const track = (index: number) => ({ bvid: "BV" + String(index).padStart(10, "0"), title: "曲目" + index, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, playCount: 1, pubdate: 1 });
const batch = (start = 1) => Array.from({ length: 20 }, (_, i) => track(start + i));
type Snapshot = { results: ReturnType<typeof track>[]; requestVersion: number; page: number; isLoadingMore: boolean; hasMore: boolean; tids: number; sortMode: string; rerank: boolean; userKeyword: string; requestKeyword: string };

type FixtureNode = HTMLElement & { readonly children: HTMLCollectionOf<FixtureNode>; fire(type: string, detail?: unknown): Promise<void> };
async function fixture(saved = "", draft = "") {
  const h = await realFixture({ saved, draft, legacySortTabs: true });
  const dispatch = async (target: EventTarget, type: string, detail?: unknown) => {
    if (type === "bilibili-music-viewchange") { target.dispatchEvent(new h.window.CustomEvent(type, { detail })); await h.microtasks(); }
    else await h.fire(target, type, type === "click" ? { detail: 0 } : {});
  };
  for (const node of [h.doc, h.window, h.window.HTMLElement.prototype]) Object.defineProperty(node, "fire", { configurable: true, value: function(this: EventTarget, type: string, detail?: unknown) { return dispatch(this, type, detail); } });
  const source = path.resolve(import.meta.dirname, "../../ui");
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, "platform/main-window-dom.ts"), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean);
  assert.ok(names);
  for (const name of ["features/library/library-ui.ts", "features/pages/video-pages.ts", "features/settings/appearance.ts", "features/playback/playback-notice.ts", "features/playback/playback-diagnostics.ts"]) {
    const exports = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, name), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean); assert.ok(exports);
  }
  const nodes = h.nodes as unknown as { [K in keyof typeof h.nodes]: typeof h.nodes[K] extends HTMLElement ? FixtureNode & Omit<typeof h.nodes[K], "children"> : typeof h.nodes[K] };
  return { ...h, nodes, musicTabs: h.nodes.musicTabs as unknown as FixtureNode[], sortModeTabs: h.nodes.sortModeTabs as unknown as FixtureNode[], windowNode: h.window as typeof h.window & FixtureNode, storage: { get: (key: string) => h.window.localStorage.getItem(key) },
    queueActions: h.store.actions.playbackQueue, get player() { return h.store.getState().playbackQueue; }, state: () => h.search.getSearchSnapshot(), flush: h.microtasks };
}

test("search ignores late old search success and failure while retaining the latest button state", async () => {
  const h = await fixture(); try {
    const old = deferred(); const current = deferred(); h.reply((_c, args) => args.keyword === "旧" ? old.promise : current.promise);
    const p = h.search.runSearch({ userKeyword: "旧" }); const q = h.search.runSearch({ userKeyword: "新" });
    old.resolve([track(1)]); await p; assert.equal(h.nodes.searchButton.disabled, true); assert.equal(h.state().results.length, 0);
    current.resolve([track(2)]); await q; assert.equal(h.state().results[0].bvid, track(2).bvid); assert.equal(h.nodes.searchButton.disabled, false);
    const failed = deferred(); h.reply((_c, args) => args.keyword === "坏" ? failed.promise : Promise.resolve([track(3)]));
    const r = h.search.runSearch({ userKeyword: "坏" }); await h.search.runSearch({ userKeyword: "好" }); failed.reject(new Error("late")); await r;
    assert.equal(h.state().results[0].bvid, track(3).bvid); assert.doesNotMatch(h.nodes.searchStatus.textContent, /late/);
  } finally { h.dispose(); }
});

test("search discards late pagination and edited draft results without changing the current list", async () => {
  const h = await fixture(); try {
    h.nodes.searchKeyword.value = "甲"; h.reply(async () => batch()); await h.search.runSearch();
    const old = deferred(); h.reply(() => old.promise); const p = h.search.loadMoreSearchResults();
    h.reply(async () => [track(50)]); await h.search.runSearch({ userKeyword: "乙" }); old.resolve(batch(21)); await p;
    assert.equal(h.state().results.length, 1); assert.equal(h.state().results[0].bvid, track(50).bvid);
    h.nodes.searchKeyword.value = "甲"; h.reply(async () => batch()); await h.search.runSearch();
    const draft = deferred(); h.reply(() => draft.promise); const q = h.search.loadMoreSearchResults(); h.nodes.searchKeyword.value = "草稿"; draft.resolve(batch(21)); await q;
    assert.equal(h.state().results.length, 20); assert.equal(h.state().page, 1); assert.equal(h.state().isLoadingMore, false);
  } finally { h.dispose(); }
});

test("search deduplicates pagination and extends only the queue with its matching source version", async () => {
  const h = await fixture(); try {
    h.nodes.searchKeyword.value = "甲"; h.reply(async () => batch()); await h.search.runSearch();
    h.queueActions.replaceQueue([track(1)], "search", h.state().requestVersion); h.queueActions.selectIndex(0, false, null); h.queueActions.changeShuffle(true, Math.random);
    h.reply(async () => [track(1), track(21), track(21), ...batch(22)]); await h.search.loadMoreSearchResults();
    assert.equal(h.state().results.length, 41); assert.equal(h.player.queue.length, 22); assert.equal(h.player.randomRemaining.length, 21);
    h.queueActions.replaceQueue(h.player.queue, "search", -1); h.reply(async () => batch(80)); await h.search.loadMoreSearchResults(); assert.equal(h.player.queue.length, 22);
    h.reply(async () => [track(1), track(1)]); await h.search.loadMoreSearchResults(); assert.equal(h.state().hasMore, false); assert.equal(h.nodes.searchStatus.textContent, "没有更多了");
  } finally { h.dispose(); }
});

test("search division and sort clicks preserve hot versus keyword reranking parameters and draft", async () => {
  const h = await fixture(); try {
    h.reply(async () => [track(1)]); await h.musicTabs[1].fire("click"); await h.flush();
    let request = h.calls.filter(c => c.command === "search_videos").at(-1)!;
    assert.deepEqual(request.args, { keyword: "音乐", page: 1, tids: 28, rerank: false, order: "click" }); assert.equal(h.nodes.searchKeyword.value, "");
    assert.equal(h.calls.some(c => c.command === "record_search_history"), false);
    h.nodes.searchKeyword.value = " 输入 "; await h.musicTabs[2].fire("click"); await h.flush(); await h.sortModeTabs[1].fire("click"); await h.flush();
    request = h.calls.filter(c => c.command === "search_videos").at(-1)!; assert.deepEqual(request.args, { keyword: "输入", page: 1, tids: 31, rerank: true, sortMode: "title" });
    await h.sortModeTabs[1].fire("click"); await h.flush(); assert.equal(h.state().sortMode, "all"); assert.equal(h.nodes.searchKeyword.value, " 输入 ");
  } finally { h.dispose(); }
});

test("search history is fire and forget and restored search skips history while persisting only success", async () => {
  const h = await fixture("  上次  "); try {
    assert.equal(h.nodes.searchKeyword.value, "上次"); assert.equal(h.search.readLastSearchKeyword(), "上次");
    h.reply(async command => command === "record_search_history" ? new Promise(() => {}) : [track(1)]);
    await h.windowNode.fire("bilibili-music-viewchange", { view: "search" }); await h.flush();
    assert.equal(h.calls.some(c => c.command === "record_search_history"), false); assert.match(h.nodes.searchStatus.textContent, /已复用上次搜索关键词「上次」刷新完成/);
    await h.search.runSearch({ userKeyword: "新", recordHistory: true }); assert.equal(h.nodes.searchButton.disabled, false); assert.equal(h.storage.get("bilibili-music.last-search"), "新");
    assert.equal(h.calls.filter(c => c.command === "record_search_history").length, 1);
    h.reply(async () => { throw new Error("failed"); }); await h.search.runSearch({ userKeyword: "失败" }); assert.equal(h.storage.get("bilibili-music.last-search"), "新");
  } finally { h.dispose(); }
});

test("search BV submit races discard the cancelled paste and preserve last-writer busy button semantics", async () => {
  const h = await fixture(); try {
    const cancel = deferred(); const search = deferred(); const prepare = deferred();
    h.reply(async command => command === "cancel_prepare_audio" ? cancel.promise : command === "search_videos" ? search.promise : command === "prepare_audio" ? prepare.promise : [{ page: 1, cid: 1, part: "P1", durationSeconds: 60 }]);
    h.nodes.searchKeyword.value = track(7).bvid; const paste = h.nodes.searchForm.fire("submit");
    h.nodes.searchKeyword.value = "新搜索"; const p = h.search.runSearch(); cancel.resolve(null); await paste;
    assert.equal(h.calls.some(c => c.command === "prepare_audio"), false); search.resolve([track(8)]); await p;
    assert.equal(h.state().results[0].bvid, track(8).bvid);
    h.nodes.searchKeyword.value = track(9).bvid; await h.nodes.searchForm.fire("submit"); await h.flush();
    assert.equal(h.state().results.length, 0); assert.equal(h.nodes.searchButton.disabled, true); assert.match(h.nodes.searchStatus.textContent, /已识别 BV 号/);
    h.reply(async command => command === "search_videos" ? [track(10)] : []); await h.search.runSearch({ userKeyword: "并行搜索" });
    assert.equal(h.nodes.searchButton.disabled, false, "search completion enables the shared button even while BV prepare is pending");
    prepare.resolve({ audioUrl: "http://127.0.0.1/audio/fixture", title: "播放", uploader: "作者", thumbnailUrl: "", durationSeconds: 90 }); await h.flush(); assert.equal(h.nodes.searchButton.disabled, false);
  } finally { h.dispose(); }
});

test("search playback metadata fills the display and queue consistently without rewriting the keyword", async () => {
  const h = await fixture(); try {
    const prepare = deferred(); h.nodes.searchKeyword.value = "搜索原值";
    h.reply(async command => command === "search_videos" ? [track(1)] : command === "prepare_audio" ? prepare.promise : [{ page: 1, cid: 1, part: "P1", durationSeconds: 60 }]);
    await h.search.runSearch(); const row = h.nodes.searchResults.children[0]; await row.children[0].fire("click"); await h.flush();
    assert.equal(h.nodes.searchButton.disabled, true);
    prepare.resolve({ audioUrl: "http://127.0.0.1/audio/fixture", title: "回填", uploader: "新作者", thumbnailUrl: "", durationSeconds: 90 }); await h.flush();
    assert.equal(h.state().results[0].title, "回填"); assert.equal(h.player.queue[0].title, "回填"); assert.equal(h.state().results[0].durationSeconds, 90);
    assert.equal(h.nodes.searchResults.children[0].children[0].children[2].children[0].textContent, "回填");
    assert.equal(h.nodes.searchKeyword.value, "搜索原值"); assert.equal(h.nodes.searchButton.disabled, false);
  } finally { h.dispose(); }
});
