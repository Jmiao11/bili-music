// UI call sites: window-controls.js:1, mini-player-host.js:179, mini.js:320.
interface TauriEvent<T> {
  payload: T;
}

interface TauriPosition { x: number; y: number; }
interface TauriSize { width: number; height: number; }

interface TauriWindowHandle {
  // window-controls.js:30-158; mini.js:208-293.
  isMaximized(): Promise<boolean>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  startResizeDragging(direction: string): Promise<void>;
  onResized(handler: (event: TauriEvent<TauriSize>) => void): Promise<() => void>;
  onMoved(handler: (event: TauriEvent<TauriPosition>) => void): Promise<() => void>;
  outerPosition(): Promise<TauriPosition>;
  outerSize(): Promise<TauriSize>;
  setPosition(position: TauriPosition): Promise<void>;
}

interface TauriMonitor {
  position: TauriPosition;
  size: TauriSize;
}

interface Window {
  __TAURI__?: {
    // main.js:9, appearance.js:4, lyrics.js:24; unannotated results are unknown.
    core: { invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>; };
    // appearance.js:533,580; mini-player-host.js:88,145; mini.js:177,182,299.
    event: {
      listen<T = unknown>(event: string, handler: (event: TauriEvent<T>) => void): Promise<() => void>;
      emit(event: string, payload?: unknown): Promise<void>;
      emitTo(target: string, event: string, payload?: unknown): Promise<void>;
    };
    window: {
      getCurrentWindow(): TauriWindowHandle;
      availableMonitors(): Promise<TauriMonitor[]>;
    };
    // mini.js:233,329.
    dpi: { PhysicalPosition: new (x: number, y: number) => TauriPosition; };
  };
}
