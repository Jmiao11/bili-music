import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { sourceSlice } from "./helpers/source-slice.ts";

function slice(file: string, start: string | null, end: string) {
  return sourceSlice(fs.readFileSync(path.join(import.meta.dirname, "../ui", file), "utf8"), `ui/${file}`, start, end);
}

test("theme defaults preserve null, invalid values and all supported themes", () => {
  const root = { dataset: {} as Record<string, string>, style: { removeProperty() {} } };
  const writes: [string, unknown][] = [];
  const context = vm.createContext({ root, themeOptions: [], imageOnlyGroups: [], THEME_KEY: "theme", GLASS_BLUR_KEY: "blur", PANEL_ALPHA_KEY: "alpha", BACKGROUND_DIM_KEY: "dim",
    localStorage: { getItem: () => null, setItem: (key: string, value: unknown) => writes.push([key, value]) },
    setGlassBlur() {}, setPanelAlpha() {}, setBackgroundDim() {},
  });
  vm.runInContext(slice("appearance.ts", "function applyTheme(", "function setGlassBlur("), context);
  for (const value of [null, undefined, "", "invalid", 0, false, {}, "dark", "light", "image", "dynamic"]) {
    context.applyTheme(value);
    const expected = typeof value === "string" && ["dark", "light", "image", "dynamic"].includes(value) ? value : "dark";
    assert.equal(root.dataset.theme, expected);
    assert.deepEqual(writes.at(-1), ["theme", expected]);
  }
});

test("restoring cache settings cancels the active timer and preserves the null timer no-op", async () => {
  for (const timer of [null, 21]) {
    const cancelled: (number | null)[] = [];
    const settings = { enabled: true, maxBytes: 1024 };
    const context = vm.createContext({ audioCacheStatusTimer: timer, audioCacheSettings: null,
      audioCacheEnabled: {}, audioCacheCapacity: {}, audioCacheStatus: {},
      clearTimeout: (id: number | null) => { if (id !== null) cancelled.push(id); },
      invokeAppearance: async () => settings,
    });
    vm.runInContext(slice("appearance.ts", "async function restoreAudioCacheSettings(", "async function refreshAudioCacheUsage("), context);
    await context.restoreAudioCacheSettings();
    assert.deepEqual(cancelled, timer === null ? [] : [timer]);
    assert.equal(context.audioCacheStatusTimer, null);
    assert.equal(context.audioCacheEnabled.checked, true);
    assert.equal(context.audioCacheCapacity.value, "1024");
  }
});

test("native list drag handlers preserve transfers and ignore unsupported null transfers", () => {
  for (const [name, end, stateName, args] of [
    ["bindFavoriteDrag", "function renderFavorites(", "favoriteDragState", [4]],
    ["bindPlaylistItemDrag", "function isPlaylistListDragClickSuppressed(", "playlistDragState", ["p", 4]],
    ["bindPlaylistDrag", "function renderPlaylists(", "playlistListDragState", [4]],
  ] as [string, string, string, (string | number)[]][]) {
    const handlers: Record<string, (event: object) => void> = {};
    const row = { querySelectorAll: () => [], addEventListener: (name: string, fn: (event: object) => void) => { handlers[name] = fn; },
      classList: { add() {}, remove() {} } };
    const state: { saving: boolean; drag: { index: number } | null } = { saving: false, drag: null };
    const context = vm.createContext({ [stateName]: state,
      finishFavoriteDrag() {}, finishPlaylistDrag() {}, finishPlaylistListDrag() {},
    });
    vm.runInContext(slice("library-ui.ts", `function ${name}(`, end), context);
    context[name](row, ...args);
    handlers.dragstart({ dataTransfer: null });
    assert.equal(state.drag, null);
    let prevented = 0;
    handlers.dragover({ dataTransfer: null, preventDefault: () => { prevented++; } });
    assert.equal(prevented, 0);
    const written: unknown[][] = [];
    const dataTransfer: { setData(...args: unknown[]): number; effectAllowed?: string; dropEffect?: string } = { setData: (...args) => written.push(args) };
    handlers.dragstart({ dataTransfer });
    assert.equal(dataTransfer.effectAllowed, "move");
    assert.deepEqual(written, [["text/plain", "4"]]);
    const drag = (state as { drag: { index: number } | null }).drag;
    if (!drag) throw new Error("Drag state is missing");
    assert.equal(drag.index, 4);
    handlers.dragover({ dataTransfer, preventDefault: () => { prevented++; } });
    assert.equal(dataTransfer.dropEffect, "move");
    assert.equal(prevented, 1);
  }
});

