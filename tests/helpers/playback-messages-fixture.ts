import { mountPlaybackFixtureRoot } from "./playback-root-fixture.ts";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { afterEach } from "node:test";
import { projectPlaybackMessages } from "../../ui/features/playback/playback-messages-projection.ts";
import { createApplicationStore } from "../../ui/store/app-state.ts";
import { stripModuleSyntax } from "./module-syntax.ts";

function mountMessagePort(context: vm.Context, store: ReturnType<typeof createApplicationStore>): void {
  let previous = store.getState().playbackMessages;
  store.subscribe(() => {
    const state = store.getState().playbackMessages, model = projectPlaybackMessages(state);
    if (state.statusVersion > previous.statusVersion) context.status.textContent = model.status;
    if (state.notice.version > previous.notice.version) {
      if (model.kind !== null) context.playbackNotice.dataset.kind = model.kind;
      context.playbackNotice.textContent = model.notice;
      context.playbackNotice.classList[model.visible ? "add" : "remove"]("is-visible");
    }
    if (model.x !== null) context.playbackNotice.style?.setProperty("--playback-notice-x", `${model.x}px`);
    previous = state;
  });
}

const fixtureErrors: unknown[] = [];
afterEach(() => assert.deepEqual(fixtureErrors.splice(0), [], "Message fixture reported an unexpected error"));

function createMessagesFixture(beforeMount?: (store: ReturnType<typeof createApplicationStore>) => void) {
  const classes = new Set<string>(), timers = new Map<number, { callback: () => void; delay: number }>();
  const events: { type: string; text: string; visible: boolean }[] = [];
  const handlers = new Map<string, (() => void)[]>();
  let timerId = 0;
  const status = { textContent: "准备就绪。" };
  const playbackNotice = { textContent: "", dataset: {} as Record<string, string>, style: { setProperty() {} },
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name), contains: (name: string) => classes.has(name) } };
  const store = createApplicationStore({ invoke: async () => { throw Error("Unexpected fixture command"); }, setTimeout: () => 0, clearTimeout() {}, report(level, message, error) { fixtureErrors.push({ level, message, error }); } }, { freeze: true, onSubscriberError: error => fixtureErrors.push(error) });
  const context = vm.createContext({ console: { ...console, error: (...args: unknown[]) => fixtureErrors.push(args), warn: (...args: unknown[]) => fixtureErrors.push(args) }, status, playbackNotice, Event, result: {}, ResizeObserver: class { observe() {} },
    resumePlayPauseButton: { getBoundingClientRect: () => ({ left: 100, width: 40 }) },
    getApplicationStore: () => store,
    clearTimeout: (id: number) => timers.delete(id),
    window: { setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
      addEventListener: (name: string, callback: () => void) => handlers.set(name, [...handlers.get(name) ?? [], callback]),
      dispatchEvent: (event: Event) => { events.push({ type: event.type, text: playbackNotice.textContent, visible: classes.has("is-visible") }); for (const callback of handlers.get(event.type) ?? []) callback(); return true; } },
    getSessionSnapshot: () => store.getState().playbackSession, getSessionActions: () => store.actions.playbackSession,
    getRequestSnapshot: () => store.getState().playbackRequest,
  });
  const read = (file: string) => stripModuleSyntax(fs.readFileSync(path.join(import.meta.dirname, "../../ui", file), "utf8"), "ui/" + file);
  vm.runInContext(read("features/playback/playback-messages.ts"), context);
  context.playbackBarNode=context.result;
  mountMessagePort(context, store);
  beforeMount?.(store);
  context.getPlaybackMessagesActions();
  vm.runInContext(read("features/playback/playback-notice.ts"), context);
  const core = read("features/playback/playback-core.ts"), begin = core.indexOf('window.addEventListener("bilibili-music-notice-change"');
  vm.runInContext(core.slice(begin, core.indexOf("\n});", begin) + 4), context);
  return { context, status, playbackNotice, store, timers, events, handlers,
    show: (text: string, options: { persistent?: boolean; kind?: "info" | "error" } = {}) => context.showPlaybackNotice(text, options),
    clear: () => context.clearPlaybackNotice(),
    expire: () => { const pending = [...timers]; timers.clear(); for (const [, timer] of pending) timer.callback(); },
  };
}
function wirePlaybackMessagesContext(context: vm.Context): void {
  context.status ??= context.playbackStatus ?? context.document?.querySelector?.("#status");
  context.playbackNotice ??= context.document?.querySelector?.("#playback-notice");
  const store = context.getApplicationStore();
  if (!context.__renderFixtureRoot) mountPlaybackFixtureRoot(context, store);
  for (const file of ["features/playback/playback-messages.ts"]) {
    vm.runInContext(stripModuleSyntax(fs.readFileSync(path.join(import.meta.dirname, "../../ui", file), "utf8"), "ui/" + file), context);
  }
}
export { createMessagesFixture, wirePlaybackMessagesContext };
