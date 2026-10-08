import { isPageDisabled } from "./page-selection.ts";
import { formatDuration } from "./track-utils.ts";
import type { PagesSnapshot } from "./pages-state.ts";
import type { LibrarySnapshot } from "./library-state.ts";
import { pagesModal, pagesModalClose, pagesModalList, pagesModalRestoreAll, pagesModalStatus, pagesModalSub, pagesModalTitle, status } from "./player-dom.ts";
type PagesBindings = {
  openFromBadge(button: HTMLButtonElement, trigger: HTMLButtonElement | null | undefined): void;
  playPage(page: Readonly<CommandContract.VideoPage>): void;
  changeDisabledPages(bvid: string, cid: number | null, disabled: boolean): Promise<void>;
  currentTrack(): Readonly<CommandContract.TrackSnapshotInput> | null;
  currentPage(): Readonly<CommandContract.VideoPage> | null;
};
let pagesModalReturnFocus: Element | null = null;
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
  const { video, videos, pages } = state.modal;
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
  pagesModalList.replaceChildren();
  const currentTrack = bindings.currentTrack();
  const currentPage =
    currentTrack?.bvid.toLowerCase() === String(video.bvid).toLowerCase()
      ? bindings.currentPage()
      : null;

  for (const page of pages) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const isCurrent = currentPage?.cid === page.cid;
    const isDisabled = isPageDisabled(library.disabledPages, video.bvid, page.cid);
    item.classList.toggle("is-disabled", isDisabled);
    button.type = "button";
    button.className = "pages-list-button";
    button.classList.toggle("is-current", isCurrent);
    button.textContent =
      `${page.page} · ${page.part || `第 ${page.page} P`} · ` +
      `${formatDuration(page.durationSeconds)}${isCurrent ? " · 当前" : ""}`;
    if (isCurrent) {
      button.setAttribute("aria-current", "true");
    }
    button.addEventListener("click", () => {
      bindings.playPage(page);
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "pages-disable-button";
    toggle.innerHTML = isDisabled
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 18.4 18.4 5.6"/></svg>';
    toggle.title = isDisabled ? "恢复" : "不想听";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.disabled = pending;
    toggle.setAttribute("aria-busy", String(pending && (pendingCid === null || pendingCid === page.cid)));
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      void bindings.changeDisabledPages(video.bvid, page.cid, !isDisabled);
    });
    item.append(button, toggle);
    pagesModalList.append(item);
  }
  if (hadFocus) pagesModalClose.focus({ preventScroll: true });
}


function renderPagesSnapshot(state: PagesSnapshot, library: LibrarySnapshot, previous: { pages: PagesSnapshot; library: LibrarySnapshot } | undefined, bindings: PagesBindings): void {
  if (state.view.badges && state.view.badges !== previous?.pages.view.badges) refreshPageCountBadges(state.view.badges.bvid, state, bindings);
  if (state.view.status && state.view.status !== previous?.pages.view.status) status.textContent = state.view.status.text;
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
