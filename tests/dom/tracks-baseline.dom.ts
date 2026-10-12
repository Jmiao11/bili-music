import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, deferred, track, responses, seed, videoMeta } from "./tracks-fixture.ts";

async function run(body: (h: Awaited<ReturnType<typeof fixture>>) => Promise<void>) { const h = await fixture(); try { await body(h); assert.equal(h.warnings.filter(args => String(args[0]).includes("Vue")).length, 0); } finally { h.dispose(); } }
for (const source of ["ranking", "recommendation", "search"] as const) {
  test(`track DOM ${source} row structure retains handles cover metadata and actions`, () => run(async h => {
    const list = await seed(h, source, [{ ...track(1), thumbnailUrl: "https://example.invalid/cover.jpg", title: "曲目<&>" }]);
    const row = list.children[0], button = row.querySelector("button.track")!;
    assert.equal(row.tagName, "LI"); assert.equal(row.className, "track-row");
    assert.equal(button.getAttribute("type"), "button"); assert.equal(button.getAttribute(source === "search" ? "data-result-index" : "data-library-index"), "0");
    assert.equal(button.getAttribute("data-bvid"), track(1).bvid);
    assert.equal(row.querySelector(".track-title")?.textContent, "曲目<&>");
    assert.equal(row.querySelector(".eq")?.getAttribute("aria-hidden"), "true"); assert.equal(row.querySelector(".eq")?.children.length, 3);
    assert.equal(row.querySelector("img")?.referrerPolicy, "no-referrer");
    assert.equal(row.querySelector(".track-up")?.textContent, "作者"); assert.equal(row.querySelector(".track-play")?.textContent, "1");
    assert.equal(row.querySelector(".track-duration")?.textContent, "1:00"); assert.equal(row.querySelectorAll(".track-actions button").length, 2);
    assert.equal(row.querySelectorAll(".track-pubdate").length, source === "search" ? 1 : 0);
  }));
  test(`track DOM ${source} highlight uses existing source and search version conditions`, () => run(async h => {
    const list = await seed(h, source, [track(1), track(2)]);
    h.store.actions.playbackQueue.replaceQueue([track(1), track(2)], source, source === "search" ? h.search.getSearchSnapshot().requestVersion : null);
    h.store.actions.playbackQueue.selectIndex(1, false, null); h.core.updateQueueUi();
    assert.equal(list.querySelectorAll('[aria-current="true"]').length, 1); assert.equal(list.children[1].querySelector("button.track")?.getAttribute("aria-current"), "true");
    h.store.actions.playbackQueue.replaceQueue([track(1), track(2)], source === "search" ? "search" : "favorites", -1); h.core.updateQueueUi();
    assert.equal(list.querySelectorAll('[aria-current="true"]').length, 0);
  }));
}
test("track DOM favorite state patches existing home and search buttons", () => run(async h => {
  const home = await seed(h, "ranking"), search = await seed(h, "search");
  await h.fire(home.querySelector(".favorite-button")!, "click", { detail: 1 });
  for (const list of [home, search]) { const button = list.querySelector(".favorite-button")!; assert.equal(button.textContent, "♥"); assert.equal(button.getAttribute("aria-label"), "取消收藏"); assert.equal(button.classList.contains("is-favorited"), true); }
}));
test("track DOM unavailable markers retain old home commit timing and search absence", () => run(async h => {
  const home = await seed(h, "ranking"), row = home.children[0];
  h.store.actions.library.markUnavailable(track(1).bvid, "该视频已被删除或设为私密");
  assert.equal(home.children[0], row); assert.equal(row.querySelector(".track-unavailable"), null);
  await h.home.loadHomeRanking({ forceRefresh: true });
  assert.equal(home.children[0].classList.contains("is-unavailable"), true); assert.equal(home.querySelector(".track-unavailable")?.getAttribute("aria-label"), "该视频已被删除或设为私密");
  const search = await seed(h, "search"); assert.equal(search.querySelector(".track-unavailable"), null);
}));
test("track DOM badges patch counts and preserve order before favorite and add", () => run(async h => {
  const home = await seed(h, "ranking"), search = await seed(h, "search");
  h.store.actions.pages.remember(track(1).bvid, videoMeta);
  for (const list of [home, search]) { const actions = list.querySelector(".track-actions")!; assert.equal(actions.firstElementChild?.className, "page-count-badge"); assert.equal(actions.firstElementChild?.textContent, "2P"); assert.equal(actions.firstElementChild?.getAttribute("aria-label"), "查看 2 个分P"); }
}));
test("track DOM home loading displays eight skeleton rows", () => run(async h => {
  const pending = deferred(); h.reply(() => pending.promise); h.home.setHomeMode("ranking");
  assert.equal(h.nodes.homeRankingList?.children.length, 8); assert.equal(h.nodes.homeRankingList?.querySelectorAll("li.skeleton-row").length, 8);
  pending.resolve([]); await h.microtasks(); assert.equal(h.nodes.homeRankingList?.children.length, 0);
}));
test("track DOM empty home and search lists remain empty hosts", () => run(async h => {
  for (const source of ["ranking", "recommendation", "search"] as const) { const list = await seed(h, source, []); assert.equal(list.innerHTML, ""); assert.equal(list.matches(":empty"), true); }
}));
test("track DOM ranking error retry remains outside the list", () => run(async h => {
  h.reply(async () => { throw Error("fixture ranking failure"); }); h.home.setHomeMode("ranking"); await h.microtasks();
  assert.equal(h.nodes.homeRankingError.textContent, "拉取失败，点击重试"); assert.equal(h.nodes.homeRankingList?.children.length, 0);
  h.reply(responses()); await h.fire(h.nodes.homeRankingError, "click"); assert.equal(h.nodes.homeRankingList?.children.length, 1);
}));
test("track DOM search no-more status remains outside result rows", () => run(async h => {
  const list = await seed(h, "search"); assert.match(h.nodes.searchStatus.textContent, /没有更多了/); assert.equal(list.querySelectorAll("li").length, 1); assert.equal(list.textContent?.includes("没有更多了"), false);
}));
test("track DOM single click waits exactly 250 milliseconds", () => run(async h => {
  const list = await seed(h, "search"); await h.fire(list.querySelector("button.track")!, "click", { detail: 1 });
  await h.advance(249); assert.equal(h.calls.filter(call => call.command === "prepare_audio").length, 0);
  await h.advance(1); assert.equal(h.calls.filter(call => call.command === "prepare_audio").length, 1);
}));
test("track DOM double click cancels playback and opens the pages modal", () => run(async h => {
  const list = await seed(h, "search"), button = list.querySelector("button.track")!;
  await h.fire(button, "click", { detail: 1 }); await h.fire(button, "click", { detail: 2 }); await h.fire(button, "dblclick", { detail: 2 }); await h.advance(250);
  assert.equal(h.calls.filter(call => call.command === "prepare_audio").length, 0); assert.equal(h.calls.filter(call => call.command === "get_video_meta").length, 1); assert.equal(h.nodes.pagesModal.hidden, false);
}));
test("track DOM keyboard detail-zero click plays immediately", () => run(async h => {
  const list = await seed(h, "search"); await h.fire(list.querySelector("button.track")!, "click", { detail: 0 }); assert.equal(h.calls.filter(call => call.command === "prepare_audio").length, 1);
}));
for (const action of ["add", "favorite", "badge"] as const) test(`track DOM ${action} single click does not bubble or play`, () => run(async h => {
  const list = await seed(h, "search"); if (action === "badge") h.store.actions.pages.remember(track(1).bvid, videoMeta);
  const actions = list.querySelector(".track-actions")!, button = action === "add" ? actions.lastElementChild! : actions.querySelector(action === "favorite" ? ".favorite-button" : ".page-count-badge")!;
  let bubbled = 0; h.window.addEventListener("click", () => bubbled++);
  await h.fire(button, "click", { detail: 1 }); await h.advance(250);
  assert.equal(bubbled, 0); assert.equal(h.calls.filter(call => call.command === "prepare_audio").length, 0);
  if (action === "badge") assert.equal(h.nodes.pagesModal.hidden, false);
  if (action === "add") assert.equal(h.store.getState().library.session.kind, "choose");
}));
test("track DOM action double clicks do not open pages", () => run(async h => {
  const list = await seed(h, "search"); h.store.actions.pages.remember(track(1).bvid, videoMeta);
  for (const button of list.querySelectorAll(".track-actions button")) { const before = h.calls.filter(call => call.command === "get_video_meta").length; await h.fire(button, "dblclick", { detail: 2 }); assert.equal(h.calls.filter(call => call.command === "get_video_meta").length, before); }
}));
test("track DOM duplicate exact BV results remain separate rows", () => run(async h => {
  const list = await seed(h, "search", [track(1), { ...track(1), title: "第二次出现" }]); assert.equal(list.children.length, 2); assert.equal(list.children[1].querySelector(".track-title")?.textContent, "第二次出现"); assert.notEqual(list.children[0], list.children[1]);
}));
test("track DOM search metadata refresh changes text without writing the keyword", () => run(async h => {
  const list = await seed(h, "search"); h.search.fillSearchMetadata(0, h.search.getSearchSnapshot().requestVersion, { ...track(1), title: "新标题" }); h.search.renderSearchResults(); assert.equal(list.querySelector(".track-title")?.textContent, "新标题"); assert.equal(h.nodes.searchKeyword.value, "测试");
}));
test("track DOM new search retains displayed rows while awaiting its result", () => run(async h => {
  const list = await seed(h, "search"), row = list.children[0], pending = deferred(); h.reply(() => pending.promise); const request = h.search.runSearch({ userKeyword: "新查询" }); assert.equal(list.children[0], row); pending.resolve([track(2)]); await request; assert.equal(list.querySelector(".track-title")?.textContent, "曲目2");
}));
test("track DOM detached row keeps its already scheduled playback timer", () => run(async h => {
  const list = await seed(h, "search"); await h.fire(list.querySelector("button.track")!, "click", { detail: 1 }); await seed(h, "search", [track(2)]); await h.advance(250); assert.equal(h.calls.filter(call => call.command === "prepare_audio").length, 1);
}));

