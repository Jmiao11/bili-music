const SIDEBAR_KEY = "bilibili-music.sidebar";
const SIDEBAR_DEFAULT = 220;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 320;
const SIDEBAR_COLLAPSED = 72;
const SIDEBAR_EXPAND = 224;

function sidebarDefaultState() {
  return { width: SIDEBAR_DEFAULT, collapsed: false };
}

function parseSidebarState(value) {
  try {
    const state = JSON.parse(value);
    if (!state || typeof state.width !== "number" || !Number.isFinite(state.width)
      || state.width < SIDEBAR_MIN || state.width > SIDEBAR_MAX
      || typeof state.collapsed !== "boolean") return sidebarDefaultState();
    return { width: state.width, collapsed: state.collapsed };
  } catch (_) {
    return sidebarDefaultState();
  }
}

function readSidebarState(storage) {
  try {
    return parseSidebarState(storage.getItem(SIDEBAR_KEY));
  } catch (_) {
    return sidebarDefaultState();
  }
}

function resizeSidebarState(state, candidate) {
  if (!Number.isFinite(candidate)) return state;
  if (state.collapsed && candidate < SIDEBAR_EXPAND) return state;
  if (!state.collapsed && candidate < SIDEBAR_MIN) return { ...state, collapsed: true };
  return { width: Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, candidate)), collapsed: false };
}

function sidebarVisibleWidth(state) {
  return state.collapsed ? SIDEBAR_COLLAPSED : state.width;
}

function initializeSidebar() {
  const root = document.documentElement;
  let state;
  try {
    state = readSidebarState(window.localStorage);
  } catch (_) {
    // Access to localStorage itself can throw in a restricted WebView.
    state = sidebarDefaultState();
  }
  let toggle;
  let handle;
  let drag = null;

  function render() {
    const width = sidebarVisibleWidth(state);
    root.style.setProperty("--sidebar-width", `${width}px`);
    root.dataset.sidebarCollapsed = String(state.collapsed);
    if (!toggle) return;
    const label = state.collapsed ? "展开侧栏" : "收起侧栏";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", String(!state.collapsed));
    toggle.querySelector("span").textContent = label;
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

  function finishDrag(event) {
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    delete root.dataset.sidebarDragging;
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    save();
  }

  // This script runs in <head> so saved geometry is applied before the shell paints.
  render();
  document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.querySelector("#sidebar");
    toggle = document.querySelector("#sidebar-toggle");
    handle = document.querySelector("#sidebar-resize");
    for (const item of /** @type {NodeListOf<HTMLElement>} */ (sidebar.querySelectorAll(".nav-item:not(#sidebar-toggle)"))) {
      const label = item.querySelector("span").textContent;
      item.setAttribute("aria-label", label);
      item.title = label;
    }
    render();
    toggle.addEventListener("click", toggleSidebar);
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary || drag) return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width };
      root.dataset.sidebarDragging = "true";
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      // Keep the original anchor through the collapse snap; don't rebase onto 72px.
      state = resizeSidebarState(state, drag.width + event.clientX - drag.x);
      render();
    });
    handle.addEventListener("pointerup", finishDrag);
    handle.addEventListener("pointercancel", finishDrag);
    handle.addEventListener("lostpointercapture", finishDrag);
    window.addEventListener("blur", finishDrag);
    handle.addEventListener("keydown", (event) => {
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
