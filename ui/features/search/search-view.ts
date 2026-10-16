import type { SearchSnapshot } from "./search-state.ts";
import { result, searchStatus } from "../../platform/player-dom.ts";
type SearchRowBindings = { renderRows(search: SearchSnapshot): void };

function renderSearchSnapshot(search: SearchSnapshot, previous: SearchSnapshot | null, bindings: SearchRowBindings): boolean {
  const view = search.view;
  if (view.status !== null && view.status !== previous?.view.status) searchStatus.textContent = view.status;
  if (view.resultVisible !== null && view.resultVisible !== previous?.view.resultVisible) result.hidden = !view.resultVisible;
  if (view.rowsVersion !== null && view.rowsVersion !== previous?.view.rowsVersion) {
    bindings.renderRows(search); return true;
  }
  return false;
}

export { renderSearchSnapshot };
