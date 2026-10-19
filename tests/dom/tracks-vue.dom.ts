import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fixture, seed, track, responses, deferred, videoMeta } from "./tracks-fixture.ts";

type Harness = Awaited<ReturnType<typeof fixture>>;
async function run(body: (h: Harness) => Promise<void>) { const h = await fixture(); try { await body(h); assert.equal(h.warnings.filter(args => String(args[0]).includes("Vue")).length, 0); } finally { h.dispose(); } }
const baseline: { matrix: { source: "ranking" | "recommendation" | "search"; state: string; html: string }[] } = JSON.parse(fs.readFileSync(new URL("../fixtures/vue/tracks-baseline.json", import.meta.url), "utf8"));
for (const entry of baseline.matrix) test(`Vue track HTML matches old ${entry.source} ${entry.state}`, () => run(async h => {
  const items = entry.state === "empty" ? [] : entry.state === "duplicate" ? [track(1), { ...track(1), title: "第二次出现" }] : [{ ...track(1), ...(entry.state === "cover" ? { thumbnailUrl: "https://example.invalid/cover.jpg" } : {}) }];
  if (entry.state === "unavailable") h.store.actions.library.markUnavailable(track(1).bvid, "该视频已被删除或设为私密");
  if (entry.state === "badge") h.store.actions.pages.remember(track(1).bvid, videoMeta);
  let list: HTMLElement;
  if (entry.state === "skeleton") { h.reply(() => new Promise(() => {})); h.home.setHomeMode("ranking"); list = h.nodes.homeRankingList!; }
  else list = await seed(h, entry.source, items);
  if (entry.state === "favorite") { h.reply(responses(items)); await h.store.actions.library.toggleFavorite(items[0]); h.core.updateQueueUi(); }
  if (entry.state === "playing") { h.store.actions.playbackQueue.replaceQueue(items, entry.source, entry.source === "search" ? h.search.getSearchSnapshot().requestVersion : null); h.store.actions.playbackQueue.selectIndex(0, false, null); h.core.updateQueueUi(); }
  assert.equal(list.innerHTML, entry.html);
  const anchors = [...list.childNodes].filter(node => node.nodeType === 3);
  assert.equal(anchors.length, entry.state === "empty" ? 0 : 2);
  assert.ok(anchors.every(node => node.textContent === ""));
}));

test("Vue track projections skip fifty unrelated store commits", () => run(async h => {
  await seed(h, "ranking"); await seed(h, "search"); h.regions.length = 0;
  let commits = 0; const unsubscribe = h.store.subscribe(() => commits++);
  for (let i = 0; i < 50; i++) h.store.actions.library.setModalName("无关" + i);
  unsubscribe(); assert.equal(commits, 50);
  assert.equal(h.regions.filter(record => record.operation === "update").length, 0);
}));

test("Vue search paging retains nodes focus observation and controller dataset", () => run(async h => {
  const batch = Array.from({ length: 20 }, (_, i) => track(i + 1));
  const list = await seed(h, "search", batch), row = list.children[0], button = row.querySelector<HTMLButtonElement>("button.track")!;
  await h.advance(0); button.focus(); assert.ok(h.observed.has(row)); assert.equal((row as HTMLElement).dataset.pageCountBvid, track(1).bvid);
  h.reply(responses([track(21)])); await h.search.loadMoreSearchResults();
  assert.equal(list.children[0], row); assert.equal(h.doc.activeElement, button); assert.ok(h.observed.has(row)); assert.equal(list.children.length, 21);
  h.store.actions.playbackQueue.replaceQueue(batch, "search", h.search.getSearchSnapshot().requestVersion); h.store.actions.playbackQueue.selectIndex(0, false, null);
  h.store.actions.pages.remember(track(1).bvid, videoMeta);
  assert.equal(list.children[0], row); assert.equal(button.getAttribute("aria-current"), "true"); assert.equal(row.querySelector(".page-count-badge")?.textContent, "2P");
  assert.equal((row as HTMLElement).dataset.pageCountBvid, track(1).bvid);
  assert.equal(h.doc.activeElement, button); assert.ok(h.observed.has(row));
}));

