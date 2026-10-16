import {setPagesTrigger} from "./pages-ui-state.ts";
import {setModalStage} from "../../app/shell-stages.ts";
import { pagesModal, pagesModalClose, pagesModalList } from "../../platform/main-window-refs.ts";
import type { PagesSnapshot } from "./pages-state.ts";
import type { LibrarySnapshot } from "../library/library-state.ts";
import { trapFocus } from "../../shared/focus-trap.ts";
type PagesBindings = {
  openFromBadge(button: HTMLButtonElement, trigger: HTMLButtonElement | null | undefined): void;
  playPage(page: Readonly<CommandContract.VideoPage>): void;
  changeDisabledPages(bvid: string, cid: number | null, disabled: boolean): Promise<void>;
  currentTrack(): Readonly<CommandContract.TrackSnapshotInput> | null;
  currentPage(): Readonly<CommandContract.VideoPage> | null;
};
let pagesModalReturnFocus: Element | null = null;
function preparePagesModal(trigger: Element | null): void { pagesModalReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement; }
function renderPagesTrigger(trigger:HTMLElement|null,version:number,busy:boolean):void {setPagesTrigger(trigger,version,busy);}
function renderPagesSnapshot(state: PagesSnapshot, library: LibrarySnapshot, previous: { pages: PagesSnapshot; library: LibrarySnapshot } | undefined, bindings: PagesBindings): void {
  const prior = previous?.pages.modal;
  if (state.modal && (!prior || state.modal.version !== prior.version)) {
    setModalStage("pages",{hidden:false});
    requestAnimationFrame(() => {
      setModalStage("pages",{open:true});
      const current = pagesModalList.querySelector<HTMLButtonElement>('button[aria-current="true"]');
      const focus = current ?? pagesModalList.querySelector<HTMLButtonElement>("button") ?? pagesModalClose;
      current?.scrollIntoView({ block: "nearest" }); focus?.focus();
    });
  } else if (!state.modal && prior) {
    setModalStage("pages",{open:false});
    const focus = pagesModalReturnFocus; pagesModalReturnFocus = null;
    if (focus instanceof HTMLElement && focus.isConnected) focus.focus({ preventScroll: true });
  }
}
function keepFocusInPagesModal(event: KeyboardEvent): void { trapFocus(event, pagesModal); }

export { keepFocusInPagesModal, preparePagesModal, renderPagesSnapshot, renderPagesTrigger };
export type { PagesBindings };

function finishPagesTransition():void {setModalStage("pages",{hidden:true});}
export {finishPagesTransition};
