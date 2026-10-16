type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends ReadonlySet<infer V> ? ReadonlySet<DeepReadonly<V>>
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

type StoreOptions = { freeze?: boolean; onSubscriberError?: (error: unknown) => void };

function freezeStateSnapshot<T>(value: T, seen: WeakMap<object, object>): T {
  if (value === null || typeof value !== "object") return value;
  const previous = seen.get(value);
  if (previous) return previous as T;
  if (value instanceof Map || value instanceof Set) {
    const target = value instanceof Map ? new Map<unknown, unknown>() : new Set<unknown>();
    const proxy = new Proxy(target, {
      get(collection, key) {
        if (["set", "add", "delete", "clear"].includes(String(key))) {
          return () => { throw new TypeError("State snapshot is readonly"); };
        }
        if (key === "valueOf") return () => proxy;
        if (key === "forEach") return (callback: (value: unknown, key: unknown, owner: object) => void, thisArg?: unknown) => {
          collection.forEach((entry, entryKey) => callback.call(thisArg, entry, entryKey, proxy));
        };
        const member: unknown = Reflect.get(collection, key, collection);
        return typeof member === "function" ? member.bind(collection) : member;
      },
    });
    seen.set(value, proxy);
    seen.set(proxy, proxy);
    if (value instanceof Map && target instanceof Map) {
      for (const [key, entry] of value) target.set(freezeStateSnapshot(key, seen), freezeStateSnapshot(entry, seen));
    } else if (value instanceof Set && target instanceof Set) {
      for (const entry of value) target.add(freezeStateSnapshot(entry, seen));
    }
    return Object.freeze(proxy) as T;
  }
  const copy = Array.isArray(value) ? [...value] : { ...value };
  seen.set(value, copy);
  seen.set(copy, copy);
  for (const key of Reflect.ownKeys(copy)) {
    if (key !== "length") Reflect.set(copy, key, freezeStateSnapshot(Reflect.get(copy, key), seen));
  }
  return Object.freeze(copy) as T;
}

function createStateStore<S extends object, A>(
  initialState: S,
  createActions: (getState: () => DeepReadonly<S>, commit: (next: DeepReadonly<S>) => void) => A,
  { freeze = false, onSubscriberError = (error: unknown) => console.error("State subscriber failed:", error) }: StoreOptions = {},
) {
  const frozen = new WeakMap<object, object>();
  let snapshot: DeepReadonly<S> = freeze ? freezeStateSnapshot(initialState, frozen) as DeepReadonly<S> : initialState as DeepReadonly<S>;
  const listeners = new Set<(state: DeepReadonly<S>) => void>();
  const getState = () => snapshot;
  const commit = (next: DeepReadonly<S>) => {
    snapshot = freeze ? freezeStateSnapshot(next, frozen) : next;
    const committed = snapshot;
    for (const listener of [...listeners]) {
      try { listener(committed); }
      catch (error) {
        try { onSubscriberError(error); }
        catch (reportError) { console.error("State subscriber error reporter failed:", reportError, error); }
      }
    }
  };
  const subscribe = (listener: (state: DeepReadonly<S>) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  return { getState, subscribe, actions: createActions(getState, commit) };
}

export { createStateStore };
export type { DeepReadonly, StoreOptions };