test("window control target handling keeps native element matches and ignores null targets", () => {
  const context = vm.createContext({});
  vm.runInContext(slice("window-controls.ts", "function isWindowControlTarget(", "function isTitlebarDragTarget("), context);
  assert.equal(context.isWindowControlTarget(null), false);
  assert.equal(context.isWindowControlTarget({ closest: () => ({}) }), true);
  assert.equal(context.isWindowControlTarget({ closest: () => null }), false);
});

type RuntimeElement = {
  children: (RuntimeElement | string)[]; dataset: Record<string, unknown>; listeners: Record<string, (...args: unknown[]) => unknown>;
  value?: string; disabled?: boolean; title?: string; classList: { add(): void; remove(): void; toggle(): void }; setAttribute(): void;
  append(...items: (RuntimeElement | string)[]): void; replaceChildren(...items: (RuntimeElement | string)[]): void;
  addEventListener(name: string, fn: (...args: unknown[]) => unknown): void; contains(): boolean; focus(): void; select(): void;
};
function runtimeElement(): RuntimeElement {
  const element: RuntimeElement = { children: [], dataset: {}, listeners: {},
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {},
    append(...items: (RuntimeElement | string)[]) { this.children.push(...items); }, replaceChildren(...items: (RuntimeElement | string)[]) { this.children = items; },
    addEventListener(name: string, fn: (...args: unknown[]) => unknown) { this.listeners[name] = fn; }, contains: () => false, focus() {}, select() {},
  };
  return element;
}

test("mascot picker callbacks use the initialized API for selection and hiding", () => {
  const selected: string[] = [], picker = runtimeElement();
  const api = { list: () => [{ id: "kuro", name: "黑猫", svg: "<svg/>" }], setActive: (id: string) => selected.push(id) };
  const context = vm.createContext({ mascotPicker: picker, window: { BiliMascot: api },
    document: { createElement: runtimeElement }, syncMascotPickerSelection() {},
  });
  vm.runInContext(slice("appearance.ts", "function renderMascotPicker(", "function openSettings("), context);
  context.renderMascotPicker();
  assert.equal(picker.children.length, 2);
  (picker.children[0] as RuntimeElement).listeners.click();
  (picker.children[1] as RuntimeElement).listeners.click();
  assert.deepEqual(selected, ["kuro", "none"]);
  context.window.BiliMascot = undefined;
  context.renderMascotPicker();
  assert.equal(picker.children.length, 2);
});

test("page count observer disconnect handling preserves native unobserve and ignores a missing observer", () => {
  let callback: ((...args: unknown[]) => unknown) | undefined;
  const removed: unknown[] = [];
  class Observer { constructor(fn: (...args: unknown[]) => unknown) { callback = fn; } observe() {} unobserve(target: unknown) { removed.push(target); } }
  const context = vm.createContext({ window: { IntersectionObserver: Observer }, pageCountObserver: undefined,
    videoPageCounts: new Map(), failedPageCountBvids: new Set(), visiblePageCountTargets: new Map(),
    observedPageCountTargets: new Map(), stopObservingPageCountBvid() {}, queuePageCountLookup() {},
  });
  vm.runInContext(slice("video-pages.ts", "function observePageCount(", "async function loadVideoPagesForModal("), context);
  const item = { dataset: {}, isConnected: false };
  context.observePageCount(item, "bv");
  if (!callback) throw new Error("Expected callback is missing");
  callback([{ target: item, isIntersecting: false }]);
  assert.deepEqual(removed, [item]);
  context.pageCountObserver = null;
  if (!callback) throw new Error("Expected callback is missing");
  callback([{ target: item, isIntersecting: false }]);
  assert.deepEqual(removed, [item]);
});

