import { accentChannels } from "./settings-state.ts";
import type { SettingsSnapshot } from "./settings-state.ts";
import type { SettingsDom } from "./appearance.ts";
function shortcutDisplayLabel(binding: string | null | undefined) {
  if (!binding) {
    return "未设置";
  }
  if (document.documentElement.dataset.platform !== "macos") {
    return binding;
  }
  return binding
    .split("+")
    .map((token) => {
      const normalized = token.trim().toUpperCase();
      if (
        [
          "SUPER",
          "COMMAND",
          "CMD",
          "COMMANDORCONTROL",
          "COMMANDORCTRL",
          "CMDORCONTROL",
          "CMDORCTRL",
        ].includes(normalized)
      ) {
        return "Command";
      }
      return token;
    })
    .join("+");
}
function renderSettingsShortcut(state: SettingsSnapshot, action: keyof CommandContract.ShortcutBindings, dom: SettingsDom): void {
  const button = dom.shortcutRecordButtons.find(button => button.dataset.shortcutAction === action);
  if (!button) return;
  const recording = state.recordingShortcutAction === action;
  button.textContent = recording ? "按下组合键…" : shortcutDisplayLabel(state.shortcutBindings[action]);
  button.classList.toggle("is-recording", recording);
}
function prepareSettingsPanel(dom: SettingsDom): void {
  dom.settingsModal.hidden = false;
}
function renderSettingsSnapshot(state: SettingsSnapshot, previous: SettingsSnapshot | null, dom: SettingsDom): void {
  const before = previous?.view;
  const view = state.view;
  if (view.themeVersion && view.themeVersion !== before?.themeVersion) {
    dom.root.dataset.theme = state.theme ?? "dark";
    for (const option of dom.themeOptions) {
      const selected = option.dataset.themeOption === state.theme;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-checked", String(selected));
    }
    for (const group of dom.imageOnlyGroups) group.classList.toggle("is-disabled", state.theme !== "image");
    if (state.theme === "dynamic") for (const property of ["--glass-blur", "--panel-alpha", "--background-dim"]) dom.root.style.removeProperty(property);
  }
  if (view.sliders && view.sliders !== before?.sliders) {
    const kind = view.sliders.kind;
    if (kind === "all" || kind === "blur") {
      dom.root.style.setProperty("--glass-blur", state.glassBlur + "px");
      dom.glassBlurSlider.value = String(state.glassBlur);
      dom.glassBlurValue.textContent = state.glassBlur + "px";
    }
    if (kind === "all" || kind === "alpha") {
      dom.panelAlphaSlider.min = "20";
      dom.root.style.setProperty("--panel-alpha", String(state.panelAlpha / 100));
      dom.panelAlphaSlider.value = String(state.panelAlpha);
      dom.panelAlphaValue.textContent = state.panelAlpha + "%";
    }
    if (kind === "all" || kind === "dim") {
      dom.backgroundDimSlider.min = "40";
      dom.root.style.setProperty("--background-dim", String(state.backgroundDim / 100));
      dom.backgroundDimSlider.value = String(state.backgroundDim);
      dom.backgroundDimValue.textContent = state.backgroundDim + "%";
    }
  }
  if (view.accent && view.accent !== before?.accent) {
    accentChannels(state.accentColor, view.accent.theme).forEach((channel, index) => dom.root.style.setProperty('--accent-' + ['r', 'g', 'b'][index], String(channel)));
    for (const option of dom.accentColorOptions) {
      option.checked = option.value === state.accentColor;
      option.nextElementSibling.style.backgroundColor = 'rgb(' + accentChannels(option.value, view.accent.theme).join(', ') + ')';
    }
  }
  if (view.backgroundVersion && view.backgroundVersion !== before?.backgroundVersion) {
    const image = state.background;
    if (image) {
      dom.root.style.setProperty("--app-background", 'url("' + image.dataUrl + '")');
      dom.backgroundName.textContent = image.displayName + ' · ' + image.width + '×' + image.height;
      dom.backgroundName.title = image.path;
    }
    else {
      dom.root.style.removeProperty("--app-background");
      dom.backgroundName.textContent = "使用默认背景";
      dom.backgroundName.removeAttribute("title");
    }
  }
  if (view.notice && view.notice !== before?.notice) dom.appearanceStatus.textContent = view.notice.text;
  if (view.chooseDisabled !== before?.chooseDisabled && previous) dom.chooseBackgroundButton.disabled = view.chooseDisabled;
  if (view.shortcuts && view.shortcuts !== before?.shortcuts) renderSettingsShortcut(state, view.shortcuts.action, dom);
  if (view.availabilityVersion && view.availabilityVersion !== before?.availabilityVersion) {
    const autoOption = dom.streamSourceSelect?.querySelector<HTMLOptionElement>('option[value="auto"]');
    if (autoOption) {
      autoOption.disabled = !state.ytDlpAvailable;
      autoOption.title = state.ytDlpAvailable ? "" : "自动模式需在程序目录放置 yt-dlp.exe 后启用";
    }
  }
  if (view.stream.value !== null && view.stream.valueVersion !== before?.stream.valueVersion) dom.streamSourceSelect.value = view.stream.value;
  if (view.stream.text !== null && view.stream.text !== before?.stream.text) dom.streamSourceStatus.textContent = view.stream.text;
  if (view.stream.disabled !== null && view.stream.disabled !== before?.stream.disabled) dom.streamSourceSelect.disabled = view.stream.disabled;
  if (view.collectionVersion && view.collectionVersion !== before?.collectionVersion) {
    dom.shuffleCollectionOrder.value = state.collection.order;
    dom.shuffleCollectionLimit.value = state.collection.limit === 0 ? "all" : String(state.collection.limit);
  }
  const cache = view.cache;
  if (cache.settingsVersion && cache.settingsVersion !== before?.cache.settingsVersion && state.audioCacheSettings) {
    dom.audioCacheEnabled.checked = state.audioCacheSettings.enabled;
    dom.audioCacheCapacity.value = String(state.audioCacheSettings.maxBytes);
  }
  if (cache.disabled !== null && cache.disabled !== before?.cache.disabled) {
    dom.audioCacheEnabled.disabled = cache.disabled;
    dom.audioCacheCapacity.disabled = cache.disabled;
  }
  if (cache.status && cache.status !== before?.cache.status) dom.audioCacheStatus.textContent = cache.status.text;
  if (cache.usageText !== null && cache.usageText !== before?.cache.usageText) dom.audioCacheUsage.textContent = cache.usageText;
  if (cache.clearDisabled !== null && cache.clearDisabled !== before?.cache.clearDisabled) dom.clearAudioCacheButton.disabled = cache.clearDisabled;
  const ai = view.ai;
  if (ai.fieldsVersion && ai.fieldsVersion !== before?.ai.fieldsVersion) {
    dom.aiApiFormatSelect.value = state.ai.apiFormat;
    dom.aiBaseUrlInput.value = state.ai.baseUrl;
    dom.aiModelInput.value = state.ai.model;
  }
  if (ai.clearKeyVersion && ai.clearKeyVersion !== before?.ai.clearKeyVersion) dom.aiApiKeyInput.value = "";
  if (ai.text !== null && ai.text !== before?.ai.text) dom.aiConfigStatus.textContent = ai.text;
  if (ai.saveDisabled !== null && ai.saveDisabled !== before?.ai.saveDisabled) dom.saveAiConfigButton.disabled = ai.saveDisabled;
  if (ai.testDisabled !== null && ai.testDisabled !== before?.ai.testDisabled) dom.testAiConnectionButton.disabled = ai.testDisabled;
  if (ai.placeholderVersion && ai.placeholderVersion !== before?.ai.placeholderVersion) dom.aiBaseUrlInput.placeholder = state.ai.apiFormat === "anthropic-messages" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1";

}
function finishSettingsPanelTransition(event: TransitionEvent, dom: SettingsDom): void {
  if (event.target === dom.settingsModal && !dom.settingsModal.classList.contains("is-open")) dom.settingsModal.hidden = true;
}
export { finishSettingsPanelTransition, prepareSettingsPanel, renderSettingsShortcut, renderSettingsSnapshot };
