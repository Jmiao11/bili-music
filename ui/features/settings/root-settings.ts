
type SettingsCallbacks = {
  theme(value: string): void; accent(value: string): void;
  slider(kind: "blur" | "alpha" | "dim", value: string): void;
  chooseBackground(): void; resetBackground(): void; saveAi(): void; testAi(): void; aiFormat(): void;
  source(value: string): void; cache(): void; collection(kind: "order" | "limit", value: string): void;
  clearCache(): void; clearHistory(): void; exportData(): void; importData(): void; purge(): void;
  shortcut(action: keyof CommandContract.ShortcutBindings): void; clearShortcut(action: keyof CommandContract.ShortcutBindings): void; normalization(enabled: boolean): void;
};
const settingsHandlers: Partial<SettingsCallbacks> = {};
const settingsCallbacks = Object.freeze<SettingsCallbacks>({
  theme: value => settingsHandlers.theme?.(value), accent: value => settingsHandlers.accent?.(value), slider: (kind, value) => settingsHandlers.slider?.(kind, value),
  chooseBackground: () => settingsHandlers.chooseBackground?.(), resetBackground: () => settingsHandlers.resetBackground?.(), saveAi: () => settingsHandlers.saveAi?.(), testAi: () => settingsHandlers.testAi?.(), aiFormat: () => settingsHandlers.aiFormat?.(),
  source: value => settingsHandlers.source?.(value), cache: () => settingsHandlers.cache?.(), collection: (kind, value) => settingsHandlers.collection?.(kind, value), clearCache: () => settingsHandlers.clearCache?.(), clearHistory: () => settingsHandlers.clearHistory?.(),
  exportData: () => settingsHandlers.exportData?.(), importData: () => settingsHandlers.importData?.(), purge: () => settingsHandlers.purge?.(), shortcut: action => settingsHandlers.shortcut?.(action), clearShortcut: action => settingsHandlers.clearShortcut?.(action),
  normalization: enabled => settingsHandlers.normalization?.(enabled),
});
function installSettingsCallbacks(next: Partial<SettingsCallbacks>): void { Object.assign(settingsHandlers, next); }
let trackColumnInitialization = () => {};
function installTrackColumnInitialization(initialize: () => void): void { trackColumnInitialization = initialize; }
function initializeTrackColumnPreferences(): void { trackColumnInitialization(); }
export { installSettingsCallbacks, settingsCallbacks, installTrackColumnInitialization, initializeTrackColumnPreferences };
export type { SettingsCallbacks };
