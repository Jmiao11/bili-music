import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, fixture, track } from "./pages-fixture.ts";

test("pages Tab skips hidden restore and leaves interior default navigation alone", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf();
    const first = h.nodes.pagesModalList.querySelector<HTMLButtonElement>(".pages-list-button")!;
    h.nodes.pagesModalClose.focus();
    const forward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab" });
    assert.equal(forward.defaultPrevented, true); assert.equal(h.doc.activeElement, first);
    const backward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab", shiftKey: true });
    assert.equal(backward.defaultPrevented, true); assert.equal(h.doc.activeElement, h.nodes.pagesModalClose);
    const middle = h.nodes.pagesModalList.querySelector<HTMLButtonElement>(".pages-disable-button")!;
    middle.focus(); const interior = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab" });
    assert.equal(interior.defaultPrevented, false); assert.equal(h.doc.activeElement, middle);
  } finally { h.dispose(); }
});

test("pages Tab includes visible enabled restore as first button", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf(); h.reply(async () => []);
    await h.pages.changeDisabledPages(track(1).bvid, 11, true);
    assert.equal(h.nodes.pagesModalRestoreAll.hidden, false); assert.equal(h.nodes.pagesModalRestoreAll.disabled, false);
    h.nodes.pagesModalClose.focus(); const forward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab" });
    assert.equal(forward.defaultPrevented, true); assert.equal(h.doc.activeElement, h.nodes.pagesModalRestoreAll);
    const backward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab", shiftKey: true });
    assert.equal(backward.defaultPrevented, true); assert.equal(h.doc.activeElement, h.nodes.pagesModalClose);
  } finally { h.dispose(); }
});

test("pages Tab excludes visible restore while preference save is pending", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf(); const gate = deferred(); h.reply(() => gate.promise);
    const pending = h.pages.changeDisabledPages(track(1).bvid, 11, true);
    try {
      assert.equal(h.nodes.pagesModalRestoreAll.hidden, false); assert.equal(h.nodes.pagesModalRestoreAll.disabled, true);
      const first = h.nodes.pagesModalList.querySelector<HTMLButtonElement>(".pages-list-button")!;
      h.nodes.pagesModalClose.focus(); const forward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab" });
      assert.equal(forward.defaultPrevented, true); assert.equal(h.doc.activeElement, first);
      const backward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab", shiftKey: true });
      assert.equal(backward.defaultPrevented, true); assert.equal(h.doc.activeElement, h.nodes.pagesModalClose);
    } finally { gate.resolve([]); await pending; }
  } finally { h.dispose(); }
});

test("pages Tab and Shift Tab stay on close when list is empty", async () => {
  const h = await fixture(); try {
    h.pages.closePagesModal(); h.store.actions.pages.open(track(1), 0, []); h.raf();
    h.nodes.pagesModalClose.focus();
    const forward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab" });
    assert.equal(forward.defaultPrevented, true); assert.equal(h.doc.activeElement, h.nodes.pagesModalClose);
    const backward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab", shiftKey: true });
    assert.equal(backward.defaultPrevented, true); assert.equal(h.doc.activeElement, h.nodes.pagesModalClose);
  } finally { h.dispose(); }
});

test("pages Tab does not intercept after modal closes", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf(); h.pages.closePagesModal();
    h.nodes.playerPagesButton.focus();
    const forward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab" });
    assert.equal(forward.defaultPrevented, false); assert.equal(h.doc.activeElement, h.nodes.playerPagesButton);
    const backward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab", shiftKey: true });
    assert.equal(backward.defaultPrevented, false); assert.equal(h.doc.activeElement, h.nodes.playerPagesButton);
  } finally { h.dispose(); }
});

test("pages Tab excludes buttons inside a hidden ancestor", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf(); h.reply(async () => []);
    await h.pages.changeDisabledPages(track(1).bvid, 11, true);
    const restore = h.nodes.pagesModalRestoreAll, wrapper = h.doc.createElement("div");
    restore.before(wrapper); wrapper.hidden = true; wrapper.append(restore);
    try {
      assert.equal(restore.hidden, false); assert.equal(restore.disabled, false);
      const first = h.nodes.pagesModalList.querySelector<HTMLButtonElement>(".pages-list-button")!;
      h.nodes.pagesModalClose.focus(); const forward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab" });
      assert.equal(forward.defaultPrevented, true); assert.equal(h.doc.activeElement, first);
      const backward = await h.fire(h.nodes.pagesModal, "keydown", { key: "Tab", shiftKey: true });
      assert.equal(backward.defaultPrevented, true); assert.equal(h.doc.activeElement, h.nodes.pagesModalClose);
    } finally { wrapper.replaceWith(restore); }
  } finally { h.dispose(); }
});
