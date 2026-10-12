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
