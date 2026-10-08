import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationStore } from "../ui/app-state.ts";
import type { HomeAdapter } from "../ui/app-state.ts";
function fixture() {
  const storage = new Map<string, string>(), writes: [string, string | null][] = [], calls: { command: string; args: unknown }[] = [], reports: unknown[] = [];
  let reply: (command: string, args: unknown) => Promise<unknown> = async () => [];
  let expired: (() => void) | null = null, cancellations = 0;
  const adapter: HomeAdapter = { invoke: ((command: string, args: unknown) => { calls.push({ command, args }); return reply(command, args); }) as HomeAdapter["invoke"], setTimeout: () => 0, clearTimeout() {}, report: (...args) => reports.push(args), settings: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => { writes.push([key, value]); storage.set(key, value); }, removeItem: key => { writes.push([key, null]); storage.delete(key); }, cancelCacheNotice() { cancellations++; expired = null; }, scheduleCacheNotice(callback) { expired = callback; },
  } };
  const store = createApplicationStore(adapter, { freeze: true, onSubscriberError: error => reports.push(error) });
  return { store, actions: store.actions.settings, read: () => store.getState().settings, storage, writes, calls, reports, reply(next: typeof reply) { reply = next; }, expire() { expired?.(); }, cancellations: () => cancellations };
}
function gate() { let resolve!: (value: unknown) => void; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const key = (name: string) => "bilibili-music." + name;

test("settings actions import without DOM retain immutable snapshots and isolate other domains", () => {
  assert.equal("document" in globalThis, false); assert.equal("window" in globalThis, false);
  const h = fixture(), before = h.store.getState(); h.actions.setTheme("invalid", false); h.actions.setAccent("blue", "dark"); h.actions.setSlider("blur", 120);
  assert.equal(h.read().theme, "dark"); assert.equal(h.read().glassBlur, 80); assert.equal(before.settings.theme, null); assert.equal(before.settings.accentColor, "pink");
  for (const domain of ["home", "search", "library", "pages"] as const) assert.equal(h.store.getState()[domain], before[domain]);
  assert.throws(() => (h.read().ai as { model: string }).model = "mutation", TypeError);
  assert.deepEqual(h.writes, [[key("accent-color"), "blue"], [key("glass-blur"), "80"]]);
});

test("settings actions preserve theme stages storage order and background copying", async () => {
  const h = fixture(), phases: string[] = []; h.store.subscribe(state => phases.push(String(state.settings.theme) + ":" + state.settings.glassBlur));
  h.storage.set(key("glass-blur"), "12"); h.storage.set(key("panel-alpha"), "50"); h.storage.set(key("background-dim"), "70"); h.actions.setTheme("image");
  assert.deepEqual(phases, ["image:40", "image:12", "image:12", "image:12"]); assert.equal(h.read().panelAlpha, 50); assert.deepEqual(h.writes, [[key("theme"), "image"]]);
  const image = { path: "test.png", displayName: "背景", width: 2, height: 3, dataUrl: "data:image/png;base64,AA" }; h.reply(async () => image); await h.actions.chooseBackground(); const snapshot = h.read(); image.width = 9;
  assert.equal(snapshot.background?.width, 2); assert.deepEqual(h.writes.slice(-2), [[key("background-path"), "test.png"], [key("theme"), "image"]]); h.actions.resetBackground(); assert.equal(snapshot.background?.width, 2); assert.equal(h.read().background, null); assert.equal(h.writes.at(-1)?.[1], null);
});

test("settings cache actions preserve failure rollback cancellation and transient clear notice", async () => {
  const h = fixture(); h.reply(async command => command === "get_audio_cache_settings" ? { enabled: true, maxBytes: 1024 } : { bytes: 0, items: 0 }); await h.actions.restoreCache(); const previous = h.read();
  h.reply(async () => { throw Error("失败"); }); await h.actions.saveCache(false, 2048); assert.equal(h.read().audioCacheSettings, previous.audioCacheSettings); assert.match(h.read().view.cache.status!.text, /保存失败/); assert.equal(h.read().view.cache.disabled, false);
  h.reply(async () => ({ bytes: 1048576, items: 1 })); await h.actions.clearCache(); assert.equal(h.read().view.cache.status!.text, "缓存已清空"); h.expire(); assert.equal(h.read().view.cache.status!.text, ""); assert.equal(h.cancellations(), 3);
});

test("settings actions keep stream fallback command order and repeat explicit value restoration", async () => {
  const h = fixture(); h.reply(async (command, args) => command === "get_yt_dlp_availability" ? { available: false } : command === "get_stream_source" ? "auto" : (args as { source: string }).source); await h.actions.restoreSource();
  assert.deepEqual(h.calls.map(c => c.command), ["get_yt_dlp_availability", "get_stream_source", "set_stream_source"]); const previous = h.read(); await h.actions.changeSource("auto"); assert.equal(h.calls.length, 3); assert.equal(h.read().view.stream.value, "guest"); assert.equal(h.read().view.stream.valueVersion, previous.view.stream.valueVersion + 1);
});

test("settings actions normalize collection preferences and preserve raw persistence values", () => {
  const h = fixture(); h.actions.restoreCollection("bad", "03"); assert.deepEqual(h.read().collection, { order: "random", limit: 0 }); h.actions.saveCollection("order", "sequential"); h.actions.saveCollection("limit", "3");
  assert.deepEqual(h.read().collection, { order: "sequential", limit: 3 }); assert.deepEqual(h.writes, [[key("shuffle-collection-order"), "sequential"], [key("shuffle-collection-limit"), "3"]]);
});

test("settings shortcut actions isolate conflicts retain bindings and recording snapshots", async () => {
  const h = fixture(); h.actions.beginRecording("next"); const recording = h.read(); h.actions.cancelRecording(); assert.equal(recording.recordingShortcutAction, "next"); assert.equal(h.read().recordingShortcutAction, null);
  h.reply(async () => { throw Error("冲突"); }); await h.actions.saveShortcut("next", "Ctrl+N"); assert.equal(h.read().shortcutBindings.next, null); assert.match(h.read().view.notice!.text, /冲突/);
  h.reply(async () => ({})); await h.actions.saveShortcut("next", "Ctrl+N"); assert.equal(h.read().shortcutBindings.next, "Ctrl+N");
});

test("settings AI save and connection tests serialize every snapshot without temporary secrets", async () => {
  const h = fixture(), secret = "state6-synthetic-api-key-private", second = "state6-replaced-api-key-private", serialized: string[] = [];
  const capture = () => { const json = JSON.stringify(h.store.getState()); serialized.push(json); assert.equal(json.includes(secret), false); assert.equal(json.includes(second), false); }; capture(); h.store.subscribe(capture);
  const input = { apiFormat: "openai-chat-completions", baseUrl: "loopback", model: "模型", apiKey: secret };
  h.reply(async command => command === "test_ai_connection" ? { ok: true, message: secret } : { hasKey: true, keyHint: secret }); let eventBusy: boolean | null = null;
  await h.actions.saveAi(input, () => ({ ...input, apiKey: second }), () => { eventBusy = h.read().view.ai.saveDisabled; }); assert.equal(eventBusy, true); assert.equal(h.read().view.ai.clearKeyVersion, 1); assert.equal(h.read().ai.hasKey, true); assert.equal(h.read().view.ai.saveDisabled, false);
  assert.equal((h.calls.at(-1)!.args as { apiKey: string }).apiKey, second);
  h.reply(async () => ({ ok: false, message: secret })); await h.actions.saveAi(input); await h.actions.testAi(input); assert.match(h.read().view.ai.text!, /已隐藏/); assert.equal(h.read().view.ai.clearKeyVersion, 1);
  h.reply(async () => { throw Error(secret); }); await h.actions.saveAi(input); await h.actions.testAi(input); assert.equal(h.read().ai.request, "idle"); assert.deepEqual(h.reports, []);
  h.reply(async () => ({ ok: true, message: "正常" })); await h.actions.testAi(input); assert.equal(h.read().view.ai.text, "AI 连接正常。"); assert.equal(serialized.length, 19); assert.deepEqual(h.reports, []);
});

test("settings AI save rereads input after connection succeeds without retaining either key", async () => {
  const h = fixture(), pending = gate(), secret = "state6-initial-private-key", later = "state6-later-private-key";
  const snapshots: string[] = []; h.store.subscribe(state => snapshots.push(JSON.stringify(state)));
  h.reply(async command => command === "test_ai_connection" ? pending.promise : { hasKey: true });
  const saving = h.actions.saveAi({ apiFormat: "openai-chat-completions", baseUrl: "old", model: "old", apiKey: secret }, () => ({ apiFormat: "anthropic-messages", baseUrl: "new", model: "new", apiKey: later }));
  assert.equal(h.read().ai.request, "saving"); pending.resolve({ ok: true }); await saving; assert.deepEqual(h.calls.at(-1)!.args, { apiFormat: "anthropic-messages", baseUrl: "new", model: "new", apiKey: later });
  for (const json of snapshots) { assert.equal(json.includes(secret), false); assert.equal(json.includes(later), false); }
});

