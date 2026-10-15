import vm from "node:vm";
import { createApplicationStore } from "../../ui/app-state.ts";
import { createQueueContext } from "./playback-queue-fixture.ts";

// shortcut: bridges legacy mutable fixtures; remove with playerState in state-9 or the Vue migration.
function createRequestContext(seed: vm.Context, options?: vm.CreateContextOptions): vm.Context {
  type RequestState = ReturnType<ReturnType<typeof createApplicationStore>["getState"]>["playbackRequest"];
  const fields = ["requestVersion", "activeAudioVersion", "activeAudioUrl", "audioActivatedAt", "consecutiveResolveFailures"] as const;
  const makeStore = (initial?: RequestState) => createApplicationStore({ invoke: async () => { throw Error("Unexpected request fixture command"); }, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true, playbackRequest: initial });
  let store = makeStore(), context: vm.Context, depth = 0;
  const observed = new Map<string, unknown>();
  const wrappers = new WeakMap<Function, Function>();
  const fixture = () => vm.runInContext('typeof playerState === "undefined" ? {} : playerState', context) as Record<string, unknown>;

  // All five fields: fixture -> formal frozen initial state before a business function/event;
  // store -> fixture immediately after its synchronous phase and again after async completion.
  // Unchanged fixture inputs never overwrite a stage committed while an older Promise was pending.
  // requestVersion and failures carry test input/stage output; active version, private source,
  // and activation time carry test identity input and activation/invalidation output at those boundaries.
  function enter() {
    const state = fixture(), next = { ...store.getState().playbackRequest };
    let changed = false;
    for (const field of fields) if (field in state && !Object.is(state[field], observed.get(field))) {
      Reflect.set(next, field, state[field]); changed = true;
    }
    if (changed) store = makeStore(next);
  }
  function leave() {
    const state = fixture(), next = store.getState().playbackRequest;
    for (const field of fields) { state[field] = next[field]; observed.set(field, next[field]); }
  }
  function boundary(original: Function): Function {
    const existing = wrappers.get(original); if (existing) return existing;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const outer = depth === 0;
      if (outer) enter();
      depth++;
      let result: unknown;
      try { result = Reflect.apply(original, this, args); }
      finally { depth--; if (outer) leave(); }
      if (outer && result && typeof (result as Promise<unknown>).then === "function") void (result as Promise<unknown>).then(leave, leave);
      return result;
    };
    wrappers.set(original, wrapped); wrappers.set(wrapped, wrapped); return wrapped;
  }
  // A command settlement is the explicit boundary before an awaiting controller resumes.
  if (seed.invoke) {
    const invoke = seed.invoke;
    seed.invoke = function (this: unknown, ...args: unknown[]) {
      const result = Reflect.apply(invoke, this, args);
      const settled = () => { enter(); leave(); };
      if (result && typeof (result as Promise<unknown>).then === "function") void (result as Promise<unknown>).then(settled, settled);
      return result;
    };
  }
  // Event callbacks are business entry boundaries too; preserve callback removal and listener order.
  for (const target of [seed.audio, seed.window]) if (target?.addEventListener) {
    const add = target.addEventListener, remove = target.removeEventListener;
    target.addEventListener = function (type: string, listener: Function, ...args: unknown[]) { return Reflect.apply(add, this, [type, boundary(listener), ...args]); };
    if (remove) target.removeEventListener = function (type: string, listener: Function, ...args: unknown[]) { return Reflect.apply(remove, this, [type, wrappers.get(listener) ?? listener, ...args]); };
  }
  // URL remains private runtime data; no debug snapshot, serialization, output or error includes it.
  seed.getRequestSnapshot = () => store.getState().playbackRequest;
  seed.getRequestActions = () => store.actions.playbackRequest;
  context = createQueueContext(new Proxy(seed, { defineProperty(target, key, descriptor) {
    if (typeof descriptor.value === "function" && key !== "__renderFixtureRoot" && !/^get(?:Queue|Request)(?:Snapshot|Actions)$/.test(String(key))) descriptor.value = boundary(descriptor.value);
    return Reflect.defineProperty(target, key, descriptor);
  } }), options);
  return context;
}

export { createRequestContext };
