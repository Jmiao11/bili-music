const tauriWindowApi = window.__TAURI__?.window;
const appWindow = tauriWindowApi?.getCurrentWindow?.();

const titlebar = document.querySelector<HTMLElement>(".window-titlebar");
const minimizeButton = document.querySelector<HTMLButtonElement>("#window-minimize-button");
const maximizeButton = document.querySelector<HTMLButtonElement>("#window-maximize-button");
const closeButton = document.querySelector<HTMLButtonElement>("#window-close-button");
const resizeHandles = document.querySelectorAll<HTMLElement & { dataset: DOMStringMap & { resizeDirection: string } }>("[data-resize-direction]");

const resizeDirectionMap: Partial<Record<string, string>> = {
  east: "East",
  north: "North",
  northEast: "NorthEast",
  northWest: "NorthWest",
  south: "South",
  southEast: "SouthEast",
  southWest: "SouthWest",
  west: "West",
};
const titlebarDoubleClickMs = 320;
const titlebarDoubleClickDistance = 6;
let lastTitlebarMouseDown: { time: number; x: number; y: number } | null = null;
let suppressNextDblClick = false;

async function updateMaximizedState() {
  if (!appWindow?.isMaximized) {
    return;
  }
  try {
    const isMaximized = await appWindow.isMaximized();
    document.documentElement.dataset.windowMaximized = String(isMaximized);
    if (maximizeButton) {
      const label = isMaximized ? "还原" : "最大化";
      maximizeButton.setAttribute("aria-label", label);
      maximizeButton.title = label;
    }
  } catch (error) {
    console.warn("window maximize state unavailable:", error);
  }
}

function isWindowControlTarget(target: EventTarget | null) {
  if (!target) return false;
  return Boolean((target as Element).closest(".window-controls, .window-control-button"));
}

function isTitlebarDragTarget(event: MouseEvent) {
  return event.button === 0 && !isWindowControlTarget(event.target);
}

async function startWindowDrag(event: MouseEvent) {
  if (!appWindow?.startDragging || !isTitlebarDragTarget(event)) {
    return;
  }
  try {
    await appWindow.startDragging();
  } catch (error) {
    console.warn("window drag failed:", error);
  }
}

function isTitlebarDoubleClick(event: MouseEvent) {
  const now = Date.now();
  const previous = lastTitlebarMouseDown;
  lastTitlebarMouseDown = {
    time: now,
    x: event.clientX,
    y: event.clientY,
  };
  if (event.detail > 1) {
    lastTitlebarMouseDown = null;
    return true;
  }
  if (!previous || now - previous.time > titlebarDoubleClickMs) {
    return false;
  }
  const distanceX = Math.abs(event.clientX - previous.x);
  const distanceY = Math.abs(event.clientY - previous.y);
  if (Math.max(distanceX, distanceY) <= titlebarDoubleClickDistance) {
    lastTitlebarMouseDown = null;
    return true;
  }
  return false;
}

async function toggleWindowMaximize() {
  if (!appWindow?.toggleMaximize) {
    return;
  }
  try {
    await appWindow.toggleMaximize();
    await updateMaximizedState();
  } catch (error) {
    console.warn("window maximize toggle failed:", error);
  }
}

minimizeButton?.addEventListener("click", async () => {
  try {
    await appWindow?.minimize?.();
  } catch (error) {
    console.warn("window minimize failed:", error);
  }
});

maximizeButton?.addEventListener("click", toggleWindowMaximize);

closeButton?.addEventListener("click", async () => {
  try {
    await appWindow?.close?.();
  } catch (error) {
    console.warn("window close failed:", error);
  }
});

titlebar?.addEventListener("mousedown", (event) => {
  if (!isTitlebarDragTarget(event)) {
    return;
  }
  if (isTitlebarDoubleClick(event)) {
    suppressNextDblClick = true;
    event.preventDefault();
    toggleWindowMaximize();
    return;
  }
  startWindowDrag(event);
});

titlebar?.addEventListener("dblclick", (event) => {
  if (suppressNextDblClick) {
    suppressNextDblClick = false;
    return;
  }
  if (isWindowControlTarget(event.target)) {
    return;
  }
  event.preventDefault();
  toggleWindowMaximize();
});

for (const handle of resizeHandles) {
  handle.addEventListener("pointerdown", async (event) => {
    if (event.button !== 0 || !appWindow?.startResizeDragging) {
      return;
    }
    const direction = resizeDirectionMap[handle.dataset.resizeDirection];
    if (!direction) {
      return;
    }
    event.preventDefault();
    try {
      await appWindow.startResizeDragging(direction);
    } catch (error) {
      console.warn("window resize drag failed:", error);
    }
  });
}

appWindow?.onResized?.(() => {
  updateMaximizedState();
});

updateMaximizedState();
