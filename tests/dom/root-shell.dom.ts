import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { vueFeatureFlags } from "../../scripts/vue/features.ts";
import type { ApplicationStore } from "../../ui/store/application-store.ts";

test("root mounts before all player DOM queries and preserves controller writes through 1000 synchronous renders", async () => {
  const project = path.resolve(import.meta.dirname, "../.."), output = fs.mkdtempSync(path.join(os.tmpdir(), "bili-root-shell-"));
  const html = fs.readFileSync(path.join(project, "ui/index.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  try {
    for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, SVGElement: dom.window.SVGElement, Node: dom.window.Node, __VUE__: undefined })) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
    Object.defineProperty(dom.window, "__TAURI__", { value: { core: { invoke: () => new Promise(() => {}) } } });
    const entry = path.join(output, "entry.ts");
    fs.writeFileSync(entry, `import ${JSON.stringify(project + "/ui/app/root-mount.ts")}; export * as nodes from ${JSON.stringify(project + "/ui/platform/main-window-refs.ts")}; export { readApplicationStore } from ${JSON.stringify(project + "/ui/store/application-store.ts")}; export { setRootPlaylistList } from ${JSON.stringify(project + "/ui/features/tracks/root-lists.ts")};`);
    await build({ configFile: false, root: project, logLevel: "silent", plugins: [vue()], define: vueFeatureFlags,
      resolve: { alias: { vue: path.join(project, "node_modules/vue/dist/vue.runtime.esm-bundler.js") } },
      build: { outDir: path.join(output, "compiled"), minify: false, lib: { entry, formats: ["es"], fileName: "root" } },
    });
    const loaded = await import(pathToFileURL(path.join(output, "compiled/root.js")).href) as { nodes: Record<string, Element | Element[] | NodeListOf<Element> | null>; readApplicationStore(): ApplicationStore; setRootPlaylistList(rows: readonly never[]): void };
    for (const [name, node] of Object.entries(loaded.nodes)) assert.ok(node !== null, "Missing early DOM handle: " + name);
    const doc = dom.window.document, title = doc.querySelector<HTMLElement>("#placeholder-title")!, input = doc.querySelector<HTMLInputElement>("#search-keyword")!;
    title.classList.add("controller-class"); title.setAttribute("data-controller", "kept"); title.textContent = "控制器内容";
    input.value = "搜索草稿未提交";
    const store = loaded.readApplicationStore();
    for (let i = 0; i < 1000; i++) {
      loaded.setRootPlaylistList([]);
      store.actions.library.setModalName("unrelated" + i);
      assert.equal(doc.querySelector("#placeholder-title"), title);
      assert.equal(title.textContent, "控制器内容");
      assert.equal(title.classList.contains("controller-class"), true);
      assert.equal(title.getAttribute("data-controller"), "kept");
      assert.equal(doc.querySelector("#search-keyword"), input);
      assert.equal(input.value, "搜索草稿未提交");
    }
    assert.ok(!doc.querySelector("#app")!.contains(doc.querySelector("#audio")));
  } finally {
    dom.window.close();
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    if (path.dirname(output) !== os.tmpdir()) throw new Error("Unsafe temporary runtime cleanup");
    fs.rmSync(output, { recursive: true, force: true });
  }
});

import { fixture as rootFixture, track as rootTrack } from "./tracks-fixture.ts";
import type { RootRenderProbe } from "./tracks-fixture.ts";

test("root render coalesces nested requests while every store commit remains synchronous", async t => {
  const probe: RootRenderProbe = { depth: 0, maxDepth: 0, calls: 0 };
  const h = await rootFixture({ rootRenderProbe: probe }); t.after(h.dispose);
  const notifications: string[] = [];
  h.store.subscribe(state => notifications.push(state.playbackMessages.status));
  let nested = false;
  probe.during = () => {
    if (nested) return; nested = true;
    h.store.actions.playbackMessages.setStatus("inner");
    assert.equal(h.store.getState().playbackMessages.status, "inner");
    h.store.actions.lyricsDisplay.setManualBusy(true);
    h.store.actions.playbackMessages.setStatus("latest");
    assert.equal(h.store.getState().playbackMessages.status, "latest");
  };
  const calls = probe.calls;
  h.store.actions.playbackMessages.setStatus("outer");
  assert.deepEqual(notifications, ["inner", "inner", "latest", "outer"]);
  assert.equal(probe.calls, calls + 2);
  assert.equal(probe.maxDepth, 1);
  assert.equal(h.doc.querySelector("#status")!.textContent, h.store.getState().playbackMessages.status);
  assert.equal(h.doc.querySelector<HTMLButtonElement>("#lyrics-manual-search")!.disabled, true);
});

