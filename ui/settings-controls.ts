import { accentChannels } from "./settings-state.ts";
import type { SettingsSnapshot } from "./settings-state.ts";
type SettingsControl = Readonly<{ text?: string; placeholder?: string; value?: string; valueVersion?: number; checked?: boolean; checkedVersion?: number; disabled?: boolean; title?: string | null; selected?: boolean; color?: string }>;
type SettingsControls = Readonly<Record<string, SettingsControl>>;
function shortcutDisplayLabel(binding: string | null | undefined, platform: string): string {
  if (!binding) return "未设置";
  if (platform !== "macos") return binding;
  return binding.split("+").map(token => ["SUPER", "COMMAND", "CMD", "COMMANDORCONTROL", "COMMANDORCTRL", "CMDORCONTROL", "CMDORCTRL"].includes(token.trim().toUpperCase()) ? "Command" : token).join("+");
}
function createSettingsControlsProjection() {
  let previous: SettingsSnapshot | null = null, model: SettingsControls = {};
  return (state: SettingsSnapshot, platform = "windows"): SettingsControls => {
    if (state === previous) return model;
    let next = model;
    const write = (name: string, fields: SettingsControl) => {
      const before = next[name] ?? {};
      const valueVersion = fields.value !== undefined ? (before.valueVersion ?? 0) + 1 : before.valueVersion;
      const checkedVersion = fields.checked !== undefined ? (before.checkedVersion ?? 0) + 1 : before.checkedVersion;
      if (next === model) next = { ...model };
      next = { ...next, [name]: { ...before, ...fields, valueVersion, checkedVersion } };
    };
    const before = previous?.view, view = state.view;
    if (view.themeVersion && view.themeVersion !== before?.themeVersion) for (const theme of ["dark", "light", "image", "dynamic"]) write("theme:" + theme, { selected: state.theme === theme });
    if (view.sliders && view.sliders !== before?.sliders) {
      for (const [kind, name, value, suffix] of [["blur", "glassBlur", state.glassBlur, "px"], ["alpha", "panelAlpha", state.panelAlpha, "%"], ["dim", "backgroundDim", state.backgroundDim, "%"]] as const) if (view.sliders.kind === "all" || view.sliders.kind === kind) {
        write(name + "Slider", { value: String(value) }); write(name + "Value", { text: value + suffix });
      }
    }
    if (view.accent && view.accent !== before?.accent) for (const color of ["pink", "blue", "purple", "green", "orange", "cyan"]) write("accent:" + color, { checked: state.accentColor === color, color: 'rgb(' + accentChannels(color, view.accent.theme).join(', ') + ')' });
    if (view.backgroundVersion && view.backgroundVersion !== before?.backgroundVersion) write("backgroundName", { text: state.background ? state.background.displayName + ' · ' + state.background.width + '×' + state.background.height : "使用默认背景", title: state.background?.path ?? null });
    if (view.notice && view.notice !== before?.notice) write("appearanceStatus", { text: view.notice.text });
    if (previous && view.chooseDisabled !== before?.chooseDisabled) write("chooseBackgroundButton", { disabled: view.chooseDisabled });
    if (state.shortcutBindings !== previous?.shortcutBindings || state.recordingShortcutAction !== previous?.recordingShortcutAction) for (const action of ["previous", "playPause", "next", "volumeUp", "volumeDown"] as const) write("shortcut:" + action, { text: state.recordingShortcutAction === action ? "按下组合键…" : shortcutDisplayLabel(state.shortcutBindings[action], platform), selected: state.recordingShortcutAction === action });
    if (view.availabilityVersion && view.availabilityVersion !== before?.availabilityVersion) write("autoSource", { disabled: !state.ytDlpAvailable, title: state.ytDlpAvailable ? "" : "自动模式需在程序目录放置 yt-dlp.exe 后启用" });
    if (view.stream.value !== null && view.stream.valueVersion !== before?.stream.valueVersion) write("streamSourceSelect", { value: view.stream.value });
    if (view.stream.text !== null && view.stream.text !== before?.stream.text) write("streamSourceStatus", { text: view.stream.text });
    if (view.stream.disabled !== null && view.stream.disabled !== before?.stream.disabled) write("streamSourceSelect", { disabled: view.stream.disabled });
    if (view.collectionVersion && view.collectionVersion !== before?.collectionVersion) {
      write("shuffleCollectionOrder", { value: state.collection.order }); write("shuffleCollectionLimit", { value: state.collection.limit === 0 ? "all" : String(state.collection.limit) });
    }
    const cache = view.cache;
    if (cache.settingsVersion && cache.settingsVersion !== before?.cache.settingsVersion && state.audioCacheSettings) {
      write("audioCacheEnabled", { checked: state.audioCacheSettings.enabled }); write("audioCacheCapacity", { value: String(state.audioCacheSettings.maxBytes) });
    }
    if (cache.disabled !== null && cache.disabled !== before?.cache.disabled) { write("audioCacheEnabled", { disabled: cache.disabled }); write("audioCacheCapacity", { disabled: cache.disabled }); }
    if (cache.status && cache.status !== before?.cache.status) write("audioCacheStatus", { text: cache.status.text });
    if (cache.usageText !== null && cache.usageText !== before?.cache.usageText) write("audioCacheUsage", { text: cache.usageText });
    if (cache.clearDisabled !== null && cache.clearDisabled !== before?.cache.clearDisabled) write("clearAudioCacheButton", { disabled: cache.clearDisabled });
    const ai = view.ai;
    if (ai.fieldsVersion && ai.fieldsVersion !== before?.ai.fieldsVersion) { write("aiApiFormatSelect", { value: state.ai.apiFormat }); write("aiBaseUrlInput", { value: state.ai.baseUrl }); write("aiModelInput", { value: state.ai.model }); }
    if (ai.text !== null && ai.text !== before?.ai.text) write("aiConfigStatus", { text: ai.text });
    if (ai.saveDisabled !== null && ai.saveDisabled !== before?.ai.saveDisabled) write("saveAiConfigButton", { disabled: ai.saveDisabled });
    if (ai.testDisabled !== null && ai.testDisabled !== before?.ai.testDisabled) write("testAiConnectionButton", { disabled: ai.testDisabled });
    if (ai.placeholderVersion && ai.placeholderVersion !== before?.ai.placeholderVersion) write("aiBaseUrlInput", {placeholder:state.ai.apiFormat === "anthropic-messages" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"});
    previous = state; model = next; return model;
  };
}
// A value write is explicit; unrelated attribute updates must preserve native drafts.
function applySettingsField(element: { value: string; checked?: boolean }, value: SettingsControl, previous?: SettingsControl): void {
  if (value.valueVersion && value.valueVersion !== previous?.valueVersion) element.value = value.value ?? "";
  if (value.checkedVersion && value.checkedVersion !== previous?.checkedVersion) element.checked = value.checked ?? false;
}
export { applySettingsField, createSettingsControlsProjection, shortcutDisplayLabel };
export type { SettingsControl, SettingsControls };
