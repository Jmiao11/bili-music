// Rust: taskbar.rs::clicked_action; shortcut_config.rs::ShortcutBindings::entries.
// JS: mini-player-host.js::miniPlayerState; mini.js::bindControls.
interface MiniPlayerStatePayload {
  title: string;
  uploader: string;
  thumbnailUrl: string;
  status: string;
  hasCurrent: boolean;
  canPrevious: boolean;
  canNext: boolean;
  isPlaying: boolean;
  isFavorited: boolean;
  theme: string;
  accent: { r: number; g: number; b: number };
  notice: string;
}

interface TauriAppEventMap {
  "taskbar-media-control": "previous" | "play_pause" | "next";
  "global-shortcut": "previous" | "play_pause" | "next" | "volume_up" | "volume_down";
  "mini-player-state": MiniPlayerStatePayload;
  "mini-player-command": { action: "previous" | "toggle_play" | "next" | "toggle_favorite" };
  // The event plugin receives Option<JsonValue> and emits None as JSON null.
  "mini-player-ready": null;
}

// Third-party names must be added explicitly by declaration merging. Framework
// names have their own namespace; neither fallback accepts an app event name.
interface TauriExternalEventMap {}
type TauriExternalEventName = `tauri://${string}` | `plugin:${string}` | keyof TauriExternalEventMap;
type TauriAppEventArguments<K extends keyof TauriAppEventMap> = TauriAppEventMap[K] extends null
  ? [payload?: null]
  : [payload: TauriAppEventMap[K]];

interface TauriEventApi {
  listen<K extends keyof TauriAppEventMap>(event: K, handler: (event: TauriEvent<TauriAppEventMap[K]>) => void): Promise<() => void>;
  listen<T = unknown>(event: TauriExternalEventName, handler: (event: TauriEvent<T>) => void): Promise<() => void>;
  emit<K extends keyof TauriAppEventMap>(event: K, ...payload: TauriAppEventArguments<K>): Promise<void>;
  emit(event: TauriExternalEventName, payload?: unknown): Promise<void>;
  emitTo<K extends keyof TauriAppEventMap>(target: string, event: K, ...payload: TauriAppEventArguments<K>): Promise<void>;
  emitTo(target: string, event: TauriExternalEventName, payload?: unknown): Promise<void>;
}
