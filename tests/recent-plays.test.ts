import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/store/app-state.ts";
import type { HomeAdapter } from "../ui/store/app-state.ts";
import { formatPlayedAt, recentItems, recentPage } from "../ui/features/recent/recent-state.ts";
import { installRecentController } from "../ui/features/recent/recent-controller.ts";

const item = (bvid: string, time = "1", cid: number | null = 22): CommandContract.PlayHistoryItem => ({ bvid, lastPlayedAt: time, title: "曲目", uploader: "作者", thumbnailUrl: "", durationSeconds: 90, count: 1, lastCid: cid, lastPage: 2, lastPartName: "第二P" });
function fixture() {
  const calls: { command: string; args: unknown }[] = [];
  let reply: (command: string) => Promise<unknown> = async command => command === "get_play_history" ? [item("BV1234567890")] : command === "check_audio_cache" ? [true] : null;
  const adapter: HomeAdapter = { invoke: ((command: string, args: unknown) => { calls.push({ command, args }); return reply(command); }) as HomeAdapter["invoke"], setTimeout: () => 0, clearTimeout() {}, report() {} };
  const store = createApplicationStore(adapter, { freeze: true });
  return { store, calls, reply(fn: typeof reply) { reply = fn; } };
}
test("recent history sorts by last play, keeps one BV and the existing cap", () => {
  const rows = recentItems([item("BV1234567890", "10", 11), item("BV9999999999", "20"), item("bv1234567890", "30")]);
  assert.deepEqual(rows.map(row => [row.bvid, row.lastCid]), [["bv1234567890", 22], ["BV9999999999", 22]]);
  assert.equal(recentItems(Array.from({ length: 210 }, (_, i) => item(`BV${i}`))).length, 200);
  assert.equal(recentPage(item("BV1234567890", "1", null)), null);
  assert.deepEqual(recentPage(rows[0]), { cid: 22, page: 2, part: "第二P", durationSeconds: 90 });
});
test("recent time labels use local calendar days across year and DST boundaries", () => {
  const now = new Date(2026, 0, 1, 15, 0);
  const label = (date: Date) => formatPlayedAt(String(+date), now);
  assert.equal(label(new Date(2026, 0, 1, 14, 20)), "今天 14:20");
  assert.equal(label(new Date(2025, 11, 31, 0, 1)), "昨天");
  assert.equal(label(new Date(2025, 9, 26)), "10-26");
  assert.equal(formatPlayedAt("bad", now), "—");
});
test("late cache and history results cannot overwrite a new query", async () => {
  const h = fixture();
  let resolve: (value: unknown) => void = () => {};
  await h.store.actions.recent.load(() => "highest", 1);
  h.reply(() => new Promise(yes => { resolve = yes; }));
  const old = h.store.actions.recent.refreshCache("highest");
  h.reply(async () => [false]);
  await h.store.actions.recent.refreshCache("64k");
  resolve([true]); await old;
  assert.equal(h.store.getState().recent.cached.size, 0);
  h.reply(() => new Promise(yes => { resolve = yes; }));
  const oldLoad = h.store.actions.recent.load(() => "highest", 2);
  h.reply(async command => command === "get_play_history" ? [] : []);
  await h.store.actions.recent.load(() => "64k", 3);
  resolve([item("BV9999999999")]); await oldLoad;
  assert.deepEqual(h.store.getState().recent.items, []);
});
test("page controller owns online/offline listeners only while recent is visible, with event-based cache refresh", async () => {
  const h = fixture(), target = new EventTarget();
  Object.defineProperty(target, "navigator", { value: { onLine: false } });
  const added: string[] = [], removed: string[] = [];
  const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
  target.addEventListener = (type, callback, options) => { added.push(type); add(type, callback, options); };
  target.removeEventListener = (type, callback, options) => { removed.push(type); remove(type, callback, options); };
  const stop = installRecentController(h.store, target as Window);
  assert.deepEqual(added, []);
  h.store.actions.settings.navigate("recent");
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(added, ["online", "offline"]);
  assert.equal(h.store.getState().recent.online, false);
  assert.equal(h.store.getState().recent.cached.size, 1);
  h.store.actions.settings.setAudioQuality("64k");
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(h.calls.at(-1)?.args, { tracks: [{ bvid: "BV1234567890", cid: 22 }], quality: "64k" });
  const before = h.calls.filter(call => call.command === "check_audio_cache").length;
  await h.store.actions.settings.clearCache();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.calls.filter(call => call.command === "check_audio_cache").length, before + 1);
  h.store.actions.settings.navigate("favorites");
  assert.deepEqual(removed, ["online", "offline"]);
  (target as unknown as { navigator: { onLine: boolean } }).navigator.onLine = true;
  target.dispatchEvent(new Event("online"));
  assert.equal(h.store.getState().recent.online, false);
  stop();
});
