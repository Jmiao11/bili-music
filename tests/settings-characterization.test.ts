import {attachSettingsControlPorts} from "./helpers/settings-controls-fixture.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { collectModuleGraph } from "./helpers/module-graph.ts";

type Transfer = { effectAllowed: string; dropEffect: string; setData(type: string, value: string): void };
type FixtureEvent = { type: string; target: LibraryNode; currentTarget: LibraryNode; dataTransfer?: Transfer | null; relatedTarget?: LibraryNode | null; key?: string; shiftKey?: boolean; detail?: unknown; defaultPrevented: boolean; stopped: boolean; immediate: boolean; preventDefault(): void; stopPropagation(): void; stopImmediatePropagation(): void };
class LibraryNode {
  checked = false; value = ""; textContent = ""; innerHTML = ""; className = ""; hidden = false; disabled = false; draggable = false; title = "";
  dataset: Record<string, string> = {}; attributes = new Map<string, string>(); classes = new Set<string>();
  children: LibraryNode[] = []; parent: LibraryNode | null = null;
  listeners = new Map<string, { callback: (event: FixtureEvent) => unknown; capture: boolean }[]>();
  style = { setProperty() {}, removeProperty() {} };
  paused = true; currentTime = 0; duration = 60; readyState = 1; src = "";
  tag: string;
  constructor(tag = "div") { this.tag = tag; }
  isConnected = true;
  get parentElement() { return this.parent; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  closest(selector: string): LibraryNode | null { return this.classList.contains(selector.slice(1)) ? this : this.parent?.closest(selector) ?? null; }
  get currentSrc() { return this.src; }
  classList = { add: (...xs: string[]) => { xs.forEach(x => this.classes.add(x)); }, remove: (...xs: string[]) => { xs.forEach(x => this.classes.delete(x)); }, contains: (x: string) => this.classes.has(x) || this.className.split(" ").includes(x), toggle: (x: string, force?: boolean) => { const on = force ?? !this.classes.has(x); if (on) this.classes.add(x); else this.classes.delete(x); return on; } };
  setAttribute(x: string, value: string) { this.attributes.set(x, value); }
  getAttribute(x: string) { return this.attributes.get(x) ?? null; }
  removeAttribute(x: string) { if (x === "src") this.src = ""; this.attributes.delete(x); }
  append(...nodes: (LibraryNode | string)[]) { for (const value of nodes) { const n = typeof value === "string" ? Object.assign(new LibraryNode("text"), { textContent: value }) : value; n.parent = this; this.children.push(n); } }
  prepend(...nodes: LibraryNode[]) { nodes.forEach(n => { n.parent = this; }); this.children.unshift(...nodes); }
  replaceChildren(...nodes: LibraryNode[]) { this.children = []; this.append(...nodes); }
  addEventListener(type: string, callback: (event: FixtureEvent) => unknown, capture: boolean | { capture?: boolean } = false) { const list = this.listeners.get(type) ?? []; list.push({ callback, capture: typeof capture === "boolean" ? capture : !!capture.capture }); this.listeners.set(type, list); }
  removeEventListener() {}
  async fire(type: string, fields: Partial<FixtureEvent> = {}) {
    const event: FixtureEvent = { type, target: this, currentTarget: this, defaultPrevented: false, stopped: false, immediate: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.immediate = true; this.stopped = true; }, ...fields };
    const chain: LibraryNode[] = []; for (let n: LibraryNode | null = this; n; n = n.parent) chain.push(n);
    const invoke = async (n: LibraryNode, capture: boolean) => { event.currentTarget = n; for (const h of n.listeners.get(type) ?? []) { if (h.capture === capture) await h.callback(event); if (event.immediate) break; } };
    for (const n of [...chain].reverse()) { await invoke(n, true); if (event.stopped) return event; }
    for (const n of chain) { await invoke(n, false); if (event.stopped) break; }
    return event;
  }
  querySelectorAll(selector: string): LibraryNode[] { return this.children.flatMap(n => [n, ...n.querySelectorAll("*")]).filter(n => selector === "*" || selector.startsWith(".") && n.classList.contains(selector.slice(1)) || selector === "button.track" && n.tag === "button" && n.classList.contains("track") || selector === n.tag || selector === "button:not([disabled])" && n.tag === "button" && !n.disabled || selector === 'button[aria-current="true"]' && n.tag === "button" && n.getAttribute("aria-current") === "true"); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  contains(n: LibraryNode | null): boolean { return n === this || this.children.some(child => child.contains(n)); }
  pause() { this.paused = true; } load() {} async play() { this.paused = false; }
  focus() { (globalThis.document as unknown as { activeElement: LibraryNode }).activeElement = this; } select() {} scrollIntoView() {}
  click() { void this.fire("click"); }
  *[Symbol.iterator](): IterableIterator<LibraryNode> {}
}
function deferred() { let resolve: (value: unknown) => void = () => {}; let reject: (error: unknown) => void = () => {}; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const track = (i: number) => ({ bvid: "BV" + String(i).padStart(10, "0"), title: "曲目" + i, uploader: "作者", thumbnailUrl: "", durationSeconds: 60, addedAt: "2026-01-01" });
const actions = ["previous", "playPause", "next", "volumeUp", "volumeDown"];
async function fixture(saved: [string, string][] = []) {
  const source = path.join(import.meta.dirname, "../ui"), rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "bili-settings-characterization-"));
  const nodes = new Map<string, LibraryNode>(), writes: [string, string | null][] = [], reads: string[] = [], storage = new Map(saved), frames: (() => void)[] = [], timers = new Map<number, { callback: () => void; delay: number }>(); let serial = 0;
  const node = (selector: string) => { if (!nodes.has(selector)) nodes.set(selector, new LibraryNode(selector === "#audio" ? "audio" : "div")); return nodes.get(selector)!; };
  const themes = ["dark", "light", "image", "dynamic"].map(theme => Object.assign(new LibraryNode("button"), { dataset: { themeOption: theme } }));
  const accents = ["pink", "blue", "purple", "green", "orange", "cyan"].map(value => Object.assign(new LibraryNode("input"), { value, nextElementSibling: { style: {} } }));
  const nav = ["home", "search", "favorites", "playlists", "local"].map(view => Object.assign(new LibraryNode("button"), { dataset: { view } }));
  const records = actions.map(shortcutAction => Object.assign(new LibraryNode("button"), { dataset: { shortcutAction } }));
  const clears = actions.map(shortcutClear => Object.assign(new LibraryNode("button"), { dataset: { shortcutClear } }));
  const groups: Record<string, LibraryNode[]> = { ".nav-item[data-view]": nav, "[data-theme-option]": themes, "[data-accent-color]": accents, "[data-shortcut-action]": records, "[data-shortcut-clear]": clears, ".image-only": [new LibraryNode()] };
  const win = new LibraryNode(), doc = { documentElement: node("root"), activeElement: new LibraryNode(), querySelector: node, querySelectorAll: (selector: string) => groups[selector] ?? [], createElement: (tag: string) => new LibraryNode(tag), hidden: false };
  const css = new Map<string, string>(); doc.documentElement.style = { setProperty(key: string, value: string) { css.set(key, value); }, removeProperty(key: string) { css.delete(key); } };
  const auto = new LibraryNode("option"); node("#stream-source-select").append(auto); const query = node("#stream-source-select").querySelector.bind(node("#stream-source-select")); node("#stream-source-select").querySelector = selector => selector === 'option[value="auto"]' ? auto : query(selector);
  const calls: { command: string; args: Record<string, unknown> }[] = [], events: { type: string; detail?: unknown }[] = [];
  let reply: (command: string, args: Record<string, unknown>) => Promise<unknown> = async command => { if (command === "load_background_image") throw Error("不存在"); return command === "get_shortcuts" ? { bindings: Object.fromEntries(actions.map(a => [a, null])) } : command === "get_yt_dlp_availability" ? { available: true } : command === "get_stream_source" ? "auto" : command === "get_audio_cache_settings" ? { enabled: true, maxBytes: 100 } : command === "get_audio_cache_usage" ? { bytes: 0, items: 0 } : command === "get_ai_config" ? { apiFormat: "openai-chat-completions", baseUrl: "地址", model: "模型", hasKey: false, keyHint: "" } : []; };
  const globals = new Map<string, PropertyDescriptor | undefined>(), mutations: (() => void)[] = [];
  const install = (name: string, value: unknown) => { globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  const invoke = (command: string, args: Record<string, unknown> = {}) => { calls.push({ command, args }); return reply(command, args); };
  const setTimer = (callback: () => void, delay: number) => { const id = ++serial; timers.set(id, { callback, delay }); return id; };
  install("document", doc); install("HTMLElement", LibraryNode); install("MutationObserver", class { constructor(callback: () => void) { mutations.push(callback); } observe() {} });
  install("window", { __TAURI__: { core: { invoke }, event: { listen: () => new Promise(() => {}) } }, addEventListener: win.addEventListener.bind(win), removeEventListener(type: string, callback: unknown) { win.listeners.set(type, (win.listeners.get(type) ?? []).filter(h => h.callback !== callback)); }, dispatchEvent(event: { type: string; detail?: unknown }) { events.push(event); return true; }, setTimeout: setTimer, clearTimeout: (id: number) => timers.delete(id), recordPlaybackDiag() {} });
  install("localStorage", { getItem(key: string) { reads.push(key); return storage.get(key) ?? null; }, setItem(key: string, value: string) { writes.push([key, value]); storage.set(key, value); }, removeItem(key: string) { writes.push([key, null]); storage.delete(key); } });
  install("sessionStorage", { getItem: () => null }); install("setTimeout", setTimer); install("clearTimeout", (id: number) => timers.delete(id)); install("requestAnimationFrame", (callback: () => void) => { frames.push(callback); return frames.length; }); install("navigator", {});
  const warn = console.warn; console.warn = () => {};
  const dispose = () => { console.warn = warn; for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } fs.rmSync(rootPath, { recursive: true, force: true }); };
  try {
    for (const name of collectModuleGraph(source, ["features/settings/appearance.ts"])) { fs.mkdirSync(path.dirname(path.join(rootPath, name)), {recursive:true}); fs.copyFileSync(path.join(source, name), path.join(rootPath, name)); } fs.writeFileSync(path.join(rootPath, "package.json"), '{"type":"module"}');
    for (const name of ["features/playback/playback-core.ts", "features/library/library-ui.ts"]) { const exports = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, name), "utf8"))![1].split(",").map(x => x.trim()).filter(Boolean); fs.writeFileSync(path.join(rootPath, name), exports.map(x => 'function '+x+'() {}').join("\n")+'\nexport { '+exports.join(", ")+' };'); }
    const portContext = {document:doc,root:doc.documentElement,themeOptions:themes,accentColorOptions:accents,shortcutRecordButtons:records,shortcutClearButtons:clears,imageOnlyGroups:groups[".image-only"],autoSource:auto};
    const renderControls = attachSettingsControlPorts(portContext);
    install("__settingsFixtureRegister", Reflect.get(portContext,"installSettingsCallbacks"));
    fs.appendFileSync(path.join(rootPath,"features/settings/root-settings.ts"), '\nconst registerSettingsForFixture=installSettingsCallbacks; installSettingsCallbacks=function(next){registerSettingsForFixture(next);globalThis.__settingsFixtureRegister(next);};\n');
    const composition = await import(pathToFileURL(path.join(rootPath, "store/application-store.ts")).href);
    composition.initializeApplicationStore({ invoke, setTimeout: setTimer, clearTimeout: (id: number) => timers.delete(id), report() {}, settings: (await import(pathToFileURL(path.join(rootPath, "features/settings/settings-adapter.ts")).href)).createSettingsPlatform() }, snapshot => renderControls(snapshot.settings));
    const appearance = await import(pathToFileURL(path.join(rootPath, "features/settings/appearance.ts")).href) as { startAppearance(): void }; appearance.startAppearance();
    const policy = await import(pathToFileURL(path.join(rootPath, "features/playback/playback-policy.ts")).href) as { readShuffleCollectionPrefs(): { order: string; limit: number } };
    const h = { node, doc, css, storage, writes, reads, calls, events, themes, accents, nav, records, clears, auto, policy, dispose,
      reply(next: typeof reply) { reply = next; }, async flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); while (frames.length) frames.shift()?.(); mutations.forEach(callback => callback()); },
      async fireWindow(type: string, fields: Record<string, unknown> = {}) { return win.fire(type, fields); }, async expire() { for (const [id, timer] of [...timers]) if (timer.delay === 3000) { timers.delete(id); timer.callback(); } await h.flush(); }
    }; await h.flush(); return h;
  } catch (error) { dispose(); throw error; }
}
const k = (name: string) => "bilibili-music." + name;
async function open(h: Awaited<ReturnType<typeof fixture>>) { await h.node("#open-settings-button").fire("click"); await h.flush(); }