test("presentation and list refreshes replay the latest snapshot including commits during replay", async t => {
  const probe: RootRenderProbe = { depth: 0, maxDepth: 0, calls: 0 };
  const h = await rootFixture({ rootRenderProbe: probe }); t.after(h.dispose);
  assert.ok(h.presentation && h.stages && h.rootLists);
  const { presentation, stages, rootLists } = h;
  let pass = 0;
  probe.during = () => {
    if (++pass > 2) return;
    h.store.actions.playbackMessages.setStatus("pass " + pass);
    stages.setSidebarPresentation(240 + pass * 20, false);
    presentation.refreshPresentation();
    rootLists.refreshRootLists();
  };
  const calls = probe.calls;
  presentation.refreshPresentation();
  assert.equal(pass, 3);
  assert.equal(probe.calls, calls + 3);
  assert.equal(probe.maxDepth, 1);
  assert.equal(h.doc.querySelector("#status")!.textContent, "pass 2");
  assert.equal(h.store.getState().playbackMessages.status, "pass 2");
  assert.equal(h.doc.querySelector("#sidebar-resize")!.getAttribute("aria-valuenow"), "280");
});

test("root render releases its guard after render and post-render exceptions", async t => {
  const probe: RootRenderProbe = { depth: 0, maxDepth: 0, calls: 0 };
  const h = await rootFixture({ rootRenderProbe: probe }); t.after(h.dispose);
  const errors: unknown[][] = [], original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); }; t.after(() => { console.error = original; });
  probe.before = () => {
    probe.before = undefined;
    h.store.actions.playbackMessages.setStatus("committed before failure");
    throw new Error("render test failure");
  };
  h.store.actions.playbackMessages.setStatus("first failure");
  assert.equal(h.store.getState().playbackMessages.status, "committed before failure");
  assert.equal(errors.length, 1);
  h.store.actions.playbackMessages.setStatus("recovered");
  assert.equal(h.doc.querySelector("#status")!.textContent, "recovered");
  probe.after = () => { probe.after = undefined; throw new Error("post-render test failure"); };
  h.store.actions.playbackMessages.setStatus("second failure");
  assert.equal(errors.length, 2);
  h.store.actions.playbackMessages.setStatus("recovered again");
  assert.equal(h.doc.querySelector("#status")!.textContent, "recovered again");
  assert.equal(probe.depth, 0);
  assert.equal(probe.maxDepth, 1);
});

test("page focus restoration stays guarded until its synchronous focus handlers finish", async t => {
  const probe: RootRenderProbe = { depth: 0, maxDepth: 0, calls: 0 };
  const h = await rootFixture({ rootRenderProbe: probe }); t.after(h.dispose);
  assert.ok(h.stages);
  const pages = [{ page: 1, cid: 11, part: "一", durationSeconds: 60 }, { page: 2, cid: 22, part: "二", durationSeconds: 60 }];
  h.store.actions.pages.open(rootTrack(1), 2, pages);
  h.stages.setModalStage("pages", { hidden: false, open: true });
  const selected = h.doc.querySelector<HTMLButtonElement>("#pages-modal-list button")!;
  assert.ok(selected); selected.focus();
  let focused = 0, renderedInsideFocus = false, stateInsideFocus = "";
  h.doc.querySelector("#pages-modal-close")!.addEventListener("focus", () => {
    focused++;
    const calls = probe.calls;
    h.store.actions.playbackMessages.setStatus("focused commit");
    stateInsideFocus = h.store.getState().playbackMessages.status;
    renderedInsideFocus = probe.calls !== calls;
  });
  h.store.actions.pages.open(rootTrack(1), 2, pages);
  assert.equal(focused, 1);
  assert.equal(stateInsideFocus, "focused commit");
  assert.equal(renderedInsideFocus, false);
  assert.equal(h.doc.activeElement?.id, "pages-modal-close");
  assert.equal(h.doc.querySelector("#status")!.textContent, "focused commit");
  assert.equal(probe.maxDepth, 1);
});
