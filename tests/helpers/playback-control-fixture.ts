import { createSessionContext } from "./playback-session-fixture.ts";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { createApplicationStore } from "../../ui/app-state.ts";
import { moduleDeclarations, stripModuleSyntax } from "./module-syntax.ts";

type FixtureEvent = { type: string; detail?: unknown; prevented: boolean; immediate: boolean; preventDefault(): void; stopImmediatePropagation(): void };
class DisplayNode {
  value = "0"; max = "0"; textContent = ""; dataset: Record<string, string> = {}; attributes = new Map<string, string>(); progress = "";
  currentTime = 0; duration = NaN; paused = true; ended = false; playbackRate = 1; currentSrc = "fixture"; volume = 1; src = "fixture";
  operations: string[] = []; rejectPlay = false; disabled = false;
  listeners = new Map<string, { callback: (event: FixtureEvent) => unknown; capture: boolean }[]>();
  style = { setProperty: (_key: string, value: string) => { this.progress = value; } };
  classList = { contains: () => false };
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  addEventListener(type: string, callback: (event: FixtureEvent) => unknown, capture = false) { const list = this.listeners.get(type) ?? []; list.push({ callback, capture }); this.listeners.set(type, list); }
  removeEventListener() {}
  async fire(type: string, fields = {}) {
    const event: FixtureEvent = { type, prevented: false, immediate: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediate = true; }, ...fields };
    for (const capture of [true, false]) for (const handler of this.listeners.get(type) ?? []) { if (handler.capture !== capture) continue; await handler.callback(event); if (event.immediate) return event; }
    return event;
  }
  click() { if (this.disabled) return; this.operations.push("click"); void this.fire("click"); }
  async play() { this.operations.push("play"); if (this.rejectPlay) throw Error("unavailable"); this.paused = false; await this.fire("play"); }
  pause() { this.operations.push("pause"); this.paused = true; void this.fire("pause"); }
  load() {}
}

async function createPlaybackControlFixture() {
  const ui = path.join(import.meta.dirname, "../../ui"), source = fs.readFileSync(path.join(ui, "appearance.ts"), "utf8"), nodes = new Map<string, DisplayNode>();
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new DisplayNode()); return nodes.get(id)!; };
  const windowNode = new DisplayNode(), handlers = new Map<string, (details: Record<string, number>) => void>(), positions: unknown[] = [], navigation: string[] = [];
  const events = new Map<string, (event: { payload: string }) => void>(), registration: string[] = [], invocations: string[] = [];
  const focused = node("input");
  // src-tauri/src/taskbar.rs:6 returns unit, serialized by Tauri as null.
  const invoke = async (command: string) => { invocations.push(command); return null; };
  const session = { metadata: null as unknown, playbackState: "none", setPositionState(value: unknown) { positions.push(JSON.parse(JSON.stringify(value))); }, setActionHandler(name: string, callback: (details: Record<string, number>) => void) { handlers.set(name, callback); } };
  const store = createApplicationStore({ invoke: async () => null, setTimeout: () => 0, clearTimeout() {}, report() {} });
  const context = createSessionContext({ document: { documentElement: node("root"), activeElement: focused, querySelector: node, querySelectorAll: () => [] },
    window: { __TAURI__: { core: { invoke }, event: { listen: async (name: string, handler: (event: { payload: string }) => void) => { registration.push(name); events.set(name, handler); return () => {}; } } }, addEventListener: windowNode.addEventListener.bind(windowNode), recordPlaybackDiag() {} },
    navigator: { mediaSession: session }, MediaMetadata: class { constructor(data: object) { Object.assign(this, data); } },
    getApplicationStore: () => store, choosePlaylistAndAdd() {}, showLoudnessNormalizationDialog() {}, syncImmersiveTrack() {}, console,
    pendingResume: false, resumeInProgress: false, resumes: 0, resumePendingPlayback() { context.resumes++; },
    playPrevious() { navigation.push("previous"); }, playNext() { navigation.push("next"); }, retreatPageWithinCurrentBv: () => false, advancePageWithinCurrentBv: () => false });
  // Explicitly load actual state/view/media dependencies from the appearance import graph, including future display modules.
  for (const declaration of moduleDeclarations(source, "ui/appearance.ts")) if (declaration.kind === "import" && /(?:playback-.*-(?:state|view)|media-adapter|playback-commands)\.ts$/.test(declaration.specifier)) {
    Object.assign(context, await import(pathToFileURL(path.join(ui, declaration.specifier)).href));
  }
  const erased = stripModuleSyntax(source, "ui/appearance.ts");
  vm.runInContext(erased.slice(0, erased.indexOf("function startAppearance()")), context);
  // Immersive cover/queue rendering is outside this fixture; time, buttons and Media Session remain real.
  context.syncImmersiveTrack = () => {};
  const core = stripModuleSyntax(fs.readFileSync(path.join(ui, "playback-core.ts"), "utf8"), "ui/playback-core.ts");
  vm.runInContext(core.slice(core.indexOf("function initPlaybackResume()"), core.indexOf("function initPlaybackPersistenceAndCache()")), context);
  context.resumePlayPauseButton = node("#play-pause-button"); context.initPlaybackResume();
  context.previousButton = node("#previous-button"); context.nextButton = node("#next-button");
  const main = stripModuleSyntax(fs.readFileSync(path.join(ui, "main.ts"), "utf8"), "ui/main.ts");
  vm.runInContext(main.slice(main.indexOf('previousButton.addEventListener("click"'), main.indexOf("initPlaybackResume();")), context);
  vm.runInContext(erased.slice(erased.indexOf('window.addEventListener("bilibili-music-trackchange", (event) => {', erased.indexOf("function startAppearance()")), erased.indexOf("initializeAccentColor();", erased.indexOf("function startAppearance()"))), context);
  vm.runInContext("updateProgress(0); updatePlayPauseButton(); registerMediaSessionActionHandlers(); initializeTaskbarControls(); initializeGlobalShortcutControls();", context);
  const audio = node("#audio"), flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { node, audio, session, handlers, positions, navigation, context, store, flush, events, registration, invocations, focused, track: (detail: unknown) => windowNode.fire("bilibili-music-trackchange", { detail }) };
}

export { createPlaybackControlFixture };
