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
    const doc = dom.window.document, title = doc.querySelector<HTMLElement>("#home-title")!, input = doc.querySelector<HTMLInputElement>("#search-keyword")!;
    title.classList.add("controller-class"); title.setAttribute("data-controller", "kept"); title.textContent = "控制器内容";
    input.value = "搜索草稿未提交";
    const store = loaded.readApplicationStore();
    for (let i = 0; i < 1000; i++) {
      loaded.setRootPlaylistList([]);
      store.actions.library.setModalName("unrelated" + i);
      assert.equal(doc.querySelector("#home-title"), title);
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

import { nextDomEventTurn } from "./event-turn.ts";
import { fixture as rootFixture, track as rootTrack, responses } from "./tracks-fixture.ts";
import type { RootRenderProbe } from "./tracks-fixture.ts";

test("library headers stack up to three loaded covers and replace failed thumbnails", async t => {
  const h = await rootFixture(); t.after(h.dispose);
  for (const size of [0, 1, 2, 5]) {
    const items = Array.from({ length: size }, (_, index) => ({ ...rootTrack(index + 1), thumbnailUrl: `http://127.0.0.1/cover-${index}.png` }));
    h.reply(async command => {
      if (command === "list_favorites") return items;
      if (command === "list_playlists") return [{ id: "synthetic", name: "测试歌单", items }];
      if (command === "get_play_history") return items.map((item, index) => ({ ...item, lastPlayedAt: String(1795521600000 - index), count: 1, lastCid: null }));
      return [];
    });
    h.store.actions.settings.navigate("favorites");
    await h.store.actions.library.loadLibrary();
    h.store.actions.library.choosePlaylist("synthetic");
    h.store.actions.settings.navigate("recent");
    await h.microtasks();
    for (const selector of ["#view-favorites", "#view-recent", "#view-playlists"]) {
      const cover = h.doc.querySelector(`${selector} .library-hero .stacked-cover`)!;
      assert.equal(cover.getAttribute("aria-hidden"), "true");
      const tiles = () => [...cover.querySelectorAll<HTMLImageElement>(".stacked-tile")];
      await nextDomEventTurn();
      for (const image of tiles()) await h.fire(image, "load");
      assert.equal(cover.getAttribute("data-count"), String(Math.min(size, 3)));
      assert.deepEqual(tiles().map(img => img.src), items.slice(0, 3).map(item => item.thumbnailUrl));
      if (size === 5) {
        await h.fire(tiles()[0], "error");
        await h.fire(tiles()[2], "load");
        assert.deepEqual(tiles().map(img => img.src), items.slice(1, 4).map(item => item.thumbnailUrl));
        assert.equal(cover.querySelector("img.stacked-background"), null);
        while (tiles().length) await h.fire(tiles()[0], "error");
        assert.equal(cover.getAttribute("data-count"), "0");
        assert.ok(cover.querySelector(".stacked-note"));
      }
    }
  }
});

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

test("playing the second song moves its existing cover node to the front without repainting unrelated cards", async t => {
  const h = await rootFixture({ playback: true, coverCounters: true }); t.after(h.dispose);
  const items = [1, 2, 3].map(n => ({ ...rootTrack(n), thumbnailUrl: `https://i0.hdslb.com/test/${n}.jpg` }));
  const lists = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: "歌单" + i, items, createdAt: "0" }));
  const page = { page: 1, cid: 1, part: "单曲", durationSeconds: 60 };
  h.reply(async cmd => {
    if (cmd === "list_playlists") return lists;
    if (cmd === "list_favorites" || cmd === "list_unavailable_tracks") return [];
    if (cmd === "get_video_pages") return [page];
    if (cmd === "get_video_meta") return { videos: 1, pages: [page] };
    return responses(items)(cmd);
  });
  await h.store.actions.library.loadLibrary();
  await h.fire(h.doc.querySelector('[data-playlist-id="0"]')!, "click");
  const hero = h.doc.querySelector(".playlist-detail .stacked-cover")!;
  const card = h.doc.querySelector('[data-playlist-id="0"] .stacked-cover')!;
  const other = h.doc.querySelector('[data-playlist-id="1"] .stacked-cover')!;
  const tiles = (e: Element) => [...e.querySelectorAll<HTMLImageElement>(".stacked-tile")];
  await nextDomEventTurn();
  for (const cover of [hero, card, other]) for (const image of tiles(cover)) await h.fire(image, "load");
  const original = tiles(card);
  const sources = (cover: Element) => tiles(cover).map(img => img.src);
  const expected = items.map(item => item.thumbnailUrl + "@320w_320h_1c.webp");
  assert.deepEqual(sources(card), expected);
  assert.equal(h.doc.querySelector<HTMLImageElement>("#playlist-tracks .track-cover img")?.src, items[0].thumbnailUrl);
  const reset = () => { h.cardRenders.length = 0; h.renderCounts.PlaylistCard = 0; h.renderCounts.StackedCover = 0; };
  reset();
  await h.fire(h.doc.querySelectorAll("#playlist-tracks .track")[1], "click", { detail: 0 });
  const order = [expected[1], expected[2], expected[0]];
  assert.deepEqual(sources(card), order, "播放第 2 首时第 2 首在最前");
  assert.deepEqual(sources(hero), order);
  assert.deepEqual(sources(other), expected);
  assert.equal(card.querySelector('[data-layer="0"]'), original[1]);
  assert.deepEqual(h.cardRenders, ["0"]);
  assert.equal(h.renderCounts.PlaylistCard, 1);
  assert.equal(h.renderCounts.StackedCover, 2);
  reset();
  await h.fire(h.doc.querySelector("#next-button")!, "click");
  assert.deepEqual(sources(hero), [expected[2], expected[0], expected[1]]);
  assert.equal(card.querySelector('[data-layer="0"]'), original[2]);
  assert.deepEqual(h.cardRenders, ["0"]);
  assert.equal(h.renderCounts.PlaylistCard, 1);
  assert.equal(h.renderCounts.StackedCover, 2);
  reset();
  for (let i = 0; i < 100; i++) h.store.actions.playbackDisplay.observeProgress({ paused: false, ended: false, currentTime: i, duration: 200, playbackRate: 1 });
  assert.equal(h.renderCounts.PlaylistCard, 0);
  assert.equal(h.renderCounts.StackedCover, 0);
  h.store.actions.playbackQueue.replaceQueue(items, "playlist", null, "1");
  h.store.actions.playbackQueue.selectIndex(1, false, null);
  assert.deepEqual(sources(card), expected);
  assert.deepEqual(sources(other), order);
  assert.deepEqual([...new Set(h.cardRenders)].sort(), ["0", "1"]);
  lists[1] = { ...lists[1], name: "重命名", items: [items[2]] };
  await h.store.actions.library.loadLibrary(); await h.microtasks();
  assert.deepEqual(sources(other), [expected[2]]);
  assert.equal(other.closest("button")?.getAttribute("aria-label"), "打开歌单 重命名");
});

