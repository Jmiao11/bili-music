import vm from "node:vm";
import { createStateStore } from "../../ui/state-store.ts";
import { createPlaybackQueueActions, initialPlaybackQueueState } from "../../ui/playback-queue-state.ts";

// Legacy VM fixtures remain mutable test inputs; every queue operation executes the real frozen store/actions.
function createQueueContext(seed: vm.Context, options?: vm.CreateContextOptions): vm.Context {
  const context = vm.createContext(seed, options);
  const fields = Object.keys(initialPlaybackQueueState()) as (keyof ReturnType<typeof initialPlaybackQueueState>)[];
  let lastInput = "";
  const makeStore = (initial: ReturnType<typeof initialPlaybackQueueState>) => createStateStore(initial, createPlaybackQueueActions, { freeze: true });
  let store = makeStore(initialPlaybackQueueState());
  const fixture = () => vm.runInContext('typeof playerState === "undefined" ? {} : playerState', context) as Record<string, unknown>;
  const inputs = () => {
    const state = fixture(), values: Record<string, unknown> = { ...initialPlaybackQueueState() };
    for (const key of fields) if (key in state) values[key] = structuredClone(state[key]);
    if ("queuePlaylistId" in state) values.playlistId = state.queuePlaylistId;
    const round = vm.runInContext('typeof randomPageRound === "undefined" ? null : randomPageRound', context);
    values.randomPageRound = structuredClone(round);
    return values as ReturnType<typeof initialPlaybackQueueState>;
  };
  function synchronize() {
    const values = inputs(), serialized = JSON.stringify(values);
    if (serialized !== lastInput) { store = makeStore(values); lastInput = serialized; }
  }
  function publish() {
    const state = fixture(), next = store.getState(), before = JSON.parse(lastInput);
    for (const key of fields) {
      if (key === "randomPageRound") {
        if (JSON.stringify(before[key]) !== JSON.stringify(next[key])) context.randomPageRound = structuredClone(next[key]);
      } else if (JSON.stringify(before[key]) !== JSON.stringify(next[key]) || !(key in state)) {
        state[key] = structuredClone(next[key]);
      }
    }
    if ("queuePlaylistId" in state) state.queuePlaylistId = next.playlistId;
    lastInput = JSON.stringify(inputs());
  }
  context.getQueueSnapshot = () => { synchronize(); return store.getState(); };
  context.getQueueActions = () => new Proxy(store.actions, { get(_target, name) {
    return (...args: unknown[]) => {
      synchronize();
      const action = Reflect.get(store.actions, name);
      const result: unknown = Reflect.apply(action, store.actions, args); publish(); return result;
    };
  } });
  return context;
}

export { createQueueContext };
