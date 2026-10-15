import { createApplicationStore } from "./app-state.ts";
import type { HomeAdapter } from "./app-state.ts";

type ApplicationStore = ReturnType<typeof createApplicationStore>;
type ApplicationSnapshot = ReturnType<ApplicationStore["getState"]>;
let applicationStore: ApplicationStore | null = null;

function createRootStore(adapter: HomeAdapter, renderRoot: (snapshot: ApplicationSnapshot) => void): ApplicationStore {
  const store = createApplicationStore(adapter);
  store.subscribe(renderRoot);
  renderRoot(store.getState());
  return store;
}
function initializeApplicationStore(adapter: HomeAdapter, renderRoot: (snapshot: ApplicationSnapshot) => void): ApplicationStore {
  if (applicationStore) throw new Error("Application store is already initialized");
  applicationStore = createRootStore(adapter, renderRoot);
  return applicationStore;
}
function readApplicationStore(): ApplicationStore {
  if (!applicationStore) throw new Error("Application root must mount before controllers");
  return applicationStore;
}

export { createRootStore, initializeApplicationStore, readApplicationStore };
export type { ApplicationSnapshot, ApplicationStore };
