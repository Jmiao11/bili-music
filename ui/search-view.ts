import type { SearchSnapshot } from "./search-state.ts";
import { musicTabs, result, searchButton, searchStatus, sortModeTabs } from "./player-dom.ts";

type SearchRowBindings = { renderRows(search: SearchSnapshot): void };

function renderMusicTabs(search: SearchSnapshot): void {
  for (const tab of musicTabs) {
    const selected = Number(tab.dataset.tids) === search.tids;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
}

function renderSortTabs(search: SearchSnapshot): void {
  for (const tab of sortModeTabs) {
    const selected = tab.dataset.sortMode === search.sortMode;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
}

function renderSearchSnapshot(search: SearchSnapshot, previous: SearchSnapshot | null, bindings: SearchRowBindings): boolean {
  const view = search.view;
  if (view.status !== null && view.status !== previous?.view.status) searchStatus.textContent = view.status;
  if (view.buttonDisabled !== null && view.buttonDisabled !== previous?.view.buttonDisabled) searchButton.disabled = view.buttonDisabled;
  if (view.resultVisible !== null && view.resultVisible !== previous?.view.resultVisible) result.hidden = !view.resultVisible;
  if (view.musicVersion !== null && view.musicVersion !== previous?.view.musicVersion) renderMusicTabs(search);
  if (view.sortVersion !== null && view.sortVersion !== previous?.view.sortVersion) renderSortTabs(search);
  if (view.rowsVersion !== null && view.rowsVersion !== previous?.view.rowsVersion) {
    bindings.renderRows(search); return true;
  }
  return false;
}

export { renderSearchSnapshot };