test("pages modal rendering preserves page selection and ignores a missing private context", () => {
  const list = runtimeElement(), page = { page: 1, cid: 10, part: "第一P", durationSeconds: 60 }, selections: { startPage: unknown; pages: unknown[] }[] = [];
  list.children.push("unchanged");
  const context = vm.createContext({ pagesModalContext: null, pagesModalList: list,
    libraryState: { disabledPagePending: new Map(), disabledPages: new Map() },
    document: { activeElement: null, createElement: runtimeElement },
    pagesModalRestoreAll: runtimeElement(), pagesModalTitle: {}, pagesModalSub: {}, pagesModalClose: runtimeElement(),
    currentPlayableTrack: () => null, currentVideoPage: () => null, isPageDisabled: () => false, formatDuration: () => "1:00",
  });
  context.closePagesModal = () => { context.pagesModalContext = null; };
  vm.runInContext(slice("video-pages.ts", "function renderPagesModal(", "async function changeDisabledPages("), context);
  context.renderPagesModal();
  assert.deepEqual(list.children, ["unchanged"]);
  context.pagesModalContext = { video: { bvid: "BV", title: "视频" }, videos: 1, pages: [page], onPlay: (selection: { startPage: unknown; pages: unknown[] }) => selections.push(selection) };
  context.renderPagesModal();
  assert.equal(list.children.length, 1);
  ((list.children[0] as unknown as RuntimeElement).children[0] as RuntimeElement).listeners.click();
  assert.equal(selections[0].startPage, page);
  assert.equal(selections[0].pages[0], page);
  assert.equal(context.pagesModalContext, null);
});

test("current pages opener forwards the selected page from its modal callback", () => {
  const page = { cid: 10 }, played: unknown[] = [];
  let callback: ((...args: unknown[]) => unknown) | undefined;
  const context = vm.createContext({ currentPlayableTrack: () => ({ bvid: "BV" }), hasMultipleCurrentPages: () => true,
    playerState: { currentPages: [page] }, playerPagesButton: {}, playCurrentVideoPage: (value: unknown) => played.push(value),
    openPagesModal: (video: unknown, count: number, pages: unknown[], onPlay: (...args: unknown[]) => unknown) => { assert.equal(count, 1); callback = onPlay; },
  });
  vm.runInContext(slice("video-pages.ts", "function openCurrentPagesModal(", "function closePagesModal("), context);
  context.openCurrentPagesModal();
  if (!callback) throw new Error("Expected callback is missing");
  callback({ startPage: page, pages: [page] });
  assert.deepEqual(played, [page]);
});

test("page advancement preserves shuffle rounds, sequential advancement and the round limit", () => {
  for (const [shuffle, limit, expected] of [[true, 0, true], [false, 0, true], [true, 1, false]]) {
    const loads: { keepPage?: boolean }[] = [], state = { shuffle, loopMode: "sequence", currentIndex: 0, queue: [{ bvid: "BV" }],
      currentPages: [{ cid: 1 }, { cid: 2 }], currentPageIndex: 0, currentDisplayTrack: {}, history: [] };
    const context = vm.createContext({ playerState: state, randomPageRound: null, libraryState: { disabledPages: new Map() },
      hasMultipleCurrentPages: () => true, loadCurrentTrack: (options: { keepPage?: boolean }) => loads.push(options),
      buildRandomPageRound: () => [1], isPageDisabled: () => false, readShuffleCollectionPrefs: () => ({ order: "random", limit }),
      takeRandomPageFromRound: () => ({ index: 1, remaining: [] }), findEnabledPageIndex: () => 1,
      currentVideoPage: () => state.currentPages[state.currentPageIndex], updatePlayerPagesButton() {},
    });
    vm.runInContext(slice("playback-core.ts", "function advancePageWithinCurrentBv(", "function retreatPageWithinCurrentBv("), context);
    assert.equal(context.advancePageWithinCurrentBv(), expected);
    assert.equal(state.currentPageIndex, expected ? 1 : 0);
    assert.equal(state.history.length, shuffle && expected ? 1 : 0);
    assert.equal(loads.length, expected ? 1 : 0);
    if (expected) assert.equal(loads[0].keepPage, true);
    if (shuffle) assert.equal(context.randomPageRound.playedCount, expected ? 2 : 1);
  }
});

