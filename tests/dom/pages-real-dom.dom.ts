import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, fixture, meta, track } from "./pages-fixture.ts";

test("pages real DOM opens before RAF and focuses current page then first page then close", async () => {
  const h = await fixture(); try {
    h.nodes.playerPagesButton.focus(); h.pages.openCurrentPagesModal();
    assert.equal(h.nodes.pagesModal.hidden, false);
    assert.equal(h.nodes.pagesModal.classList.contains("is-open"), false);
    assert.equal(h.nodes.pagesModal.getAttribute("aria-hidden"), "true");
    assert.equal(h.doc.activeElement, h.nodes.playerPagesButton);
    h.raf();
    assert.equal(h.nodes.pagesModal.classList.contains("is-open"), true);
    assert.equal(h.nodes.pagesModal.getAttribute("aria-hidden"), "false");
    const current = h.nodes.pagesModalList.querySelector('button[aria-current="true"]');
    assert.equal(h.doc.activeElement, current);
    assert.deepEqual(h.platform.filter(call => call.operation === "scrollIntoView").map(call => ({ target: call.target, options: call.detail })), [{ target: current, options: { block: "nearest" } }]);
    h.pages.closePagesModal(); h.reply(async () => meta); const other = h.row(2); await h.fire(other.item, "dblclick"); h.raf();
    assert.equal(h.doc.activeElement, h.nodes.pagesModalList.querySelector("button"));
    assert.equal(h.nodes.pagesModalList.querySelector('[aria-current="true"]'), null);
    h.pages.closePagesModal(); h.store.actions.pages.open(track(2), 0, []); h.raf();
    assert.equal(h.doc.activeElement, h.nodes.pagesModalClose);
  } finally { h.dispose(); }
});

test("pages real DOM close button backdrop Escape and controller wait for own transitionend", async () => {
  const h = await fixture(); try {
    for (const close of [() => h.fire(h.nodes.pagesModalClose, "click"), () => h.fire(h.nodes.pagesModal, "click"), () => h.escape(), () => h.pages.closePagesModal()]) {
      h.nodes.playerPagesButton.focus(); h.pages.openCurrentPagesModal(); h.raf();
      await h.fire(h.nodes.pagesModalList, "click");
      assert.equal(h.nodes.pagesModal.classList.contains("is-open"), true);
      await h.fire(h.nodes.pagesModal, "transitionend");
      assert.equal(h.nodes.pagesModal.hidden, false);
      await close();
      assert.equal(h.store.getState().pages.modal, null);
      assert.equal(h.nodes.pagesModal.classList.contains("is-open"), false);
      assert.equal(h.nodes.pagesModal.getAttribute("aria-hidden"), "true");
      assert.equal(h.nodes.pagesModal.hidden, false);
      assert.equal(h.doc.activeElement, h.nodes.playerPagesButton);
      await h.fire(h.nodes.pagesModalList, "transitionend");
      assert.equal(h.nodes.pagesModal.hidden, false);
      await h.fire(h.nodes.pagesModal, "transitionend");
      assert.equal(h.nodes.pagesModal.hidden, true);
    }
    const row = h.row(2); h.reply(async () => meta); await h.fire(row.item, "dblclick"); h.raf();
    row.item.remove(); h.pages.closePagesModal();
    assert.notEqual(h.doc.activeElement, row.button);
  } finally { h.dispose(); }
});

test("pages real DOM redraw sends list or restore focus to close and preserves outside focus", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf(); h.reply(async () => []);
    const previous = h.nodes.pagesModalList.querySelector("button")!; previous.focus();
    await h.pages.changeDisabledPages(track(1).bvid, 11, true);
    assert.equal(previous.isConnected, false);
    assert.equal(h.doc.activeElement, h.nodes.pagesModalClose);
    h.nodes.pagesModalRestoreAll.focus(); await h.pages.changeDisabledPages(track(1).bvid, null);
    assert.equal(h.doc.activeElement, h.nodes.pagesModalClose);
    h.nodes.playerPagesButton.focus(); await h.pages.changeDisabledPages(track(1).bvid, 22, true);
    assert.equal(h.doc.activeElement, h.nodes.playerPagesButton);
  } finally { h.dispose(); }
});

test("pages real DOM Tab uses native button list including hidden restore and excluding disabled buttons", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf();
    const list = () => [...h.nodes.pagesModal.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    assert.deepEqual(list().map(button => button.id || button.className), ["pages-modal-restore-all", "pages-list-button is-current", "pages-disable-button", "pages-list-button", "pages-disable-button", "pages-modal-close"]);
    assert.equal(h.nodes.pagesModalRestoreAll.hidden, true);
    list()[0].focus(); const backward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab", shiftKey: true });
    assert.equal(backward.defaultPrevented, true); assert.equal(h.doc.activeElement, list().at(-1));
    const forward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab" });
    assert.equal(forward.defaultPrevented, true); assert.equal(h.doc.activeElement, h.nodes.pagesModalRestoreAll);
    list()[2].focus(); const interior = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab" });
    assert.equal(interior.defaultPrevented, false);
    const gate = deferred(); h.reply(() => gate.promise); const pending = h.pages.changeDisabledPages(track(1).bvid, 11, true);
    assert.deepEqual(list().map(button => button.id || button.className), ["pages-list-button is-current", "pages-list-button", "pages-modal-close"]);
    gate.resolve([]); await pending; h.pages.closePagesModal();
    const closed = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab" }); assert.equal(closed.defaultPrevented, false);
  } finally { h.dispose(); }
});

