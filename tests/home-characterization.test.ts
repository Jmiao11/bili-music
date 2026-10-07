import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { collectModuleGraph } from "./helpers/module-graph.ts";

class HomeNode {
  textContent = "";
  hidden = false;
  disabled = false;
  value = "";
  title = "";
  className = "";
  innerHTML = "";
  children: HomeNode[] = [];
  attributes = new Map<string, string>();
  classes = new Set<string>();
  dataset: Record<string, string> = {};
  activate?: (index: number, selection?: unknown) => void;
  classList = {
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
    toggle: (name: string, force?: boolean) => { const on = force ?? !this.classes.has(name); if (on) this.classes.add(name); else this.classes.delete(name); return on; },
  };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  replaceChildren(...nodes: HomeNode[]) { this.children = nodes; }
  append(...nodes: HomeNode[]) { this.children.push(...nodes); }
}

function deferred() {
  let resolve: (value: unknown) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const track = { bvid: "BV1234567890", title: "曲目甲", uploader: "作者", thumbnailUrl: "", durationSeconds: 60, playCount: 0, pubdate: 0, addedAt: "" };

async function loadHomeFixture() {
  const source = path.join(import.meta.dirname, "../ui");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-home-characterization-"));
  const names = ["homeCacheNote", "homeHintApply", "homeHintInput", "homeHintRow", "homeListLabel", "homePanel", "homeRankingError", "homeRankingList", "homeRankingStatus", "homeSetupHint", "homeSetupSub", "homeSetupTitle", "homeSourceLabel", "homeSubtitle", "homeTitle", "refreshRankingButton"];
  const nodes: Record<string, HomeNode> = Object.fromEntries(names.map(name => [name, new HomeNode()]));
  nodes.homeSetupHint.hidden = true;
  nodes.homeHintApply.textContent = "生成推荐";
  const tabs = ["recommendation", "ranking"].map(homeMode => { const node = new HomeNode(); node.dataset.homeMode = homeMode; return node; });
  const calls: { command: string; args: unknown }[] = [];
  const played: unknown[][] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  let queueUpdates = 0;
  let response: (command: string, args: unknown) => Promise<unknown> = async command => command === "get_ai_config" ? { hasKey: true } : [];
  const environment = {
    nodes, tabs,
    invoke(command: string, args: unknown) { calls.push({ command, args }); return response(command, args); },
    createTrackRow(_video: unknown, index: number, activate: (index: number, selection?: unknown) => void) { const row = new HomeNode(); row.activate = activate; row.value = String(index); return row; },
    playListItem(...args: unknown[]) { played.push(args); },
    updateQueueUi() { queueUpdates++; },
  };
  const globals = new Map<string, PropertyDescriptor | undefined>();
  function install(name: string, value: unknown) { globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); }
  install("__homeCharacterization", environment);
  install("document", { createElement: () => new HomeNode() });
  install("window", {
    setTimeout(callback: () => void, delay: number) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const savedWarn = console.warn;
  const savedError = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    for (const file of collectModuleGraph(source, ["home.ts"])) fs.copyFileSync(path.join(source, file), path.join(root, file));
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(root, "runtime-api.ts"), 'const invoke = globalThis.__homeCharacterization.invoke; export { invoke };');
    fs.writeFileSync(path.join(root, "player-dom.ts"), `const { ${names.join(", ")} } = globalThis.__homeCharacterization.nodes; const homeModeTabs = globalThis.__homeCharacterization.tabs; export { ${[...names, "homeModeTabs"].join(", ")} };`);
    fs.writeFileSync(path.join(root, "playback-core.ts"), 'const { createTrackRow, playListItem, updateQueueUi } = globalThis.__homeCharacterization; export { createTrackRow, playListItem, updateQueueUi };');
    const module = await import(pathToFileURL(path.join(root, "home.ts")).href) as { getApplicationStore(): { getState(): { search: { userKeyword: string; requestVersion: number; results: unknown[] } } }; updateHomeModeUi(): void; setHomeMode(mode: string): void; loadHomeRanking(options?: { forceRefresh?: boolean }): Promise<void>; refreshAiKeyState(): Promise<void>; loadRecommendationHome(): Promise<void>; loadRecommendations(options?: { forceRefresh?: boolean }): Promise<void> };
    const states = { ...await import(pathToFileURL(path.join(root, "player-state.ts")).href) } as { searchState: { userKeyword: string; requestVersion: number; results: unknown[] }; playerState: { queue: unknown[] } };
    module.updateHomeModeUi();
    states.searchState = module.getApplicationStore().getState().search;
    return {
      module, nodes, calls, played, states, timers,
      setResponse(next: typeof response) { response = next; },
      queueUpdates: () => queueUpdates,
      async flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); },
      dispose() {
        console.warn = savedWarn; console.error = savedError;
        for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    console.warn = savedWarn; console.error = savedError;
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test("home ranking caches nonempty results and force refresh preserves its request and busy UI", async () => {
  const h = await loadHomeFixture();
  try {
    h.setResponse(async () => [track]);
    h.module.setHomeMode("ranking"); await h.flush();
    assert.equal(h.nodes.homeRankingList.children.length, 1);
    const requests = h.calls.length;
    await h.module.loadHomeRanking();
    assert.equal(h.calls.length, requests);
    const next = deferred(); h.setResponse(() => next.promise);
    const pending = h.module.loadHomeRanking({ forceRefresh: true });
    assert.deepEqual(h.calls.at(-1), { command: "get_music_ranking", args: { forceRefresh: true } });
    assert.equal(h.nodes.refreshRankingButton.disabled, true);
    assert.equal(h.nodes.homeRankingStatus.textContent, "正在刷新音乐飙升榜…");
    assert.equal(h.nodes.homeRankingList.children.length, 8);
    assert.ok(h.nodes.homeRankingList.children.every(node => node.className.includes("skeleton-row")));
    next.resolve([]); await pending;
    assert.equal(h.nodes.refreshRankingButton.disabled, false);
    assert.equal(h.nodes.homeRankingList.children.length, 0);
    assert.equal(h.nodes.homeRankingStatus.textContent, "已加载 0 首音乐区热门视频。");
    h.setResponse(async () => [track]); await h.module.loadHomeRanking();
    assert.equal(h.calls.length, requests + 2, "empty ranking is not a cache hit");
  } finally { h.dispose(); }
});

test("home ranking failure leaves retry copy and no search fallback", async () => {
  const h = await loadHomeFixture();
  try {
    h.setResponse(async () => { throw new Error("ranking failed"); });
    h.module.setHomeMode("ranking"); await h.flush();
    assert.equal(h.nodes.homeRankingError.textContent, "拉取失败，点击重试");
    assert.equal(h.nodes.homeRankingStatus.textContent, "音乐飙升榜拉取失败。");
    assert.equal(h.nodes.homeRankingList.children.length, 0);
    assert.equal(h.nodes.refreshRankingButton.disabled, false);
    assert.deepEqual(h.calls.map(call => call.command), ["get_music_ranking"]);
  } finally { h.dispose(); }
});

test("home without API key uses popular ranking and keeps its silent failure semantics", async () => {
  const h = await loadHomeFixture();
  try {
    h.setResponse(async command => command === "get_ai_config" ? { hasKey: false } : [track]);
    await h.module.refreshAiKeyState();
    assert.deepEqual(h.calls.map(call => call.command), ["get_ai_config", "get_music_ranking"]);
    assert.equal(h.nodes.homeTitle.textContent, "热门音乐");
    assert.equal(h.nodes.homePanel.attributes.get("data-home-mode"), "popular");
    assert.equal(h.nodes.homeHintRow.hidden, true);
    assert.equal(h.nodes.homeSetupTitle.textContent, "配置 API Key 后可生成专属推荐");
    assert.equal(h.nodes.homeSetupHint.classes.has("is-inline"), true);
    h.setResponse(async () => { throw new Error("ranking failed"); });
    await h.module.loadHomeRanking({ forceRefresh: true });
    assert.equal(h.nodes.homeRankingError.textContent, "");
    assert.equal(h.nodes.homeRankingStatus.textContent, "");
  } finally { h.dispose(); }
});

test("home reads saved recommendations once and does not generate them automatically", async () => {
  const h = await loadHomeFixture();
  try {
    const saved = deferred();
    h.setResponse(async command => command === "get_ai_config" ? { hasKey: true } : saved.promise);
    const pending = h.module.refreshAiKeyState(); await h.flush();
    assert.equal(h.nodes.homeRankingStatus.textContent, "正在读取上次推荐…");
    assert.equal(h.nodes.homeHintApply.disabled, true);
    assert.equal(h.nodes.homeRankingList.children.length, 8);
    saved.resolve([track]); await pending;
    assert.equal(h.nodes.homeRankingStatus.textContent, "已加载 1 首上次推荐。");
    assert.equal(h.nodes.homeHintApply.disabled, false);
    await h.module.loadRecommendationHome();
    assert.deepEqual(h.calls.map(call => call.command), ["get_ai_config", "get_saved_recommendations"]);
  } finally { h.dispose(); }
});

test("home saved recommendation errors become an empty completed read", async () => {
  const h = await loadHomeFixture();
  try {
    h.setResponse(async () => { throw new Error("saved failed"); });
    await h.module.loadRecommendationHome();
    assert.equal(h.nodes.homeRankingStatus.textContent, "");
    assert.equal(h.nodes.homeRankingError.textContent, "");
    assert.equal(h.nodes.homeSetupHint.hidden, true);
    await h.module.loadRecommendationHome();
    assert.equal(h.calls.length, 1);
  } finally { h.dispose(); }
});

test("home generation trims the hint caches success and times out after 95000ms", async () => {
  const h = await loadHomeFixture();
  try {
    h.nodes.homeHintInput.value = "  安静一点  ";
    h.setResponse(async () => [track]);
    await h.module.loadRecommendations();
    assert.deepEqual(h.calls[0], { command: "get_recommendations", args: { userHint: "安静一点" } });
    assert.equal(h.nodes.homeRankingStatus.textContent, "已生成 1 首推荐。");
    assert.equal(h.timers.size, 0);
    await h.module.loadRecommendations(); assert.equal(h.calls.length, 1);
    h.setResponse(() => new Promise(() => {}));
    const pending = h.module.loadRecommendations({ forceRefresh: true });
    assert.equal(h.nodes.homeHintApply.textContent, "生成中…");
    assert.equal(h.nodes.homeRankingList.children.length, 8);
    const timeout = [...h.timers.values()].find(timer => timer.delay === 95000);
    assert.ok(timeout); timeout.callback(); await pending;
    assert.equal(h.nodes.homeSetupTitle.textContent, "推荐生成失败");
    assert.match(h.nodes.homeSetupSub.textContent, /^request timeout｜/);
    assert.equal(h.nodes.homeHintApply.textContent, "生成推荐");
    assert.equal(h.nodes.homeHintApply.disabled, false);
    assert.equal(h.nodes.refreshRankingButton.disabled, false);
    assert.equal(h.timers.size, 0);
  } finally { h.dispose(); }
});

test("home mode switches preserve tab labels and do not let a pending hidden ranking replace recommendations", async () => {
  const h = await loadHomeFixture();
  try {
    const ranking = deferred();
    h.setResponse(async command => command === "get_music_ranking" ? ranking.promise : [track]);
    h.module.setHomeMode("ranking");
    assert.equal(h.nodes.homeTitle.textContent, "音乐飙升榜");
    h.module.setHomeMode("recommendation"); await h.flush();
    assert.equal(h.nodes.homeTitle.textContent, "为你推荐");
    assert.equal(h.nodes.homeRankingList.children.length, 1);
    const row = h.nodes.homeRankingList.children[0];
    ranking.resolve([]); await h.flush();
    assert.equal(h.nodes.homeRankingList.children[0], row);
    assert.equal(h.nodes.homeRankingStatus.textContent, "已加载 0 首音乐区热门视频。", "shared status retains the existing completion order");
    h.module.setHomeMode("unexpected"); await h.flush();
    assert.equal(h.nodes.homeTitle.textContent, "音乐飙升榜");
  } finally { h.dispose(); }
});

test("home and search states stay isolated while ranking and recommendation clicks use existing playback entry", async () => {
  const h = await loadHomeFixture();
  try {
    h.states.searchState.userKeyword = "搜索原值";
    h.states.searchState.requestVersion = 9;
    h.states.searchState.results = [track];
    const before = JSON.stringify(h.states.searchState);
    h.setResponse(async () => [track]);
    h.module.setHomeMode("ranking"); await h.flush();
    const row = h.nodes.homeRankingList.children[0];
    row.activate?.(0, { startPage: { cid: 1 } });
    assert.equal(h.played[0][0], "ranking");
    assert.equal(h.played[0][2], 0);
    assert.deepEqual(h.played[0][3], { startPage: { cid: 1 } });
    assert.equal(JSON.stringify(h.states.searchState), before);
    assert.equal(h.states.playerState.queue.length, 0, "rendering does not start playback");
    h.module.setHomeMode("recommendation"); await h.flush();
    h.nodes.homeRankingList.children[0].activate?.(0);
    assert.equal(h.played[1][0], "recommendation");
    h.states.searchState.requestVersion++;
    const calls = h.calls.length;
    await h.module.loadRecommendationHome();
    assert.equal(h.calls.length, calls);
    assert.equal(h.nodes.homeRankingList.children.length, 1);
    assert.ok(h.queueUpdates() > 0);
  } finally { h.dispose(); }
});