test("Vue search patches metadata and duplicate rows but replaces only committed queries", () => run(async h => {
  const list = await seed(h, "search", [track(1), { ...track(1), title: "重复" }]), rows = [...list.children];
  h.search.fillSearchMetadata(0, h.search.getSearchSnapshot().requestVersion, { ...track(1), title: "修补" }); h.search.renderSearchResults();
  assert.deepEqual([...list.children], rows); assert.equal(rows[0].querySelector(".track-title")?.textContent, "修补"); assert.equal(rows[1].querySelector(".track-title")?.textContent, "重复");
  const pending = deferred(); h.reply(() => pending.promise); const request = h.search.runSearch({ userKeyword: "另一次" });
  assert.deepEqual([...list.children], rows); pending.resolve([track(1), { ...track(1), title: "新重复" }]); await request;
  assert.notEqual(list.children[0], rows[0]); assert.notEqual(list.children[1], rows[1]); assert.equal(list.children.length, 2);
}));

test("Vue rows are excluded from legacy global DOM writes", () => run(async h => {
  const list = await seed(h, "search"), row = list.children[0];
  const observer = new h.window.MutationObserver(() => {}); observer.observe(row, { attributes: true, childList: true, subtree: true, characterData: true });
  h.core.updateQueueUi(); assert.equal(observer.takeRecords().length, 0);
  h.store.actions.pages.remember(track(1).bvid, videoMeta); await h.microtasks(); observer.takeRecords();
  h.core.updateQueueUi(); assert.equal(observer.takeRecords().length, 0); observer.disconnect();
}));

test("Vue list regions are lazy and empty lists unmount to preserve empty selectors", () => run(async h => {
  assert.equal(h.regions.length, 0); await seed(h, "search", []); assert.equal(h.regions.length, 0);
  const list = await seed(h, "search"); assert.equal(h.regions.filter(record => record.host === list && record.operation === "create").length, 1);
  await seed(h, "search", []); assert.equal(list.innerHTML, ""); assert.equal(list.matches(":empty"), true); assert.equal(h.regions.filter(record => record.host === list && record.operation === "unmount").length, 1);
}));

test("legacy and component activation sessions produce identical event sequences", () => run(async h => {
  type Selection = { startPage?: CommandContract.VideoPage; pages?: CommandContract.VideoPage[] };
  const pages = h.pages as typeof h.pages & { createTrackActivationSession(item: HTMLElement, button: HTMLButtonElement, video: ReturnType<typeof track>, play: (selection?: Selection) => void): { handleClick(event: MouseEvent): void; doubleClick(event: MouseEvent): void } };
  h.reply(responses());
  for (const sequence of [[1], [0], [1, 2, -1], [1, 0]]) {
    const outcomes: unknown[][] = [];
    for (const legacy of [true, false]) {
      const item = h.doc.createElement("li"), button = h.doc.createElement("button"); item.append(button); h.doc.body.append(item); const played: unknown[] = [];
      if (legacy) pages.bindTrackActivation(item, button, track(1), selection => played.push(selection ?? "play"));
      else { const session = pages.createTrackActivationSession(item, button, track(1), selection => played.push(selection ?? "play")); button.onclick = event => session.handleClick(event); item.ondblclick = event => session.doubleClick(event); }

      for (const detail of sequence) await h.fire(button, detail === -1 ? "dblclick" : "click", { detail: Math.abs(detail) });
      await h.advance(250); outcomes.push([played, !h.nodes.pagesModal.hidden]); h.store.actions.pages.close(); item.remove();
    }
    assert.deepEqual(outcomes[0], outcomes[1]);
  }
}));
import { execFileSync } from "node:child_process";
test("Vue track components retain registered props-only highlight and platform boundaries", () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, ["scripts/vue/check.ts"], { cwd: new URL("../..", import.meta.url), stdio: "pipe" }));
});

test("Vue duplicate BV rows retain independent playback indexes", () => run(async h => {
  const list = await seed(h, "search", [track(1), { ...track(1), title: "重复曲目" }]);
  await h.fire(list.children[0].querySelector("button.track")!, "click", { detail: 0 });
  assert.equal(h.store.getState().playbackQueue.currentIndex, 0);
  await h.fire(list.children[1].querySelector("button.track")!, "click", { detail: 0 });
  assert.equal(h.store.getState().playbackQueue.currentIndex, 1);
}));

