import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, deferred, playlist } from "./library-modal-vue-fixture.ts";
import { open } from "./library-modal-open.ts";

for (const kind of ["name", "choose", "favoriteImport"] as const) test(`library ${kind} Tab wraps visible controls including aria-disabled choices`, async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, kind); h.raf(); const close = h.nodes.closeLibraryModalButton, primary = h.primary();
    primary.focus(); const forward = await h.fire(primary, "keydown", { key: "Tab" }); assert.equal(forward.defaultPrevented, true); assert.equal(h.doc.activeElement, close);
    const backward = await h.fire(close, "keydown", { key: "Tab", shiftKey: true }); assert.equal(backward.defaultPrevented, true); assert.equal(h.doc.activeElement, primary);
    const interior = kind === "choose" ? h.nodes.libraryModalBody.querySelector<HTMLButtonElement>('[aria-disabled="true"]')! : h.input();
    interior.focus(); const middle = await h.fire(interior, "keydown", { key: "Tab" }); assert.equal(middle.defaultPrevented, false); assert.equal(h.doc.activeElement, interior);
    if (kind === "favoriteImport") assert.equal(h.nodes.libraryModalBody.querySelectorAll("input")[1].closest("[hidden]")?.tagName, "LABEL");
    if (kind === "choose") assert.equal((interior as HTMLButtonElement).disabled, false);
    await h.fire(close, "click"); const closed = await h.fire(close, "keydown", { key: "Tab", shiftKey: true }); assert.equal(closed.defaultPrevented, false);
  } finally { h.dispose(); }
});

test("library busy primary is excluded and hidden ancestor custom controls never enter Tab loop", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "name"); h.raf(); const input = h.input(); input.value = "新名称"; await h.fire(input, "input");
    const gate = deferred(); h.reply(() => gate.promise); h.primary().click(); assert.equal(h.primary().disabled, true);
    const cancel = h.nodes.libraryModalBody.querySelector<HTMLButtonElement>(".quiet")!; cancel.focus(); const next = await h.fire(cancel, "keydown", { key: "Tab" }); assert.equal(next.defaultPrevented, true); assert.equal(h.doc.activeElement, h.nodes.closeLibraryModalButton);
    const hidden = h.doc.createElement("div"); hidden.hidden = true; const hiddenButton = h.doc.createElement("button"); hidden.append(hiddenButton); h.nodes.libraryModalBody.append(hidden);
    const previous = await h.fire(h.nodes.closeLibraryModalButton, "keydown", { key: "Tab", shiftKey: true }); assert.equal(previous.defaultPrevented, true); assert.equal(h.doc.activeElement, cancel);
    hidden.remove(); gate.reject(Error("测试失败")); await h.microtasks();
  } finally { h.dispose(); }
});

test("library shared focus loop includes select textarea and tabindex controls", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "generic"); h.raf(); const body = h.nodes.libraryModalBody;
    const select = h.doc.createElement("select"), textarea = h.doc.createElement("textarea"), custom = h.doc.createElement("div"), ignored = h.doc.createElement("div"); custom.tabIndex = 0; ignored.tabIndex = -1; body.append(select, textarea, custom, ignored);
    h.nodes.closeLibraryModalButton.focus(); const reverse = await h.fire(h.nodes.closeLibraryModalButton, "keydown", { key: "Tab", shiftKey: true }); assert.equal(reverse.defaultPrevented, true); assert.equal(h.doc.activeElement, custom);
    custom.focus(); const forward = await h.fire(custom, "keydown", { key: "Tab" }); assert.equal(forward.defaultPrevented, true); assert.equal(h.doc.activeElement, h.nodes.closeLibraryModalButton);
    custom.hidden = true; textarea.disabled = true; const filtered = await h.fire(h.nodes.closeLibraryModalButton, "keydown", { key: "Tab", shiftKey: true }); assert.equal(filtered.defaultPrevented, true); assert.equal(h.doc.activeElement, select);
  } finally { h.dispose(); }
});

for (const entry of ["Escape", "mask", "close"] as const) test(`library ${entry} close restores connected trigger with preventScroll`, async () => {
  const h = await fixture(); try {
    await h.seed(); const trigger = await open(h, "name"); h.raf();
    if (entry === "Escape") await h.fire(h.input(), "keydown", { key: "Escape" });
    else await h.click(entry === "mask" ? h.nodes.libraryModal : h.nodes.closeLibraryModalButton);
    assert.equal(h.state().session.open, false); assert.equal(h.doc.activeElement, trigger);
    assert.deepEqual(h.platform.filter(call => call.operation === "focus" && call.target === trigger).at(-1)?.detail, { preventScroll: true });
  } finally { h.dispose(); }
});

test("library close skips removed trigger without errors or a detached focus call", async () => {
  const h = await fixture(); const errors: unknown[][] = [], original = console.error; console.error = (...args) => errors.push(args); try {
    await h.seed(); const trigger = await open(h, "name"); h.raf(); trigger.remove(); const before = h.platform.length;
    h.library.closeLibraryModal(); assert.equal(h.state().session.open, false); assert.equal(h.platform.slice(before).some(call => call.operation === "focus" && call.target === trigger), false); assert.deepEqual(errors, []);
  } finally { console.error = original; h.dispose(); }
});

test("library pending choose blocks both another choice and createAndAdd without disabling playlist buttons", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "choose"); const button = h.nodes.libraryModalBody.querySelectorAll<HTMLButtonElement>(".playlist-choice")[1], gate = deferred(); h.reply(() => gate.promise);
    button.click(); button.click(); const ignored = h.store.actions.library.createAndAdd("新歌单");
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].command, "add_to_playlist"); assert.equal(h.primary().disabled, true); assert.equal(button.disabled, false);
    gate.resolve([playlist("a"), playlist("b")]); await ignored; await h.microtasks(); assert.equal(h.state().session.open, false);
  } finally { h.dispose(); }
});

test("library close before RAF cancels the frame while early Escape remains ignored", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "name"); await h.fire(h.input(), "keydown", { key: "Escape" }); assert.equal(h.state().session.open, true);
    const id = h.platform.filter(call => call.operation === "requestAnimationFrame").at(-1)?.detail;
    h.library.closeLibraryModal(); assert.equal(h.platform.some(call => call.operation === "cancelAnimationFrame" && call.detail === id), true);
    h.raf(); assert.equal(h.nodes.libraryModal.classList.contains("is-open"), false); assert.equal(h.nodes.libraryModal.getAttribute("aria-hidden"), "true");
  } finally { h.dispose(); }
});
