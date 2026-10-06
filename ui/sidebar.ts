type SidebarState = { width: number; collapsed: boolean };
const SIDEBAR_KEY = "bilibili-music.sidebar";
const SIDEBAR_DEFAULT = 220;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 320;
const SIDEBAR_COLLAPSED = 72;
const SIDEBAR_EXPAND = 224;

function sidebarDefaultState() {
  return { width: SIDEBAR_DEFAULT, collapsed: false };
}

function parseSidebarState(value: string | null): SidebarState {
  try {
    const state = JSON.parse(value ?? "null");
    if (!state || typeof state.width !== "number" || !Number.isFinite(state.width)
      || state.width < SIDEBAR_MIN || state.width > SIDEBAR_MAX
      || typeof state.collapsed !== "boolean") return sidebarDefaultState();
    return { width: state.width, collapsed: state.collapsed };
  } catch (_) {
    return sidebarDefaultState();
  }
}

function readSidebarState(storage: Pick<Storage, "getItem">) {
  try {
    return parseSidebarState(storage.getItem(SIDEBAR_KEY));
  } catch (_) {
    return sidebarDefaultState();
  }
}

function resizeSidebarState(state: SidebarState, candidate: number) {
  if (!Number.isFinite(candidate)) return state;
  if (state.collapsed && candidate < SIDEBAR_EXPAND) return state;
  if (!state.collapsed && candidate < SIDEBAR_MIN) return { ...state, collapsed: true };
  return { width: Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, candidate)), collapsed: false };
}

function sidebarVisibleWidth(state: SidebarState) {
  return state.collapsed ? SIDEBAR_COLLAPSED : state.width;
}

function initializeSidebar() {
  const root = document.documentElement;
  let state: SidebarState;
  try {
    state = readSidebarState(window.localStorage);
  } catch (_) {
    // Access to localStorage itself can throw in a restricted WebView.
    state = sidebarDefaultState();
  }
  let toggle: HTMLButtonElement | null;
  let handle: HTMLDivElement | null;
  let drag: { id: number; x: number; width: number } | null = null;

  function render() {
    const width = sidebarVisibleWidth(state);
    root.style.setProperty("--sidebar-width", `${width}px`);
    root.dataset.sidebarCollapsed = String(state.collapsed);
    if (!toggle || !handle) return;
    const label = state.collapsed ? "展开侧栏" : "收起侧栏";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", String(!state.collapsed));
    const span = toggle.querySelector("span");
    if (span) span.textContent = label;
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuetext", state.collapsed ? "已折叠，按右方向键展开" : `${width} 像素`);
  }

  function save() {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("sidebar preference save failed:", error);
    }
  }

  function toggleSidebar() {
    state = { ...state, collapsed: !state.collapsed };
    render();
    save();
  }

  function finishDrag(event: Event & Partial<PointerEvent>) {
    if (!drag || !handle || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    delete root.dataset.sidebarDragging;
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    save();
  }

  // This script runs in <head> so saved geometry is applied before the shell paints.
  render();
  document.addEventListener("DOMContentLoaded", () => {
    const sidebar = (document.querySelector("#sidebar") as HTMLElement);
    const currentToggle = (document.querySelector("#sidebar-toggle") as HTMLButtonElement);
    const currentHandle = (document.querySelector("#sidebar-resize") as HTMLDivElement);
    toggle = currentToggle;
    handle = currentHandle;
    for (const item of (sidebar.querySelectorAll(".nav-item:not(#sidebar-toggle)") as NodeListOf<HTMLElement>)) {
      const span = item.querySelector("span");
      if (!span) continue;
      const label = span.textContent;
      item.setAttribute("aria-label", label);
      item.title = label;
    }
    render();
    currentToggle.addEventListener("click", toggleSidebar);
    currentHandle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary || drag) return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width };
      root.dataset.sidebarDragging = "true";
      currentHandle.setPointerCapture(event.pointerId);
    });
    currentHandle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      // Keep the original anchor through the collapse snap; don't rebase onto 72px.
      state = resizeSidebarState(state, drag.width + event.clientX - drag.x);
      render();
    });
    currentHandle.addEventListener("pointerup", finishDrag);
    currentHandle.addEventListener("pointercancel", finishDrag);
    currentHandle.addEventListener("lostpointercapture", finishDrag);
    window.addEventListener("blur", finishDrag);
    currentHandle.addEventListener("keydown", (event) => {
      if (drag) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      let candidate;
      if (event.key === "ArrowLeft") candidate = sidebarVisibleWidth(state) - 8;
      else if (event.key === "ArrowRight") candidate = state.collapsed ? SIDEBAR_EXPAND : state.width + 8;
      else if (event.key === "Home") candidate = SIDEBAR_COLLAPSED;
      else if (event.key === "End") candidate = SIDEBAR_MAX;
      else return;
      event.preventDefault();
      state = resizeSidebarState(state, candidate);
      render();
      save();
    });
  }, { once: true });
}

if (typeof document !== "undefined") initializeSidebar();
