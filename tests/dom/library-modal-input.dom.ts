import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./library-modal-fixture.ts";
import { open } from "./library-modal-open.ts";

for (const kind of ["name", "choose", "favoriteImport"] as const) test("library " + kind + " input commits composing and final values without replacing nodes 按现状", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, kind); h.raf();
    const input = kind === "favoriteImport" ? h.nodes.libraryModalBody.querySelectorAll<HTMLInputElement>("input")[1] : h.input();
    input.focus(); let updates = 0;
    let previous = h.state().session.data.name;
    const unsubscribe = h.store.subscribe(state => { if (state.library.session.data.name !== previous) { updates++; previous = state.library.session.data.name; } });
    try {
      await h.fire(input, "compositionstart", { data: "" }); assert.equal(updates, 0);
      input.value = "zh"; input.setSelectionRange(1, 2, "backward");
      await h.fire(input, "compositionupdate", { data: "zh" }); assert.equal(updates, 0);
      const composing = await h.fire(input, "input", { data: "zh", inputType: "insertCompositionText", isComposing: true });
      assert.equal((composing as InputEvent).isComposing, true); assert.equal(h.state().session.data.name, "zh"); assert.equal(updates, 1);
      assert.equal(h.nodes.libraryModalBody.contains(input), true); assert.equal(h.doc.activeElement, input);
      assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [1, 2, "backward"]);
      await h.fire(input, "compositionend", { data: "中文" }); assert.equal(updates, 1);
      input.value = "中文"; input.setSelectionRange(1, 1);
      await h.fire(input, "input", { data: "中文", inputType: "insertText", isComposing: false });
      assert.equal(h.state().session.data.name, "中文"); assert.equal(updates, 2);
      assert.equal(h.nodes.libraryModalBody.querySelectorAll("input")[kind === "favoriteImport" ? 1 : 0], input);
      assert.equal(input.value, "中文"); assert.equal(h.doc.activeElement, input);
      assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 1]);
      input.value = "中文歌"; await h.fire(input, "input", { inputType: "insertText" });
      assert.equal(h.state().session.data.name, "中文歌"); assert.equal(updates, 3);
      h.store.actions.library.setModalName("外部名称");
      assert.equal(input.value, "外部名称"); assert.equal(h.doc.activeElement, input);
      assert.deepEqual([input.selectionStart, input.selectionEnd], [4, 4]);
    } finally { unsubscribe(); }
  } finally { h.dispose(); }
});

test("library import link input commits every composing input but external link state is not projected 按现状", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "favoriteImport"); h.raf(); const input = h.input();
    await h.fire(input, "compositionstart"); input.value = "li";
    await h.fire(input, "compositionupdate", { data: "li" }); await h.fire(input, "input", { isComposing: true, data: "li", inputType: "insertCompositionText" });
    assert.equal(h.state().session.data.link, "li"); assert.equal(h.input(), input);
    await h.fire(input, "compositionend", { data: "链接" }); input.value = "链接";
    await h.fire(input, "input", { isComposing: false, data: "链接", inputType: "insertText" });
    assert.equal(h.state().session.data.link, "链接"); assert.equal(h.input(), input); assert.equal(h.doc.activeElement, input);
    input.setSelectionRange(0, 1); h.store.actions.library.setModalLink("外部链接");
    assert.equal(h.state().session.data.link, "外部链接"); assert.equal(input.value, "链接");
    assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 1]);
  } finally { h.dispose(); }
});

test("library validation focusName increments and selects on every invalid submit", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "name"); h.raf(); const input = h.input(); input.value = "  "; await h.fire(input, "input");
    for (const expected of [1, 2]) {
      h.nodes.closeLibraryModalButton.focus(); await h.click(h.primary());
      assert.equal(h.state().session.data.focusName, expected); assert.equal(h.doc.activeElement, input);
      assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 2]);
      assert.equal(h.nodes.libraryModalStatus.textContent, "歌单名不能为空。"); assert.equal(h.calls.length, 0);
    }
  } finally { h.dispose(); }
});

test("library reopened session replaces input while ordinary state updates reuse it", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "name"); h.raf(); const old = h.input();
    h.store.actions.library.setModalName("旧值"); assert.equal(h.input(), old);
    h.library.closeLibraryModal(); h.library.createPlaylist(); const current = h.input();
    assert.notEqual(current, old); assert.equal(old.isConnected, false); assert.equal(current.value, "");
    let updates = 0; const unsubscribe = h.store.subscribe(() => { updates++; });
    try { current.value = "新值"; await h.fire(current, "input"); assert.equal(updates, 1); assert.equal(h.state().session.data.name, "新值"); }
    finally { unsubscribe(); }
  } finally { h.dispose(); }
});
