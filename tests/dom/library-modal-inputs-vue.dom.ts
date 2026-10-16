import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { LibrarySnapshot } from "../../ui/library-state.ts";
import { fixture, deferred, playlist, track } from "./library-modal-fixture.ts";
import { open } from "./library-modal-open.ts";

test("library Vue input kinds match old HTML including escaped playlist names", async () => {
  const baseline = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/vue/library-modal-baseline.json"), "utf8")) as { cases: { kind: LibrarySnapshot["session"]["kind"]; data: LibrarySnapshot["session"]["data"]; playlists: ReturnType<typeof playlist>[]; favorites: ReturnType<typeof track>[]; innerHTML: string }[] };
  for (const entry of baseline.cases.filter(entry => ["name", "choose", "favoriteImport"].includes(entry.kind))) {
    const h = await fixture({captureWarnings:true}); try {
      await h.seed(entry.playlists, entry.favorites); h.store.actions.library.openModal(entry.kind, entry.kind, "", entry.data);
      assert.equal(h.nodes.libraryModalBody.innerHTML, entry.innerHTML);
      assert.deepEqual(h.warnings.filter(args => String(args[0]).startsWith("[Vue warn]")), []);
    } finally { h.dispose(); }
  }
});

for (const kind of ["name", "choose", "favoriteImport"] as const) test(`library Vue ${kind} input selection and external name updates preserve the session node`, async () => {
  const h = await fixture({captureWarnings:true}); try {
    await h.seed(); await open(h, kind); const input = h.nodes.libraryModalBody.querySelectorAll<HTMLInputElement>("input")[kind === "favoriteImport" ? 1 : 0];
    input.focus(); input.value = "中文名称"; input.setSelectionRange(1, 3, "backward");
    await h.fire(input, "input", { isComposing: true, inputType: "insertCompositionText" });
    assert.equal(h.state().session.data.name, "中文名称"); assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [1, 3, "backward"]);
    h.store.actions.library.setModalLink("无关投影"); assert.equal(input.value, "中文名称"); assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 3]);
    input.value = "尚未派发input"; input.setSelectionRange(1, 2); h.store.actions.library.setModalLink("另一无关投影");
    assert.equal(input.value, "尚未派发input"); assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 2]);
    h.store.actions.library.setModalName("外部名称"); assert.equal(input.value, "外部名称"); assert.equal(input.isConnected, true);
    h.library.closeLibraryModal(); await open(h, kind); assert.notEqual(h.nodes.libraryModalBody.querySelectorAll("input")[kind === "favoriteImport" ? 1 : 0], input);
    assert.deepEqual(h.warnings.filter(args => String(args[0]).startsWith("[Vue warn]")), []);
  } finally { h.dispose(); }
});

test("library Vue link stays uncontrolled and Enter uses disabled native primary click", async () => {
  const h = await fixture({captureWarnings:true}); try {
    await h.seed(); await open(h, "favoriteImport"); const link = h.input(); link.value = "输入链接";
    await h.fire(link, "input", { isComposing: true }); h.store.actions.library.setModalLink("外部链接");
    assert.equal(link.value, "输入链接"); assert.equal(h.state().session.data.link, "外部链接");
    await open(h, "name"); const input = h.input(); input.value = "新名称"; await h.fire(input, "input");
    const gate = deferred(); h.reply(() => gate.promise);
    const first = await h.fire(input, "keydown", { key: "Enter", isComposing: true });
    assert.equal(first.defaultPrevented, true); assert.equal(h.primary().disabled, true); assert.equal(h.calls.filter(call => call.command === "create_playlist").length, 1);
    const second = await h.fire(input, "keydown", { key: "Enter" }); assert.equal(second.defaultPrevented, true); assert.equal(h.calls.filter(call => call.command === "create_playlist").length, 1);
    gate.reject(Error("测试失败")); await h.microtasks(); assert.equal(h.state().session.open, true);
    assert.deepEqual(h.warnings.filter(args => String(args[0]).startsWith("[Vue warn]")), []);
  } finally { h.dispose(); }
});
