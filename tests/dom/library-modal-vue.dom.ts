import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fixture, deferred, playlist, track, unavailable } from "./library-modal-vue-fixture.ts";
import { open } from "./library-modal-open.ts";

test("library Vue host switches Vue kinds and generic with exclusive ownership", async () => {
  const h = await fixture(); try {
    await h.seed();
    const body = h.nodes.libraryModalBody;
    let detached: HTMLButtonElement | null = null;
    for (const kind of ["delete", "name", "purge", "generic", "loudness", "choose", "delete"] as const) {
      const before = h.calls.length;
      await open(h, kind);
      if (detached) { detached.click(); await h.microtasks(); assert.equal(h.calls.length, before + (kind === "purge" ? 1 : 0)); assert.equal(h.state().session.open, true); }
      assert.equal(body.querySelectorAll(".library-modal-actions").length, kind === "generic" ? 0 : 1);
      assert.equal(body.querySelectorAll("input").length, kind === "name" || kind === "choose" ? 1 : 0);
      assert.equal(body.querySelectorAll(".unavailable-purge-list").length, kind === "purge" ? 1 : 0);
      assert.equal(body.querySelectorAll(".danger-action").length, kind === "delete" ? 1 : 0);
      if (kind === "generic") assert.equal(body.innerHTML, "");
      if (kind === "generic") {
        assert.equal(h.regions.filter(x => x.operation === "create").length, h.regions.filter(x => x.operation === "unmount").length);
      }
      detached = kind !== "generic" ? h.primary() : null;
      if (kind === "name") {
        h.input().value = "单次创建"; await h.fire(h.input(), "input");
        h.reply(async command => { assert.equal(command, "create_playlist"); return [playlist("c")]; });
        await h.click(h.primary()); assert.equal(h.calls.filter(x => x.command === "create_playlist").length, 1);
      }
    }
    assert.deepEqual(h.warnings.filter(args => String(args[0]).startsWith("[Vue warn]")), []);
  } finally { h.dispose(); }
});

test("library Vue region is lazy for startup and generic and reused by all content kinds", async () => {
  const h = await fixture(); try {
    await h.seed(); assert.equal(h.regions.length, 0);
    await open(h, "generic"); assert.equal(h.regions.length, 0);
    for (const kind of ["name", "choose", "favoriteImport", "delete"] as const) { await open(h, kind); assert.equal(h.regions.filter(x => x.operation === "create").length, 1); }
    h.store.actions.library.setModalName("无关字段"); assert.equal(h.regions.filter(x => x.operation === "create").length, 1);
  } finally { h.dispose(); }
});

for (const kind of ["delete", "purge"] as const) test(`library Vue ${kind} busy projection is synchronous with unchanged primary label`, async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, kind);
    const gate = deferred(), primary = h.primary(), label = kind === "delete" ? "删除" : "全部清理";
    h.reply(async () => gate.promise);
    const observed: { primary: HTMLButtonElement; disabled: boolean; label: string | null; status: string | null }[] = [];
    const unsubscribe = h.store.subscribe(state => { if (!state.library.session.busy) return; observed.push({ primary: h.primary(), disabled: primary.disabled, label: primary.textContent, status: h.nodes.libraryModalStatus.textContent }); });
    primary.click(); assert.deepEqual(observed, [{ primary, disabled: true, label, status: kind === "delete" ? "正在删除…" : "正在清理…" }]); assert.equal(primary.disabled, true); assert.equal(primary.textContent, label);
    unsubscribe(); gate.reject(Error("测试失败")); await h.microtasks(); assert.equal(h.state().session.open, true); assert.equal(primary.disabled, false);
    assert.deepEqual(h.warnings.filter(args => String(args[0]).startsWith("[Vue warn]")), []);
  } finally { h.dispose(); }
});

test("library Vue reuses primary within session and replaces it on reopen before RAF focus", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "delete"); const old = h.primary();
    h.store.actions.library.setModalName("同 session"); assert.equal(h.primary(), old);
    h.library.closeLibraryModal(); assert.equal(h.primary(), old);
    await open(h, "delete"); assert.notEqual(h.primary(), old);
    old.click(); assert.equal(h.calls.length, 0); assert.equal(h.state().session.open, true);
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../../ui/library-view.ts"), "utf8");
    assert.match(source, /const libraryModalPrimarySelector = "\.library-modal-actions > \.secondary-button"/);
    for (const kind of ["loudness", "purge"] as const) { await open(h, kind); assert.equal(h.doc.activeElement, h.primary()); assert.ok(h.platform.some(x => x.operation === "focus" && x.target === h.primary())); }
    const content = h.nodes.libraryModalBody.innerHTML, purgePrimary = h.primary();
    await h.seed([], []); assert.equal(h.nodes.libraryModalBody.innerHTML, content); assert.equal(h.primary(), purgePrimary);
    assert.deepEqual(h.warnings.filter(args => String(args[0]).startsWith("[Vue warn]")), []);
  } finally { h.dispose(); }
});

test("library Vue content matches every old renderer HTML baseline and only adds empty Fragment text anchors", async () => {
  const baseline = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/vue/library-modal-baseline.json"), "utf8")) as { cases: { kind: "delete" | "loudness" | "purge"; variant: string; busy: boolean; favorites: ReturnType<typeof track>[]; playlists: ReturnType<typeof playlist>[]; data: { playlist?: ReturnType<typeof playlist>; unavailable?: typeof unavailable }; innerHTML: string; images: { src: string; alt: string; loading: string; referrerPolicy: string }[] }[] };
  for (const entry of baseline.cases.filter(entry => ["delete", "loudness", "purge"].includes(entry.kind))) {
    const h = await fixture(); try {
      await h.seed(entry.playlists, entry.favorites);
      h.store.actions.library.openModal(entry.kind, entry.kind, "", entry.data);
      if (entry.busy) { h.reply(async () => new Promise(() => {})); h.primary().click(); }
      const body = h.nodes.libraryModalBody;
      assert.equal(body.innerHTML, entry.innerHTML, `${entry.kind}/${entry.variant}/${entry.busy}`);
      const walker = h.doc.createTreeWalker(body, 128); assert.equal(walker.nextNode(), null);
      assert.ok([...body.childNodes].filter(x => x.nodeType === 3).every(x => x.textContent === ""));
      assert.deepEqual([...body.querySelectorAll("img")].map(x => ({ src: x.getAttribute("src"), alt: x.alt, loading: x.loading, referrerPolicy: x.referrerPolicy })), entry.images);
      assert.deepEqual(h.warnings.filter(args => String(args[0]).startsWith("[Vue warn]")), []);
    } finally { h.dispose(); }
  }
});