test("settings themes restore defaults and switch all four themes with exact storage reads and writes", async () => {
  for (const saved of [[], [[k("theme"), "invalid"]]] as [string, string][][]) { const h = await fixture(saved); try { assert.equal(h.doc.documentElement.dataset.theme, "dark"); assert.deepEqual(h.writes, []); } finally { h.dispose(); } }
  const h = await fixture(); try {
    for (const theme of h.themes) { h.reads.length = 0; h.writes.length = 0; await theme.fire("click"); await h.flush(); assert.equal(h.doc.documentElement.dataset.theme, theme.dataset.themeOption); assert.deepEqual(h.writes, [[k("theme"), theme.dataset.themeOption]]); assert.deepEqual(h.reads, theme.dataset.themeOption === "dynamic" ? [] : [k("glass-blur"), k("panel-alpha"), k("background-dim")]); assert.equal(h.css.has("--glass-blur"), theme.dataset.themeOption !== "dynamic"); }
  } finally { h.dispose(); }
});
test("settings accents sliders persist exact keys values order and theme channel variants", async () => {
  const h = await fixture(); try {
    await h.accents[1].fire("change"); await h.flush(); assert.equal(h.css.get("--accent-r"), "122"); await h.themes[1].fire("click"); await h.flush(); assert.equal(h.css.get("--accent-r"), "40");
    h.writes.length = 0; for (const [id, value] of [["glass-blur", "100"], ["panel-alpha", "5"], ["background-dim", "0"]]) { h.node("#"+id+"-slider").value = value; await h.node("#"+id+"-slider").fire("input"); }
    assert.deepEqual(h.writes, [[k("glass-blur"), "80"], [k("panel-alpha"), "20"], [k("background-dim"), "40"]]); assert.equal(h.css.get("--panel-alpha"), "0.2"); assert.equal(h.css.get("--background-dim"), "0.4");
  } finally { h.dispose(); }
});
test("settings background choice cancellation failure reset and restore keep exact write order", async () => {
  const h = await fixture(); try {
    const image = { path: "fixture.png", displayName: "背景", dataUrl: "data:image/png;base64,AA==", width: 20, height: 30 }; h.reply(async () => image); h.writes.length = 0; await h.node("#choose-background-button").fire("click");
    assert.equal(h.css.get("--app-background"), 'url("data:image/png;base64,AA==")'); assert.deepEqual(h.writes, [[k("background-path"), "fixture.png"], [k("theme"), "image"]]); assert.equal(h.node("#background-name").textContent, "背景 · 20×30");
    await h.node("#reset-background-button").fire("click"); assert.equal(h.css.has("--app-background"), false); assert.deepEqual(h.writes.at(-1), [k("background-path"), null]);
    h.reply(async () => null); await h.node("#choose-background-button").fire("click"); assert.equal(h.node("#appearance-status").textContent, "");
    h.reply(async () => { throw Error("失败"); }); await h.node("#choose-background-button").fire("click"); assert.match(h.node("#appearance-status").textContent, /背景设置失败/); assert.equal(h.node("#choose-background-button").disabled, false);
  } finally { h.dispose(); }
  const failed = await fixture([[k("background-path"), "missing.png"]]); try { assert.match(failed.node("#appearance-status").textContent, /背景已回退/); assert.deepEqual(failed.writes, [[k("background-path"), null]]); } finally { failed.dispose(); }
});
test("settings stream switch availability fallback and failure restore preserve command order", async () => {
  const h = await fixture(); try {
    h.reply(async (command, args) => command === "get_yt_dlp_availability" ? { available: false } : command === "get_stream_source" ? "auto" : command === "set_stream_source" ? args.source : []); h.calls.length = 0; await open(h);
    assert.deepEqual(h.calls.filter(c => /stream_source|yt_dlp/.test(c.command)).map(c => c.command), ["get_yt_dlp_availability", "get_stream_source", "set_stream_source"]); assert.equal(h.node("#stream-source-select").value, "guest"); assert.equal(h.auto.disabled, true);
    h.calls.length = 0; h.node("#stream-source-select").value = "auto"; await h.node("#stream-source-select").fire("change"); assert.equal(h.calls.length, 0); assert.equal(h.node("#stream-source-select").value, "guest");
    h.reply(async (_command, args) => args.source ?? "guest"); await h.node("#stream-source-select").fire("change"); assert.equal(h.node("#stream-source-select").disabled, false); assert.equal(h.node("#stream-source-status").textContent, "当前：游客直连");
    h.reply(async command => { if (command === "set_stream_source") throw Error("切换失败"); return command === "get_yt_dlp_availability" ? { available: true } : "guest"; }); await h.node("#stream-source-select").fire("change"); assert.equal(h.node("#stream-source-select").value, "guest"); assert.equal(h.node("#stream-source-select").disabled, false);
  } finally { h.dispose(); }
});
test("settings cache saves rolls back failures and expires clear status after 3000ms", async () => {
  const h = await fixture(); try {
    await open(h); h.reply(async (command, args) => command === "set_audio_cache_settings" ? { enabled: args.enabled, maxBytes: args.maxBytes } : command === "get_audio_cache_usage" ? { bytes: 1048576, items: 2 } : []);
    h.node("#audio-cache-enabled").checked = false; h.node("#audio-cache-capacity").value = "200"; await h.node("#audio-cache-enabled").fire("change"); assert.deepEqual(h.calls.findLast(c => c.command === "set_audio_cache_settings")?.args, { enabled: false, maxBytes: 200 }); assert.equal(h.node("#audio-cache-usage").textContent, "1.0 MB · 2 首");
    h.reply(async () => { throw Error("失败"); }); h.node("#audio-cache-enabled").checked = true; h.node("#audio-cache-capacity").value = "300"; await h.node("#audio-cache-capacity").fire("change"); assert.equal(h.node("#audio-cache-enabled").checked, false); assert.equal(h.node("#audio-cache-capacity").value, "200"); assert.match(h.node("#audio-cache-status").textContent, /保存失败/);
    h.reply(async command => command === "get_audio_cache_usage" ? { bytes: 0, items: 0 } : []); await h.node("#clear-audio-cache-button").fire("click"); assert.equal(h.node("#audio-cache-status").textContent, "缓存已清空"); await h.expire(); assert.equal(h.node("#audio-cache-status").textContent, "");
  } finally { h.dispose(); }
});
test("settings collection preferences read each policy call and persist raw selected values", async () => {
  const h = await fixture(); try {
    h.reads.length = 0; assert.deepEqual(h.policy.readShuffleCollectionPrefs(), { order: "random", limit: 0 }); assert.deepEqual(h.reads, [k("shuffle-collection-order"), k("shuffle-collection-limit")]);
    for (const [id, value] of [["shuffle-collection-order", "sequential"], ["shuffle-collection-limit", "3"]]) { h.node("#"+id).value = value; await h.node("#"+id).fire("change"); }
    assert.deepEqual(h.writes.slice(-2), [[k("shuffle-collection-order"), "sequential"], [k("shuffle-collection-limit"), "3"]]); assert.deepEqual(h.policy.readShuffleCollectionPrefs(), { order: "sequential", limit: 3 });
    h.storage.set(k("shuffle-collection-order"), "invalid"); h.storage.set(k("shuffle-collection-limit"), "invalid"); assert.deepEqual(h.policy.readShuffleCollectionPrefs(), { order: "random", limit: 0 });
  } finally { h.dispose(); }
});
test("settings five shortcuts record save escape outside cancel clear and conflict failures", async () => {
  const h = await fixture(); try {
    for (const [index, button] of h.records.entries()) { h.reply(async () => []); await button.fire("click"); assert.equal(button.classList.contains("is-recording"), true); await h.fireWindow("keydown", { code: "KeyA", ctrlKey: true }); await h.flush(); assert.equal(h.calls.at(-1)?.command, "set_shortcuts"); assert.equal((h.calls.at(-1)?.args.bindings as Record<string, string>)[actions[index]], "Ctrl+A"); assert.equal(button.classList.contains("is-recording"), false); }
    await h.records[0].fire("click"); await h.fireWindow("keydown", { code: "Escape" }); assert.equal(h.records[0].classList.contains("is-recording"), false);
    await h.records[1].fire("click"); await h.fireWindow("pointerdown"); assert.equal(h.records[1].classList.contains("is-recording"), false);
    h.reply(async () => { throw Error("快捷键冲突"); }); await h.records[2].fire("click"); await h.fireWindow("keydown", { code: "KeyB", ctrlKey: true }); await h.flush(); assert.equal(h.node("#appearance-status").textContent, "Error: 快捷键冲突"); assert.equal(h.records[2].textContent, "Ctrl+A");
    h.reply(async () => []); await h.clears[0].fire("click"); await h.flush(); assert.equal(h.records[0].textContent, "未设置");
  } finally { h.dispose(); }
});
test("settings AI restore save test success failure keep key input lifecycle and event order", async () => {
  const h = await fixture(); try {
    await open(h); assert.equal(h.node("#ai-api-key-input").value, ""); assert.equal(h.node("#ai-config-status").textContent, "API Key 未配置"); h.node("#ai-api-key-input").value = "synthetic-settings-key";
    h.reply(async command => command === "test_ai_connection" ? { ok: true, message: "ok" } : { hasKey: true, keyHint: "***" }); h.calls.length = 0; await h.node("#save-ai-config-button").fire("click"); assert.deepEqual(h.calls.map(c => c.command), ["test_ai_connection", "set_ai_config"]); assert.equal(h.node("#ai-api-key-input").value, ""); assert.equal(h.node("#ai-config-status").textContent, "连接正常，配置已保存。"); assert.equal(h.events.at(-1)?.type, "ai-config-updated");
    h.node("#ai-api-key-input").value = "synthetic-settings-key"; h.reply(async () => ({ ok: false, message: "拒绝" })); h.calls.length = 0; await h.node("#save-ai-config-button").fire("click"); assert.equal(h.calls.length, 1); assert.equal(h.node("#ai-api-key-input").value, "synthetic-settings-key"); assert.equal(h.node("#save-ai-config-button").disabled, false);
    h.reply(async () => ({ ok: true, message: "ok" })); await h.node("#test-ai-connection-button").fire("click"); assert.equal(h.node("#ai-config-status").textContent, "AI 连接正常。"); assert.equal(h.node("#ai-api-key-input").value, "synthetic-settings-key");
    h.reply(async () => { throw Error("失败"); }); await h.node("#test-ai-connection-button").fire("click"); assert.match(h.node("#ai-config-status").textContent, /AI 连接测试失败/); assert.equal(h.node("#test-ai-connection-button").disabled, false);
  } finally { h.dispose(); }
});
test("settings navigation dispatches exact viewchange and panel keeps transition and focus behavior", async () => {
  const h = await fixture(); try {
    for (const button of h.nav) { await button.fire("click"); assert.equal(h.node("#view-"+button.dataset.view).hidden, false); assert.deepEqual(h.events.at(-1)?.detail, { view: button.dataset.view }); }
    assert.equal(h.node("#view-placeholder").hidden, false); assert.equal(h.node("#placeholder-title").textContent, "本地音乐开发中");
    await open(h); assert.equal(h.node("#settings-modal").classList.contains("is-open"), true); h.node("#settings-modal").append(h.node("#close-settings-button")); h.node("#close-settings-button").focus(); await h.node("#close-settings-button").fire("click"); assert.equal(h.doc.activeElement, h.node("#open-settings-button")); assert.equal(h.node("#settings-modal").classList.contains("is-open"), false); await h.node("#settings-modal").fire("transitionend"); assert.equal(h.node("#settings-modal").hidden, true);
  } finally { h.dispose(); }
});