import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fixture as realFixture, deferred } from "./tracks-fixture.ts";
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
