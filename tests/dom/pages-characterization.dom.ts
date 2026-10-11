import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture as domFixture, deferred, track, meta } from "./pages-fixture.ts";

interface LibraryNode extends HTMLElement {
  textContent: string;
  disabled: boolean;
  readonly children: HTMLCollectionOf<LibraryNode>;
  querySelector<E extends Element = LibraryNode>(selector: string): E | null;
  querySelectorAll<E extends Element = LibraryNode>(selector: string): NodeListOf<E>;
  fire(type: string, fields?: { detail?: number; key?: string; shiftKey?: boolean }): Promise<Event>;
}
async function fixture() {
  const h = await domFixture();
  return { ...h,
    nodes: h.nodes as unknown as Record<string, LibraryNode>,
    row: h.row as unknown as (i: number, played?: unknown[]) => { item: LibraryNode; button: LibraryNode; actions: LibraryNode; played: unknown[] },
  };
}

test("pages visible queries keep concurrency two interval 300ms and deduplicate failures", async () => {
  const h = await fixture(); try {
    const a = h.row(1), b = h.row(2), c = h.row(3), gates = [deferred(), deferred(), deferred()]; let index = 0;
    h.reply(async command => command === "get_cached_video_pages" ? {} : gates[index++].promise); await h.advance(0);
    assert.equal(h.observed.size, 3); assert.equal(h.calls.filter(c => c.command === "get_video_meta").length, 0);
    h.visible(a.item); h.visible(b.item); h.visible(c.item); await h.advance(299); assert.equal(index, 1);
    await h.advance(1); assert.equal(index, 2); await h.advance(600); assert.equal(index, 2);
    gates[0].reject(Error("失败")); await h.flush(); assert.equal(index, 3); assert.deepEqual(h.calls.filter(c => c.command === "get_video_meta").map(c => c.at), [0, 300, 900]);
    h.visible(a.item); await h.advance(300); assert.equal(index, 3); assert.equal(h.observed.has(a.item), false);
    gates[1].resolve(meta); gates[2].resolve(meta); await h.flush(); assert.equal(b.actions.children[0].textContent, "2P");
  } finally { h.dispose(); }
});
test("pages cached metadata precedes visibility lookup and opens without another request", async () => {
  const h = await fixture(); try {
    h.reply(async command => command === "get_cached_video_pages" ? { [track(1).bvid]: meta } : []); const row = h.row(1); await h.advance(0);
    assert.equal(h.observed.size, 0); assert.equal(row.actions.children[0].textContent, "2P"); await row.actions.children[0].fire("click"); await h.flush();
    assert.equal(h.calls.filter(c => c.command === "get_video_meta").length, 0); assert.equal(h.nodes.pagesModalList.children.length, 2); assert.equal(h.nodes.pagesModal.hidden, false);
  } finally { h.dispose(); }
});
test("pages visibility lost before scheduled lookup prevents querying hidden row", async () => {
  const h = await fixture(); try {
    const a = h.row(1), b = h.row(2); const gate = deferred(); h.reply(async command => command === "get_cached_video_pages" ? {} : gate.promise); await h.advance(0);
    h.visible(a.item); h.visible(b.item); h.visible(b.item, false); await h.advance(300); assert.equal(h.calls.filter(c => c.command === "get_video_meta").length, 1); gate.resolve(meta); await h.flush();
  } finally { h.dispose(); }
});
test("pages single click delays 250ms double click cancels play and keyboard click plays immediately", async () => {
  const h = await fixture(); try {
    h.reply(async command => command === "get_cached_video_pages" ? {} : meta); const row = h.row(1);
    await row.button.fire("click", { detail: 1 }); await h.advance(249); assert.equal(row.played.length, 0); await h.advance(1); assert.deepEqual(row.played, ["play"]);
    await row.button.fire("click", { detail: 1 }); await row.item.fire("dblclick"); await h.advance(300); assert.equal(row.played.length, 1); assert.equal(h.nodes.pagesModal.classList.contains("is-open"), true);
    await row.button.fire("click", { detail: 0 }); assert.equal(row.played.length, 2);
  } finally { h.dispose(); }
});
test("pages modal keeps Escape Tab Shift Tab animation and return focus behavior", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); await h.flush(); 
    const focusable = Array.from(h.nodes.pagesModal.querySelectorAll("button:not([disabled])")), last = focusable.at(-1)!;
    focusable[0].focus(); const backward = await h.nodes.pagesModal.fire("keydown", { key: "Tab", shiftKey: true }); assert.equal(backward.defaultPrevented, true); assert.equal(h.doc.activeElement, last);
    const forward = await h.nodes.pagesModal.fire("keydown", { key: "Tab" }); assert.equal(forward.defaultPrevented, true); assert.equal(h.doc.activeElement, focusable[0]);
    assert.equal(h.nodes.pagesModalList.children.length, 2); assert.equal(h.nodes.pagesModalList.querySelector('button[aria-current="true"]')?.textContent.includes("当前"), true);
    await h.escape(); assert.equal(h.nodes.pagesModal.classList.contains("is-open"), false); assert.equal(h.doc.activeElement, h.nodes.playerPagesButton); assert.equal(h.nodes.pagesModal.hidden, false);
    await h.nodes.pagesModal.fire("transitionend"); assert.equal(h.nodes.pagesModal.hidden, true);
  } finally { h.dispose(); }
});
test("pages disabled preferences optimistically update rollback reject duplicates and restore all", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); await h.flush(); const gate = deferred(); h.reply(() => gate.promise);
    const pending = h.pages.changeDisabledPages(track(1).bvid, 11, true); await h.flush(); assert.equal(h.nodes.pagesModalList.children[0].classList.contains("is-disabled"), true); assert.equal(h.nodes.pagesModalList.children[0].children[1].disabled, true);
    await h.pages.changeDisabledPages(track(1).bvid, 22, true); assert.equal(h.calls.length, 1); gate.reject(Error("写入失败")); await pending;
    assert.equal(h.nodes.pagesModalList.children[0].classList.contains("is-disabled"), false); assert.match(h.nodes.pagesModalStatus.textContent, /保存分P设置失败：.*写入失败/); assert.equal(h.nodes.pagesModalList.children[0].children[1].disabled, false);
    h.reply(async () => []); await h.pages.changeDisabledPages(track(1).bvid, 11, true); assert.equal(h.nodes.pagesModalRestoreAll.hidden, false);
    await h.nodes.pagesModalRestoreAll.fire("click"); await h.flush(); assert.equal(h.calls.at(-1)?.command, "clear_disabled_pages"); assert.equal(h.nodes.pagesModalRestoreAll.hidden, true);
    assert.deepEqual(h.calls[0].args, { bvid: track(1).bvid, cid: 11, disabled: true });
  } finally { h.dispose(); }
});
test("pages restore all pending preserves visible button busy text and rolls back on failure", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); await h.flush(); h.reply(async () => []); await h.pages.changeDisabledPages(track(1).bvid, 11, true);
    const gate = deferred(); h.reply(() => gate.promise); const pending = h.pages.changeDisabledPages(track(1).bvid, null); await h.flush();
    assert.equal(h.nodes.pagesModalRestoreAll.hidden, false); assert.equal(h.nodes.pagesModalRestoreAll.disabled, true); assert.equal(h.nodes.pagesModalRestoreAll.textContent, "恢复中…");
    gate.reject(Error("失败")); await pending; assert.equal(h.nodes.pagesModalList.children[0].classList.contains("is-disabled"), true); assert.equal(h.nodes.pagesModalRestoreAll.disabled, false); assert.equal(h.nodes.pagesModalRestoreAll.textContent, "全部恢复");
  } finally { h.dispose(); }
});
test("pages query restores captured status even after another writer and track change", async () => {
  const h = await fixture(); try {
    const row = h.row(1), gate = deferred(); h.reply(() => gate.promise); h.nodes.status.textContent = "查询前提示";
    await row.item.fire("dblclick"); await h.flush(); assert.equal(h.nodes.status.textContent, "正在获取分P信息…"); assert.equal(row.button.getAttribute("aria-busy"), "true");
    h.nodes.status.textContent = "其他模块的新提示"; h.bridge.current = track(2); gate.resolve(meta); await h.flush();
    assert.equal(h.nodes.status.textContent, "查询前提示"); assert.match(h.nodes.pagesModalSub.textContent, /曲目1/); assert.equal(row.button.getAttribute("aria-busy"), null);
  } finally { h.dispose(); }
});
test("pages newest modal query discards late old metadata and shares first captured status", async () => {
  const h = await fixture(); try {
    const a = h.row(1), b = h.row(2), first = deferred(), second = deferred(); h.reply((_c, args) => args.bvid === track(1).bvid ? first.promise : second.promise);
    h.nodes.status.textContent = "最初提示"; await a.item.fire("dblclick"); await h.flush(); h.nodes.status.textContent = "中途提示"; await b.item.fire("dblclick"); await h.flush();
    first.resolve(meta); await h.flush(); assert.equal(h.nodes.pagesModal.hidden, true); assert.equal(h.nodes.pagesModalList.children.length, 0); assert.equal(a.button.getAttribute("aria-busy"), null);
    second.resolve(meta); await h.flush(); assert.equal(h.nodes.status.textContent, "最初提示"); assert.match(h.nodes.pagesModalSub.textContent, /曲目2/); assert.equal(h.nodes.pagesModalList.children.length, 2);
  } finally { h.dispose(); }
});
test("pages query failure and one page result retain existing status messages", async () => {
  const h = await fixture(); try {
    const row = h.row(1); h.reply(async () => { throw Error("失败"); }); await row.item.fire("dblclick"); await h.flush(); assert.equal(h.nodes.status.textContent, "获取分P信息失败"); assert.equal(h.nodes.pagesModalList.children.length, 0);
    h.reply(async () => ({ videos: 1, pages: [meta.pages[0]] })); await row.item.fire("dblclick"); await h.flush(); assert.equal(h.nodes.status.textContent, "该视频只有一个分P"); assert.equal(h.nodes.pagesModalList.children.length, 0);
  } finally { h.dispose(); }
});