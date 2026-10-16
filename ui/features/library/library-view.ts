import {setModalStage} from "../../app/shell-stages.ts";
import type { LibrarySnapshot } from "./library-state.ts";
import { libraryModal, libraryModalBody } from "../../platform/main-window-refs.ts";
import { trapFocus } from "../../shared/focus-trap.ts";
type PageSelection = { startPage?: CommandContract.VideoPage; pages?: CommandContract.VideoPage[] };
type LibraryBindings = {
  choosePlaylist(id: string): void; closeModal(): void; submitName(name: string): Promise<void>; submitDelete(): Promise<void>; submitChoose(id: string): Promise<void>; createAndAdd(name: string): Promise<void>; submitImport(link: string, name: string): Promise<void>; submitPurge(): Promise<void>;
  setModalName(name: string): void; setModalLink(link: string): void;
};
let libraryModalReturnFocus: HTMLElement | null = null;
let libraryModalFrame: number | null = null;
const libraryModalPrimarySelector = ".library-modal-actions > .secondary-button";
const libraryModalNameSelector = ".library-name-field:last-of-type input";
const libraryModalLinkSelector = ".library-name-field:first-of-type input";


function renderLibrarySnapshot(state: LibrarySnapshot, previous: LibrarySnapshot | null, bindings: LibraryBindings): boolean {
  let rendered = false;
  if (state.session.open && !previous?.session.open) libraryModalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (state.view.rowsVersion !== null && state.view.rowsVersion !== previous?.view.rowsVersion) { rendered = state.view.rowsKind === "all"; }
  const modal = state.session;
  if (modal.version !== previous?.session.version && modal.open) {
    setModalStage("library",{hidden:false});
    if (libraryModalFrame !== null) cancelAnimationFrame(libraryModalFrame);
    libraryModalFrame = requestAnimationFrame(() => { libraryModalFrame = null; setModalStage("library",{open:true}); });
  } else if (previous?.session.open && !modal.open) {
    if (libraryModalFrame !== null) { cancelAnimationFrame(libraryModalFrame); libraryModalFrame = null; }
    setModalStage("library",{open:false});
    if (libraryModalReturnFocus?.isConnected) libraryModalReturnFocus.focus({ preventScroll: true });
    libraryModalReturnFocus = null;
  }
  if (modal.kind !== "generic") {
    if (modal.open && modal.version !== previous?.session.version && (modal.kind === "loudness" || modal.kind === "purge" && (modal.data.unavailable?.length ?? 0) > 0)) {
      libraryModalBody.querySelector<HTMLButtonElement>(libraryModalPrimarySelector)?.focus();
    }
  }
  const nameInput = libraryModalBody.querySelector<HTMLInputElement>(libraryModalNameSelector);
  if (modal.open && modal.version !== previous?.session.version) {
    if (modal.kind === "name") { nameInput?.focus(); nameInput?.select(); }
    if (modal.kind === "favoriteImport") libraryModalBody.querySelector<HTMLInputElement>(libraryModalLinkSelector)?.focus();
  }
  if (modal !== previous?.session) {
    if (modal.data.focusName !== previous?.session.data.focusName && modal.data.focusName) { nameInput?.focus(); nameInput?.select(); }
  }
  return rendered;
}
function keepFocusInLibraryModal(event: KeyboardEvent): void { trapFocus(event, libraryModal); }
function finishLibraryModalTransition(event: TransitionEvent): void {
  if (event.target === libraryModal && !libraryModal.classList.contains("is-open")) setModalStage("library",{hidden:true});
}

export { finishLibraryModalTransition, keepFocusInLibraryModal, renderLibrarySnapshot };
export type { LibraryBindings };
