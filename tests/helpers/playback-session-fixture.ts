import vm from "node:vm";
import { createApplicationStore } from "../../ui/app-state.ts";
import { createPlaybackCommands } from "../../ui/playback-commands.ts";
import { createMediaAdapter } from "../../ui/media-adapter.ts";
import { createRequestContext } from "./playback-request-fixture.ts";

// shortcut: bridges legacy mutable fixtures; remove with playerState in state-9 or the Vue migration.
function createSessionContext(seed: vm.Context, options?: vm.CreateContextOptions): vm.Context {
  type SessionState = ReturnType<ReturnType<typeof createApplicationStore>["getState"]>["playbackSession"];
  const fields = ["currentPages","lastEmittedTrackIdentity","playRecordedForCurrentTrack","cacheRequestedForCurrentTrack","pendingResume","resumeInProgress","lastPlaybackStateSavedAt","recoveryVersion","recoveryAttempts","playingAudioVersion","playbackIntended","pendingPastedBvPages","loudnessQueryVersion","loudnessAnalyzedForCurrentTrack"] as const;
  const methods = {"currentPages":"setCurrentPages","lastEmittedTrackIdentity":"setTrackIdentity","playRecordedForCurrentTrack":"setPlayRecorded","cacheRequestedForCurrentTrack":"setCacheRequested","pendingResume":"setPendingResume","resumeInProgress":"setResumeInProgress","lastPlaybackStateSavedAt":"setLastSavedAt","recoveryVersion":"setRecoveryVersion","recoveryAttempts":"setRecoveryAttempts","playingAudioVersion":"setPlayingVersion","playbackIntended":"setPlaybackIntended","pendingPastedBvPages":"setPendingPastedPages","loudnessAnalyzedForCurrentTrack":"setLoudnessAnalyzed","loudnessQueryVersion":"setLoudnessQueryVersion"} as const;
  const makeStore = () => createApplicationStore({ invoke: async () => { throw Error("Unexpected session fixture command"); }, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true });
  const store = typeof seed.getApplicationStore === "function" ? seed.getApplicationStore() as ReturnType<typeof createApplicationStore> : makeStore();
  let context: vm.Context, depth = 0;
  const observed = new Map<string, unknown>();
  const wrappers = new WeakMap<Function, Function>();
  const fixture = () => vm.runInContext('typeof playerState === "undefined" ? {} : playerState', context) as Record<string, unknown>;

  // All fourteen fields: legacy fixture -> real actions before a business call/event/command settlement;
  // committed state -> the same legacy input after its sync phase and Promise settlement.
  // Pages/identity use playerState; other legacy variables use their original VM bindings.
  // Promise/media/timer handles never enter the snapshot; unchanged inputs cannot replace async commits.
  const signature = (value: unknown) => typeof value === "object" && value !== null ? JSON.stringify(value) : value;
  function input(field: keyof SessionState) {
    if (field === "currentPages" || field === "lastEmittedTrackIdentity") return fixture()[field];
    return vm.runInContext(field, context) as unknown;
  }
  function enter() {
    for (const field of fields) {
      const value = input(field);
      if (value !== undefined && !Object.is(signature(value), observed.get(field))) {
        Reflect.apply(store.actions.playbackSession[methods[field]], store.actions.playbackSession, [structuredClone(value)]);
      }
    }
  }
  function leave() {
    const state = fixture(), next = store.getState().playbackSession;
    for (const field of fields) {
      const value = structuredClone(next[field]);
      if (field === "currentPages" || field === "lastEmittedTrackIdentity") state[field] = value;
      else { context.__sessionValue = value; vm.runInContext(field + " = __sessionValue", context); delete context.__sessionValue; }
      observed.set(field, signature(value));
    }
  }
  for (const field of fields) if (field !== "currentPages" && field !== "lastEmittedTrackIdentity" && !(field in seed)) seed[field] = structuredClone(store.getState().playbackSession[field]);
  function boundary(original: Function): Function {
    const existing = wrappers.get(original); if (existing) return existing;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const outer = depth++ === 0;
      let result: unknown;
      try { if (outer) enter(); result = Reflect.apply(original, this, args); }
      finally { depth--; if (outer) leave(); }
      if (outer && result && typeof (result as Promise<unknown>).then === "function") void (result as Promise<unknown>).then(leave, leave);
      return result;
    };
    wrappers.set(original, wrapped); wrappers.set(wrapped, wrapped); return wrapped;
  }
  // Legacy controller stubs can write fixture inputs before an await; import at their return boundary.
  for (const name of ["loadPagesForCurrentVideo", "resetCurrentPageState"]) if (typeof seed[name] === "function") {
    const original = seed[name];
    seed[name] = function (this: unknown, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args); enter();
      if (result && typeof (result as Promise<unknown>).then === "function") void (result as Promise<unknown>).then(enter, enter);
      return result;
    };
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
  const targets = new WeakSet<object>();
  function observeTarget(target: vm.Context | null | undefined) {
    if (!target?.addEventListener || targets.has(target)) return;
    targets.add(target);
    const add = target.addEventListener, remove = target.removeEventListener;
    target.addEventListener = function (type: string, listener: Function, ...args: unknown[]) { return Reflect.apply(add, this, [type, boundary(listener), ...args]); };
    if (remove) target.removeEventListener = function (type: string, listener: Function, ...args: unknown[]) { return Reflect.apply(remove, this, [type, wrappers.get(listener) ?? listener, ...args]); };
  }
  for (const target of [seed.audio, seed.window, seed.searchForm]) observeTarget(target);
  // Only session data is bridged; request URLs remain private in the existing request fixture.
  seed.getSessionSnapshot = () => store.getState().playbackSession;
  seed.getSessionActions = () => store.actions.playbackSession;
  if (typeof seed.getApplicationStore !== "function") seed.getApplicationStore = () => store;
  context = createRequestContext(new Proxy(seed, { defineProperty(target, key, descriptor) {
    if (descriptor.value && typeof descriptor.value === "object") observeTarget(descriptor.value);
    if (typeof descriptor.value === "function" && !/^get(?:Queue|Request|Session)(?:Snapshot|Actions)$/.test(String(key))) descriptor.value = boundary(descriptor.value);
    return Reflect.defineProperty(target, key, descriptor);
  } }), options);
  // Explicit VM ports use the actual controller factory; no button click is fabricated.
  context.createPlaybackCommands = createPlaybackCommands;
  if (typeof context.getPlaybackCommands !== "function") {
    const resolve = (name: string) => vm.runInContext(name, context);
    const media = () => typeof context.getPlaybackMedia === "function" ? context.getPlaybackMedia() : createMediaAdapter(context.playerAudio ?? context.audio);
    context.getPlaybackCommands = () => createPlaybackCommands({
      session: () => context.getSessionSnapshot(), resume: () => resolve("resumePendingPlayback")(),
      shuffle: () => context.getQueueSnapshot().shuffle,
      retreat: () => resolve("retreatPageWithinCurrentBv")(), advance: () => resolve("advancePageWithinCurrentBv")(),
      previous: () => resolve("playPrevious")(), next: () => resolve("playNext")(),
      clearResume: () => resolve("clearPendingResume")(), clearNotice: () => resolve("clearPlaybackNotice")(),
      media, observe: () => media().getObservation(),
      setSeeking: value => resolve("getPlaybackDisplayActions")().setSeeking(value), syncPosition: () => resolve("syncMediaSessionPosition")(),
      diagnostic: (kind, message) => context.window?.recordPlaybackDiag?.(kind, message),
      status: message => { (context.playbackStatus ?? context.status).textContent = message; },
    });
  }
  return context;
}

export { createSessionContext };