test("playlist name dialog preserves create and rename contracts and ignores a missing rename target", async () => {
  for (const options of [{ mode: "create" }, { mode: "rename", playlist: { id: "p", name: "旧名" } }, { mode: "rename" }]) {
    let callback: ((...args: unknown[]) => unknown) | undefined;
    const calls: [string, Record<string, unknown>][] = [], input = runtimeElement(), primaryButton = runtimeElement(); input.value = "新名";
    const context = vm.createContext({ openLibraryModal() {}, createNameField: () => ({ field: runtimeElement(), input }),
      createLibraryActions: (label: string, fn: () => void) => { callback = fn; return { actions: runtimeElement(), primaryButton }; },
      validatePlaylistName: () => ({ ok: true, name: "新名" }), libraryModalBody: runtimeElement(), libraryModalStatus: {},
      libraryState: { playlists: [] }, invoke: async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return []; },
      renderLibraryViews() {}, closeLibraryModal() {},
    });
    vm.runInContext(slice("library-ui.ts", "function showPlaylistNameDialog(", "function createPlaylist("), context);
    context.showPlaylistNameDialog(options);
    if (!callback) throw new Error("Playlist action callback is missing");
    await callback();
    assert.equal(primaryButton.disabled, false);
    if (options.mode === "rename" && !options.playlist) assert.equal(calls.length, 0);
    else {
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], options.mode === "rename" ? "rename_playlist" : "create_playlist");
      assert.equal(calls[0][1].name, "新名");
      if (options.mode === "rename") assert.equal(calls[0][1].id, "p");
    }
  }
});

test("queue UI preserves all supported loop labels and ignores an unsupported missing mode", () => {
  const modes = [{ id: "sequence", label: "顺序播放" }, { id: "list", label: "列表循环" }, { id: "single", label: "单曲循环" }];
  for (const mode of ["sequence", "list", "single", "unsupported"]) {
    const button = runtimeElement(); button.title = "unchanged";
    const context = vm.createContext({ LOOP_MODES: modes, loopModeButton: button,
      playerState: { queue: [], currentIndex: -1, loopMode: mode, shuffle: false },
      searchState: { results: [] }, queueCount: {}, queuePosition: {}, previousButton: {}, nextButton: {}, shuffleToggle: {},
      searchResults: { querySelectorAll: () => [] }, homeRankingList: null,
      updateFavoriteButtons() {}, updateLibraryHighlights() {},
    });
    vm.runInContext(slice("playback-core.ts", "function updateQueueUi(", "function isFavorited("), context);
    context.updateQueueUi();
    const expected = mode === "sequence" ? "关闭循环" : modes.find((item) => item.id === mode)?.label ?? "unchanged";
    assert.equal(button.title, expected);
  }
});

test("mascot storage selection preserves null property conversion, defaults and none", () => {
  const kuro = {}, nullKey = {}, known = {};
  for (const [id, expected] of [[null, nullKey], ["known", known], ["unknown", kuro], ["none", "hidden"]]) {
    const rendered: unknown[] = [];
    const context = vm.createContext({ getSavedMascotId: () => id, MASCOTS: { kuro, null: nullKey, known },
      renderMascot: (mascot: unknown) => rendered.push(mascot), hideMascot: () => rendered.push("hidden"),
    });
    vm.runInContext(slice("mascot.ts", "  const savedMascotId =", '  setState("idle");'), context);
    assert.deepEqual(rendered, [expected]);
  }
});