test("favorites and recent headers follow their own highlighted identity after reordering", async t => {
  const h = await rootFixture(); t.after(h.dispose);
  const items = [1, 2, 3].map(n => ({ ...rootTrack(n), thumbnailUrl: `http://127.0.0.1/cover-${n}.png` }));
  const reverse = [...items].reverse();
  h.reply(async cmd => {
    if (cmd === "list_favorites") return reverse;
    if (cmd === "get_play_history") return reverse.map((item, i) => ({ ...item, lastPlayedAt: String(1795521600000 - i), count: 1, lastCid: null }));
    return cmd === "list_disabled_pages" ? {} : [];
  });
  await h.store.actions.library.loadLibrary();
  h.store.actions.settings.navigate("recent"); await h.microtasks();
  for (const view of ["favorites", "recent"] as const) {
    h.store.actions.playbackQueue.replaceQueue(items, view);
    h.store.actions.playbackQueue.selectIndex(0, false, null);
    const section = h.doc.querySelector("#view-" + view)!;
    assert.equal(section.querySelector('.track[aria-current="true"]')?.getAttribute("data-bvid"), items[0].bvid);
    assert.deepEqual([...section.querySelectorAll<HTMLImageElement>(".stacked-tile")].map(img => img.src),
      [items[0], items[2], items[1]].map(item => item.thumbnailUrl));
  }
});
