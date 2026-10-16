import { createMiniRenderer } from "./root-mount.ts";
import type { MiniView, MiniCallbacks } from "./view-model.ts";
const MINI_POSITION_KEY = "bilibili-music.mini-player-position";
function readMiniPosition(storage: Pick<Storage, "getItem">): TauriPosition | null {
  try {
    const parsed = JSON.parse(storage.getItem(MINI_POSITION_KEY) ?? "null");
    if (!parsed || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }
    return { x: Math.round(parsed.x), y: Math.round(parsed.y) };
  } catch {
    return null;
  }
}

function clampMiniPosition(position: TauriPosition, monitors: TauriMonitor[], windowSize: TauriSize): TauriPosition;
function clampMiniPosition(position: TauriPosition | null, monitors: TauriMonitor[], windowSize: TauriSize): TauriPosition | null;
function clampMiniPosition(position: TauriPosition | null, monitors: TauriMonitor[], windowSize: TauriSize) {
  if (!position || !Array.isArray(monitors) || monitors.length === 0) {
    return position;
  }

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
  let best: TauriPosition | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const monitor of monitors) {
    const x = Number(monitor?.position?.x);
    const y = Number(monitor?.position?.y);
    const width = Number(monitor?.size?.width);
    const height = Number(monitor?.size?.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      continue;
    }
    const maxX = x + width - Number(windowSize?.width || 0);
    const maxY = y + height - Number(windowSize?.height || 0);
    const clampedX = clamp(position.x, x, maxX);
    const clampedY = clamp(position.y, y, maxY);
    const distance = (clampedX - position.x) ** 2 + (clampedY - position.y) ** 2;
    if (distance < bestDistance) {
      best = { x: Math.round(clampedX), y: Math.round(clampedY) };
      bestDistance = distance;
    }
  }

  return best ?? position;
}

function readMiniPorts(document:Document) {
  const title = (document.getElementById("mini-title") as HTMLElement);
  const titleViewport = (document.getElementById("mini-title-viewport") as HTMLDivElement);
  const restoreButton = (document.getElementById("mini-restore") as HTMLButtonElement);
  const noticeMoreButton = (document.getElementById("mini-notice-more") as HTMLButtonElement);
  const noticeFull = (document.getElementById("mini-notice-full") as HTMLDivElement);
  const root = document.documentElement;
  return {title,titleViewport,restoreButton,noticeMoreButton,noticeFull,root};
}

