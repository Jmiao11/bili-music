import type { PagesSnapshot } from "./pages-state.ts";
import type { LibrarySnapshot } from "./library-state.ts";
import { pagesModal, pagesModalClose, pagesModalList, pagesModalRestoreAll, pagesModalStatus, pagesModalSub, pagesModalTitle } from "./player-dom.ts";
import PagesList from "./components/PagesList.vue";
import { createSyncRegion } from "./vue/sync-region.ts";
type PagesBindings = {
  openFromBadge(button: HTMLButtonElement, trigger: HTMLButtonElement | null | undefined): void;
  playPage(page: Readonly<CommandContract.VideoPage>): void;
  changeDisabledPages(bvid: string, cid: number | null, disabled: boolean): Promise<void>;
  currentTrack(): Readonly<CommandContract.TrackSnapshotInput> | null;
  currentPage(): Readonly<CommandContract.VideoPage> | null;
};
let pagesModalReturnFocus: Element | null = null;
let pagesListRegion: ReturnType<typeof createSyncRegion> | null = null;
let pagesListRenderVersion = 0;
function preparePagesModal(trigger: Element | null): void { pagesModalReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement; }
function renderPagesTrigger(trigger: HTMLElement | null, version: number, busy: boolean): void {
  if (busy) { trigger?.setAttribute("aria-busy", "true"); if (trigger) trigger.dataset.pagesRequestVersion = String(version); }
  else if (trigger?.dataset.pagesRequestVersion === String(version)) { trigger.removeAttribute("aria-busy"); delete trigger.dataset.pagesRequestVersion; }
}
function updatePageCountBadge(playButton: HTMLButtonElement, bvid: string, state: PagesSnapshot, bindings: PagesBindings): void {
  playButton.dataset.bvid = bvid;
  const count = state.videoPageCounts.get(bvid);
  const actions = playButton.parentElement?.querySelector(".track-actions");
  let badge = actions?.querySelector<HTMLButtonElement>(".page-count-badge");
  if (!((count ?? 0) > 1)) {
    badge?.remove();
    return;
  }
  if (!badge && actions) {
    badge = document.createElement("button");
    badge.type = "button";
    badge.className = "page-count-badge";
    badge.title = "查看分P";
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      bindings.openFromBadge(playButton, badge);
    });
    badge.addEventListener("dblclick", (event) => event.stopPropagation());
    actions.prepend(badge);
  }
  if (!badge) {
    return;
  }
  badge.textContent = `${count}P`;
  badge.setAttribute("aria-label", `查看 ${count} 个分P`);
}

function refreshPageCountBadges(bvid: string, state: PagesSnapshot, bindings: PagesBindings): void {
  for (const playButton of document.querySelectorAll<HTMLButtonElement>("button.track[data-bvid]")) {
    if (playButton.dataset.bvid === bvid) {
      updatePageCountBadge(playButton, bvid, state, bindings);
    }
  }
}


function renderPagesModal(state: PagesSnapshot, library: LibrarySnapshot, bindings: PagesBindings): void {
  if (!state.modal) return;
  const { video, videos } = state.modal;
  const bvidKey = video.bvid.toLowerCase();
  const pending = library.disabledPagePending.has(bvidKey);
  const pendingCid = library.disabledPagePending.get(bvidKey);
  const disabledCids = library.disabledPages.get(bvidKey);
  const hadFocus = pagesModalList.contains(document.activeElement) ||
    document.activeElement === pagesModalRestoreAll;
  pagesModalStatus.textContent = state.modal.error;
  pagesModalTitle.textContent = "选择分P";
  pagesModalSub.textContent = `${video.title || video.bvid} · 共 ${videos}P`;
  pagesModalRestoreAll.hidden = !disabledCids?.size && !(pending && pendingCid === null);
  pagesModalRestoreAll.disabled = pending;
  pagesModalRestoreAll.textContent = pending && pendingCid === null ? "恢复中…" : "全部恢复";
  if (!pagesListRegion) {
    pagesModalList.replaceChildren();
    pagesListRegion = createSyncRegion(pagesModalList, PagesList);
  }
  const currentTrack = bindings.currentTrack();
  // Preserve the old replaceChildren contract, including detaching previously focused rows.
  const props = { key: ++pagesListRenderVersion, modal: state.modal,
    disabledPages: library.disabledPages, pending: library.disabledPagePending,
    currentBvid: currentTrack?.bvid ?? null, currentCid: currentTrack?.bvid.toLowerCase() === bvidKey ? bindings.currentPage()?.cid ?? null : null,
    onPlay: bindings.playPage, onToggle: bindings.changeDisabledPages } satisfies InstanceType<typeof PagesList>["$props"];
  pagesListRegion.update(props);
  if (hadFocus) pagesModalClose.focus({ preventScroll: true });
}


function renderPagesSnapshot(state: PagesSnapshot, library: LibrarySnapshot, previous: { pages: PagesSnapshot; library: LibrarySnapshot } | undefined, bindings: PagesBindings): void {
  if (state.view.badges && state.view.badges !== previous?.pages.view.badges) refreshPageCountBadges(state.view.badges.bvid, state, bindings);
  const prior = previous?.pages.modal;
  if (state.modal && (state.modal !== prior)) renderPagesModal(state, library, bindings);
  if (state.modal && (!prior || state.modal.version !== prior.version)) {
    pagesModal.hidden = false;
    requestAnimationFrame(() => {
      pagesModal.classList.add("is-open"); pagesModal.setAttribute("aria-hidden", "false");
      const current = pagesModalList.querySelector<HTMLButtonElement>('button[aria-current="true"]');
      const focus = current ?? pagesModalList.querySelector<HTMLButtonElement>("button") ?? pagesModalClose;
      current?.scrollIntoView({ block: "nearest" }); focus?.focus();
    });
  } else if (!state.modal && prior) {
    pagesModal.classList.remove("is-open"); pagesModal.setAttribute("aria-hidden", "true");
    const focus = pagesModalReturnFocus; pagesModalReturnFocus = null;
    if (focus instanceof HTMLElement && focus.isConnected) focus.focus({ preventScroll: true });
  }
}
function keepFocusInPagesModal(event: KeyboardEvent): void {
  if (event.key !== "Tab" || !pagesModal.classList.contains("is-open")) {
    return;
  }
  const focusable = [...pagesModal.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
  if (focusable.length === 0) {
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export { keepFocusInPagesModal, preparePagesModal, renderPagesSnapshot, renderPagesTrigger, updatePageCountBadge };
export type { PagesBindings };