test("pages real DOM single click waits exactly 250ms double click cancels and keyboard click is immediate", async () => {
  const h = await fixture(); try {
    const row = h.row(1); h.reply(async command => command === "get_cached_video_pages" ? {} : meta);
    await h.fire(row.button, "click", { detail: 1 }); await h.advance(249); assert.equal(row.played.length, 0);
    await h.advance(1); assert.deepEqual(row.played, ["play"]);
    await h.fire(row.button, "click", { detail: 1 }); await h.fire(row.button, "click", { detail: 2 }); await h.fire(row.button, "dblclick", { detail: 2 }); await h.advance(250);
    assert.equal(row.played.length, 1); assert.equal(h.nodes.pagesModal.classList.contains("is-open"), true);
    await h.fire(row.button, "click", { detail: 0 }); assert.equal(row.played.length, 2);
    h.pages.closePagesModal(); const before = h.calls.length; await h.fire(row.actions, "dblclick");
    assert.equal(h.calls.length, before); assert.equal(h.nodes.pagesModal.classList.contains("is-open"), false);
    assert.equal(h.platform.some(call => call.operation === "clearTimeout"), true);
  } finally { h.dispose(); }
});

test("pages real DOM stale query cannot update cache modal status or a newer trigger busy state", async () => {
  const h = await fixture(); try {
    const a = h.row(1), b = h.row(2), first = deferred(), second = deferred();
    h.reply((_command, args) => args.bvid === track(1).bvid ? first.promise : second.promise);
    h.store.actions.playbackMessages.setStatus("原提示"); await h.fire(a.item, "dblclick");
    assert.equal(a.button.getAttribute("aria-busy"), "true"); h.store.actions.playbackMessages.setStatus("中途提示");
    await h.fire(b.item, "dblclick"); first.resolve(meta); await h.microtasks();
    assert.equal(a.button.getAttribute("aria-busy"), null); assert.equal(b.button.getAttribute("aria-busy"), "true");
    assert.equal(h.store.getState().pages.videoPagesByBvid.has(track(1).bvid), false);
    assert.equal(h.store.getState().pages.modal, null); assert.equal(h.nodes.status.textContent, "正在获取分P信息…");
    second.resolve(meta); await h.flush(); assert.equal(b.button.getAttribute("aria-busy"), null);
    assert.equal(h.nodes.status.textContent, "原提示"); assert.match(h.nodes.pagesModalSub.textContent ?? "", /曲目2/);
    h.pages.closePagesModal(); const old = deferred(), latest = deferred(); let query = 0; const same = h.row(3);
    h.reply(() => ++query === 1 ? old.promise : latest.promise); await h.fire(same.item, "dblclick"); await h.fire(same.item, "dblclick");
    old.reject(Error("迟到失败")); await h.microtasks(); assert.equal(same.button.getAttribute("aria-busy"), "true");
    latest.reject(Error("当前失败")); await h.microtasks(); assert.equal(same.button.getAttribute("aria-busy"), null);
    assert.equal(same.button.dataset.pagesRequestVersion, undefined); assert.equal(h.nodes.status.textContent, "获取分P信息失败");
  } finally { h.dispose(); }
});

test("pages real DOM disabled page still plays and closes before the playback callback", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf(); h.reply(async () => []); await h.pages.changeDisabledPages(track(1).bvid, 11, true);
    const item = h.nodes.pagesModalList.children[0], button = item.querySelector<HTMLButtonElement>(".pages-list-button")!;
    assert.equal(item.classList.contains("is-disabled"), true); assert.equal(button.disabled, false);
    await h.fire(button, "click");
    assert.deepEqual(h.bridge.played, [h.bridge.pages[0]]);
    const observed = h.bridge.playObservations[0];
    assert.equal(observed.open, false); assert.equal(observed.ariaHidden, "true"); assert.equal(observed.modal, null);
    assert.equal(observed.hidden, false); assert.equal(observed.focus, h.nodes.playerPagesButton);
  } finally { h.dispose(); }
});

test("pages real DOM saving disabled preference updates classes disabled busy and focus synchronously", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf(); const gate = deferred(); h.reply(() => gate.promise);
    const pending = h.pages.changeDisabledPages(track(1).bvid, 11, true);
    assert.equal(h.nodes.pagesModalList.children[0].classList.contains("is-disabled"), true);
    assert.deepEqual([...h.nodes.pagesModalList.querySelectorAll<HTMLButtonElement>(".pages-disable-button")].map(button => [button.disabled, button.getAttribute("aria-busy")]), [[true, "true"], [true, "false"]]);
    assert.equal(h.nodes.pagesModalRestoreAll.hidden, false); assert.equal(h.nodes.pagesModalRestoreAll.disabled, true);
    assert.equal(h.doc.activeElement, h.nodes.pagesModalClose);
    assert.deepEqual(h.calls[0].args, { bvid: track(1).bvid, cid: 11, disabled: true });
    gate.reject(Error("保存失败")); await pending;
    assert.equal(h.nodes.pagesModalList.children[0].classList.contains("is-disabled"), false);
    assert.deepEqual([...h.nodes.pagesModalList.querySelectorAll<HTMLButtonElement>(".pages-disable-button")].map(button => [button.disabled, button.getAttribute("aria-busy")]), [[false, "false"], [false, "false"]]);
    assert.equal(h.nodes.pagesModalRestoreAll.hidden, true); assert.match(h.nodes.pagesModalStatus.textContent ?? "", /保存分P设置失败：.*保存失败/);
  } finally { h.dispose(); }
});
