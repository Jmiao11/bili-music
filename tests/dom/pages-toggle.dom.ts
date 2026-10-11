import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, fixture, track } from "./pages-fixture.ts";

test("pages disable buttons send one exact command per native click and block clicks while saving", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf();
    const button = () => h.nodes.pagesModalList.querySelector<HTMLButtonElement>(".pages-disable-button")!;
    const requests = () => h.calls.filter(call => call.command === "set_page_disabled").map(call => call.args);
    const gate = deferred(); h.reply(() => gate.promise);
    button().click();
    assert.deepEqual(requests(), [{ bvid: track(1).bvid, cid: 11, disabled: true }]);
    assert.equal(h.nodes.pagesModal.classList.contains("is-open"), true);
    assert.equal(h.bridge.played.length, 0);
    assert.equal(button().disabled, true);
    button().click(); assert.equal(requests().length, 1);
    gate.resolve([]); await h.microtasks();
    assert.equal(button().disabled, false);
    h.reply(async () => []); button().click(); await h.microtasks();
    assert.deepEqual(requests(), [{ bvid: track(1).bvid, cid: 11, disabled: true }, { bvid: track(1).bvid, cid: 11, disabled: false }]);
    button().click(); await h.microtasks();
    h.nodes.pagesModalRestoreAll.click(); await h.microtasks();
    assert.deepEqual(h.calls.filter(call => call.command === "clear_disabled_pages").map(call => call.args), [{ bvid: track(1).bvid }]);
    assert.equal(h.nodes.pagesModal.classList.contains("is-open"), true);
    assert.equal(h.bridge.played.length, 0);
  } finally { h.dispose(); }
});

test("pages disable click stops propagation at the button", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf(); h.reply(async () => []);
    const observed: string[] = [];
    h.nodes.pagesModal.addEventListener("click", () => observed.push("modal"));
    h.doc.defaultView!.addEventListener("click", () => observed.push("window"));
    h.nodes.pagesModalList.querySelector<HTMLButtonElement>(".pages-disable-button")!.click(); await h.microtasks();
    assert.deepEqual(observed, []);
    h.nodes.pagesModalList.click();
    assert.deepEqual(observed, ["modal", "window"]);
  } finally { h.dispose(); }
});