function createMiniPlayerController({
  eventApi,
  invoke,
  windowApi,
  availableMonitors,
  dpi,
  document,
  storage,
  window,
  console,
}: { eventApi: TauriEventApi; invoke: CommandInvoke; windowApi: TauriWindowHandle; availableMonitors: () => Promise<TauriMonitor[]>; dpi: { PhysicalPosition: new (x: number, y: number) => TauriPosition }; document: Document; storage: Pick<Storage, "getItem" | "setItem">; window: Window; console: Console }) {
  let snapshot: MiniView["snapshot"] = {}, hasSnapshot = false, expanded = false;
  let distance: string | null = null, duration: string | null = null, scrolling = false;
  let controlsBound = false;
  const renderView = createMiniRenderer(document.body);
  const callbacks: MiniCallbacks = {
    command: action => { if(controlsBound) emitCommand(action); },
    restore: () => { if(controlsBound) restoreMain(); },
    more: () => { if(controlsBound && snapshot.notice) { expanded = !expanded; renderRoot(); } },
    noticeKey: event => { if(!controlsBound || event.key !== "Escape") return; expanded=false; renderRoot(); noticeMoreButton.focus?.(); },
    drag: event => { if(controlsBound) dragWindow(event); },
  };
  function renderRoot() { renderView({snapshot,hasSnapshot,expanded,distance,duration,scrolling},callbacks); }
  renderRoot();
  const {title,titleViewport,restoreButton,noticeMoreButton,noticeFull,root}=readMiniPorts(document);
  const unlisteners: (() => void)[] = [];
  let disposed = false;
  let lastPosition: TauriPosition | null = null;
  let lastTitle: string | null = null;
  let titleScrollFrame: number | null = null;
  function warn(message: string, error: unknown) {
    console?.warn?.(message, error);
  }

  function clearTitleScroll() {
    const changed = distance !== null || duration !== null || scrolling;
    distance=null; duration=null; scrolling=false;
    if(changed) renderRoot();
  }

  function measureTitleOverflow() {
    clearTitleScroll();
    const availableWidth = Number(titleViewport?.clientWidth);
    const titleWidth = Number(title?.scrollWidth);
    if (!Number.isFinite(availableWidth) || !Number.isFinite(titleWidth) || availableWidth <= 0 || titleWidth <= 0) {
      return;
    }
    const overflow = Math.max(0, Math.ceil(titleWidth) - Math.floor(availableWidth));
    if (overflow <= 0) {
      return;
    }
    distance = `-${overflow}px`;
    duration = `${Math.min(14, Math.max(5, overflow / 18 + 4))}s`;
    void title.offsetWidth;
    scrolling = true;
    renderRoot();
  }

  function updateTitleScroll(cleared = false) {
    if(!cleared) clearTitleScroll();
    if (typeof window?.requestAnimationFrame === "function") {
      if (titleScrollFrame != null) {
        window.cancelAnimationFrame?.(titleScrollFrame);
      }
      titleScrollFrame = window.requestAnimationFrame(() => {
        titleScrollFrame = null;
        measureTitleOverflow();
      });
      return;
    }
    measureTitleOverflow();
  }

  function render(state: Partial<MiniPlayerStatePayload> = {}) {
    if(!state.notice && (document.activeElement === noticeMoreButton || document.activeElement === noticeFull)) restoreButton.focus?.();
    if(!state.notice) expanded=false;
    snapshot = state;
    hasSnapshot = true;
    const nextTitle = state.title || "尚未播放", titleChanged = nextTitle !== lastTitle;
    if(titleChanged) { lastTitle=nextTitle; distance=null; duration=null; scrolling=false; }
    renderRoot();
    if(titleChanged) updateTitleScroll(true);
    root.dataset.theme = state.theme === "light" ? "light" : "dark";
    if(state.accent) {
      root.style.setProperty("--accent-r",String(Number(state.accent.r)||0));
      root.style.setProperty("--accent-g",String(Number(state.accent.g)||0));
      root.style.setProperty("--accent-b",String(Number(state.accent.b)||0));
    }
  }

  function emitCommand(action: TauriAppEventMap["mini-player-command"]["action"]) {
    Promise.resolve(eventApi.emit("mini-player-command", { action }))
      .catch((error) => warn(`mini player command failed: ${action}`, error));
  }

  function listen<K extends keyof TauriAppEventMap>(name: K, handler: (event: TauriEvent<TauriAppEventMap[K]>) => void) {
    return eventApi.listen(name, handler).then((unlisten) => {
      if (disposed) {
        Promise.resolve(unlisten()).catch(() => {});
      } else {
        unlisteners.push(unlisten);
      }
    }).catch((error) => warn(`mini player listener failed for ${name}:`, error));
  }

  function persistPosition(position: TauriPosition | null | undefined) {
    const x = Number(position?.x);
    const y = Number(position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    lastPosition = { x: Math.round(x), y: Math.round(y) };
    try {
      storage.setItem(MINI_POSITION_KEY, JSON.stringify(lastPosition));
    } catch (error) {
      warn("mini player position save failed:", error);
    }
    return true;
  }

  async function saveCurrentPosition() {
    try {
      persistPosition(await windowApi.outerPosition());
    } catch (error) {
      warn("mini player position save failed:", error);
    }
  }

  function handleMoved(event: TauriEvent<TauriPosition>) {
    if (persistPosition(event?.payload)) {
      return;
    }
    void saveCurrentPosition();
  }

  async function restorePosition() {
    const saved = readMiniPosition(storage);
    if (!saved) {
      return;
    }
    try {
      const [monitors, windowSize] = await Promise.all([
        availableMonitors(),
        windowApi.outerSize(),
      ]);
      const position = clampMiniPosition(saved, monitors, windowSize);
      lastPosition = position;
      await windowApi.setPosition(new dpi.PhysicalPosition(position.x, position.y));
    } catch (error) {
      warn("mini player position restore failed:", error);
    }
  }

  function restoreMain() {
    Promise.resolve(invoke("exit_mini_player")).catch(error => warn("mini player restore failed:",error));
  }
  function dragWindow(event: PointerEvent) {
    if(event.button !== 0 || (event.target as Element | null)?.closest?.("button, #mini-notice-full")) return;
    event.preventDefault?.();
    Promise.resolve(windowApi.startDragging()).catch(error => warn("mini player drag failed:",error));
  }

  async function start() {
    window?.addEventListener?.("beforeunload", () => {
      disposed = true;
      if (titleScrollFrame != null) {
        window.cancelAnimationFrame?.(titleScrollFrame);
      }
      if (lastPosition) {
        persistPosition(lastPosition);
      }
      for (const unlisten of unlisteners.splice(0)) {
        Promise.resolve(unlisten()).catch(() => {});
      }
    }, { once: true });
    await listen("mini-player-state", ({ payload }) => render(payload));
    controlsBound = true;
    await restorePosition();
    try {
      const unlisten = await windowApi.onMoved(handleMoved);
      unlisteners.push(unlisten);
    } catch (error) {
      warn("mini player move listener failed:", error);
    }
    try {
      await eventApi.emit("mini-player-ready");
    } catch (error) {
      warn("mini player ready event failed:", error);
    }
    try {
      await invoke("mini_player_ready");
      updateTitleScroll();
    } catch (error) {
      warn("mini player show failed:", error);
      try {
        await invoke("exit_mini_player");
      } catch (restoreError) {
        warn("mini player recovery failed:", restoreError);
      }
    }
  }

  return { start, render };
}

function startMiniPlayerWindow() {
  const tauri = window.__TAURI__;
  if (!tauri?.event || !tauri?.core?.invoke || !tauri?.window) {
    return;
  }
  const controller = createMiniPlayerController({
    eventApi: tauri.event,
    invoke: tauri.core.invoke,
    windowApi: tauri.window.getCurrentWindow(),
    availableMonitors: tauri.window.availableMonitors,
    dpi: tauri.dpi,
    document,
    storage: window.localStorage,
    window,
    console,
  });
  void controller.start();
}

export { createMiniPlayerController, startMiniPlayerWindow };
