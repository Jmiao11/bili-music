import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createApplicationStore } from "../../ui/app-state.ts";
import { stripModuleSyntax } from "./module-syntax.ts";

function createMessagesFixture() {
  const classes = new Set<string>(), timers = new Map<number, { callback: () => void; delay: number }>();
  const events: { type: string; text: string; visible: boolean }[] = [];
  const handlers = new Map<string, (() => void)[]>();
  let timerId = 0;
  const status = { textContent: "准备就绪。" };
  const playbackNotice = { textContent: "", dataset: {} as Record<string, string>, style: { setProperty() {} },
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name), contains: (name: string) => classes.has(name) } };
  const store = createApplicationStore({ invoke: async () => { throw Error("Unexpected fixture command"); }, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const context = vm.createContext({ status, playbackNotice, Event, result: {}, ResizeObserver: class { observe() {} },
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
  vm.runInContext(read("playback-notice.ts"), context);
  vm.runInContext(read("library-view.ts"), context);
  vm.runInContext(read("pages-view.ts"), context);
  context.renderPagesModal = () => {};
  context.refreshPageCountBadges = () => {};
  context.pagesModal = { hidden: true, classList: { add() {}, remove() {} }, setAttribute() {} };
  context.requestAnimationFrame = () => 0;
  let previous = store.getState();
  store.subscribe(state => {
    context.renderLibrarySnapshot(state.library, previous.library, {});
    context.renderPagesSnapshot(state.pages, state.library, { pages: previous.pages, library: previous.library }, {});
    previous = state;
  });
  const core = read("playback-core.ts"), begin = core.indexOf('window.addEventListener("bilibili-music-notice-change"');
  vm.runInContext(core.slice(begin, core.indexOf("\n});", begin) + 4), context);
  return { context, status, playbackNotice, store, timers, events, handlers,
    show: (text: string, options: { persistent?: boolean; kind?: "info" | "error" } = {}) => context.showPlaybackNotice(text, options),
    clear: () => context.clearPlaybackNotice(),
    expire: () => { const pending = [...timers]; timers.clear(); for (const [, timer] of pending) timer.callback(); },
  };
}
export { createMessagesFixture };
