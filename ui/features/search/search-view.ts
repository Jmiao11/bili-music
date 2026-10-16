import type { SearchSnapshot } from "./search-state.ts";
type SearchRowBindings = { renderRows(search: SearchSnapshot): void };

function renderSearchSnapshot(search: SearchSnapshot, previous: SearchSnapshot | null, bindings: SearchRowBindings): boolean {
  const view = search.view;
  if (view.rowsVersion !== null && view.rowsVersion !== previous?.view.rowsVersion) {
    bindings.renderRows(search); return true;
  }
  return false;
}

export { renderSearchSnapshot };
