import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore, isHomePopular } from "../ui/store/app-state.ts";
import type { HomeAdapter, HomeSnapshot } from "../ui/store/app-state.ts";

const track = { bvid: "BV1234567890", title: "曲目", uploader: "作者", thumbnailUrl: "", durationSeconds: 60 };
function fixture() {
  const calls: { command: string; args: unknown }[] = [];
  const reports: unknown[][] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextId = 0;
  let reply: (command: string) => Promise<unknown> = async command => command === "get_ai_config" ? { hasKey: true } : [track];
  const adapter: HomeAdapter = {
    invoke: ((command: string, args: unknown) => { calls.push({ command, args }); return reply(command); }) as HomeAdapter["invoke"],
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    report(...args) { reports.push(args); },
  };
  const store = createApplicationStore(adapter, { freeze: true });
  return { store, calls, reports, timers, reply(next: typeof reply) { reply = next; } };
}

test("home actions run without DOM and commit complete loading and success snapshots", async () => {
  assert.equal("document" in globalThis, false);
  assert.equal("window" in globalThis, false);
  const h = fixture();
  const original = h.store.getState();
  const phases: HomeSnapshot[] = [];
  h.store.subscribe(state => phases.push(state.home));
  await h.store.actions.loadHomeRanking();
  assert.equal(phases.length, 2);
  assert.equal(phases[0].loading, true);
  assert.equal(phases[0].view.refreshDisabled, true);
  assert.equal(phases[1].loading, false);
  assert.equal(phases[1].loaded, true);
  assert.equal(phases[1].view.refreshDisabled, false);
  assert.equal(original.home.ranking.length, 0);
  assert.equal(phases[0].ranking.length, 0);
  assert.equal(phases[1].ranking.length, 1);
  assert.throws(() => { (phases[1] as unknown as { mode: string }).mode = "ranking"; }, TypeError);
  await h.store.actions.loadHomeRanking();
  assert.equal(h.calls.length, 1);
  await h.store.actions.loadHomeRanking({ forceRefresh: true });
  assert.deepEqual(h.calls[1], { command: "get_music_ranking", args: { forceRefresh: true } });
});

test("home actions copy only changed paths and key absence selects the popular ranking", async () => {
  const h = fixture();
  const before = h.store.getState();
  h.store.actions.setHomeHint("要求");
  const after = h.store.getState();
  assert.equal(after.home.ranking, before.home.ranking);
  assert.equal(after.home.recommendations, before.home.recommendations);
  assert.equal(after.home.view, before.home.view);
  h.reply(async command => command === "get_ai_config" ? { hasKey: false } : [track]);
  await h.store.actions.refreshAiKeyState();
  assert.equal(isHomePopular(h.store.getState().home), true);
  assert.deepEqual(h.calls.map(call => call.command), ["get_ai_config", "get_music_ranking"]);
});

test("home actions preserve saved read caching including an empty failed read", async () => {
  const h = fixture();
  h.reply(async () => { throw new Error("saved failure"); });
  await h.store.actions.loadRecommendationHome();
  assert.equal(h.store.getState().home.recommendationLoaded, true);
  assert.equal(h.store.getState().home.recommendationError, "");
  await h.store.actions.loadRecommendationHome();
  assert.equal(h.calls.length, 1);
  const k = fixture();
  await k.store.actions.refreshAiKeyState();
  await k.store.actions.loadRecommendationHome();
  assert.deepEqual(k.calls.map(call => call.command), ["get_ai_config", "get_saved_recommendations"]);
});

test("home actions generation trims hint and releases its timer and controls on success and timeout", async () => {
  const h = fixture();
  await h.store.actions.loadRecommendations({ userHint: "  安静  " });
  assert.deepEqual(h.calls[0], { command: "get_recommendations", args: { userHint: "安静" } });
  assert.equal(h.timers.size, 0);
  await h.store.actions.loadRecommendations();
  assert.equal(h.calls.length, 1);
  h.reply(() => new Promise(() => {}));
  const pending = h.store.actions.loadRecommendations({ forceRefresh: true });
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 95000);
  timer.callback(); await pending;
  const home = h.store.getState().home;
  assert.equal(home.recommendationError, "request timeout");
  assert.equal(home.recommendationLoading, false);
  assert.equal(home.view.hintDisabled, false);
  assert.equal(home.view.refreshDisabled, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.reports.length, 1);
});

test("home actions keep ranking failure semantics and isolate listener failures from completion", async () => {
  const h = fixture();
  const seen: boolean[] = [];
  h.reply(async () => { throw new Error("ranking failure"); });
  h.store.subscribe(state => seen.push(state.home.loading));
  await h.store.actions.loadHomeRanking();
  assert.deepEqual(seen, [true, false]);
  assert.equal(h.store.getState().home.view.rankingError?.text, "拉取失败，点击重试");
  assert.equal(h.reports.length, 1);
  const firstError = h.store.getState().home.view.rankingError;
  await h.store.actions.loadHomeRanking();
  assert.notEqual(h.store.getState().home.view.rankingError, firstError, "repeated hidden failures must repaint even after a recommendation render clears the DOM text");
  const errors: unknown[] = [];
  const store = createApplicationStore({
    invoke: async () => [track] as never,
    setTimeout: () => 1, clearTimeout() {}, report() {},
  }, { freeze: true, onSubscriberError: error => errors.push(error) });
  store.subscribe(() => { throw new Error("subscriber"); });
  store.subscribe(state => seen.push(state.home.loading));
  await store.actions.loadHomeRanking();
  assert.equal(errors.length, 2);
  assert.equal(store.getState().home.loaded, true);
  assert.deepEqual(seen.slice(-2), [true, false]);
});
