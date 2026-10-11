import { onScopeDispose, shallowReadonly, shallowRef } from "vue";
import type { ShallowRef } from "vue";
import type { createApplicationStore } from "../app-state.ts";

type AppReader = Pick<ReturnType<typeof createApplicationStore>, "getState" | "subscribe">;
type AppSnapshot = ReturnType<AppReader["getState"]>;

function useAppState<T>(reader: AppReader, selector: (state: AppSnapshot) => T): Readonly<ShallowRef<T>> {
  const selected = shallowRef<T>(selector(reader.getState()));
  const unsubscribe = reader.subscribe(snapshot => {
    const next = selector(snapshot);
    if (!Object.is(selected.value, next)) selected.value = next;
  });
  onScopeDispose(unsubscribe);
  return shallowReadonly(selected);
}

export { useAppState };
export type { AppReader };