test("multi-BV prompt waits for click, then paginates and plays through the existing queue", () => run(async h => {
  const bvid = "BV0000000001", items = Array.from({ length: 20 }, (_, index) => track(index + 1));
  h.reply(async (command, args) => {
    if (command === "get_video_meta") return { ...videoMeta, collection: { id: 42, title: "测试合集", total: 22 } };
    if (command === "get_collection_page") return args.page === 1 ? { items, total: 22, hasMore: true } : { items: [track(21), track(22)], total: 22, hasMore: false };
    return responses([track(1)])(command);
  });
  const draft = h.doc.querySelector<HTMLInputElement>("#search-keyword")!; draft.value = bvid;
  const previousList = h.doc.querySelector<HTMLElement>("#view-home .tracklist")!;
  Object.defineProperty(previousList, "scrollTo", { value: (options: ScrollToOptions) => { previousList.scrollTop = options.top ?? 0; } });
  previousList.scrollTop = 117;
  await h.fire(h.doc.querySelector("#search-form")!, "submit"); await h.microtasks();
  assert.match(h.doc.querySelector("#playback-notice")!.textContent ?? "", /共 22 个视频的合集「测试合集」/);
  assert.equal(h.calls.filter(call => call.command === "get_collection_page").length, 0);
  await h.fire(h.doc.querySelector("#playback-notice button")!, "click");
  assert.equal(h.doc.querySelector("#view-collection")!.hasAttribute("hidden"), false);
  assert.equal(h.doc.querySelectorAll("#collection-results li").length, 20);
  await h.fire(h.doc.querySelector("#collection-results")!, "scroll");
  assert.equal(h.doc.querySelectorAll("#collection-results li").length, 22);
  assert.match(h.doc.querySelector("#view-collection .search-status")!.textContent ?? "", /没有更多了/);
  await h.fire(h.doc.querySelector("#collection-results li button.track")!, "click", { detail: 0 });
  assert.equal(h.store.getState().playbackQueue.queueSource, "collection");
  assert.equal(h.store.getState().playbackQueue.queue.length, 22);
  assert.equal(h.doc.querySelector("#collection-results li button.track")?.getAttribute("aria-current"), "true");
  await h.fire(h.doc.querySelector("#view-collection .list-head button")!, "click");
  assert.equal(h.doc.querySelector("#view-collection"), null);
  assert.equal(h.doc.querySelector("#view-home")!.hasAttribute("hidden"), false);
  assert.equal(previousList.scrollTop, 117);
}));

test("ordinary BV has no collection prompt and stale collection requests cannot reopen a closed view", () => run(async h => {
  h.reply(async command => command === "get_video_meta" ? { ...videoMeta, collection: null } : responses([track(1)])(command));
  const draft = h.doc.querySelector<HTMLInputElement>("#search-keyword")!; draft.value = "BV0000000001";
  await h.fire(h.doc.querySelector("#search-form")!, "submit"); await h.microtasks();
  assert.equal(h.doc.querySelector("#playback-notice button"), null);
  const gate = deferred();
  h.reply(async (command) => command === "get_collection_page" ? gate.promise : responses([track(1)])(command));
  h.store.actions.collection.open({ kind: "collection", bvid: "BV0000000001", id: 42 }, "测试合集", 2, "search", 0);
  h.store.actions.collection.close(); gate.resolve({ items: [track(1)], total: 2, hasMore: false }); await h.microtasks();
  assert.equal(h.store.getState().collection.active, false);
  assert.equal(h.store.getState().collection.items.length, 0);
}));

test("collection list failure shows a manual retry without advancing the page", () => run(async h => {
  let attempts = 0;
  h.reply(async command => {
    if (command === "get_collection_page") {
      if (++attempts === 1) throw new Error("离线");
      return { items: [track(1)], total: 1, hasMore: false };
    }
    return responses([track(1)])(command);
  });
  h.store.actions.collection.open({ kind: "collection", bvid: "BV0000000001", id: 42 }, "测试合集", 1, "home", 0);
  await h.microtasks();
  assert.equal(h.store.getState().collection.page, 0);
  assert.match(h.doc.querySelector("#view-collection .search-status")!.textContent ?? "", /离线/);
  await h.fire(h.doc.querySelector("#view-collection > button")!, "click");
  assert.equal(attempts, 2);
  assert.equal(h.store.getState().collection.page, 1);
  assert.equal(h.doc.querySelectorAll("#collection-results li").length, 1);
}));
