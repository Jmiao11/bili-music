import type vm from "node:vm";
import {createSettingsControlsProjection} from "../../ui/features/settings/settings-controls.ts";
import {applySettingsField} from "../../ui/features/settings/components/field-directive.ts";
import type { SettingsSnapshot } from "../../ui/features/settings/settings-state.ts";
import type { SettingsCallbacks } from "../../ui/features/settings/root-settings.ts";

// Native ports for installation-before fixtures; installed baselines render the real SFC.
function attachSettingsControlPorts(context: vm.Context, clearKey = false) {
  const project = createSettingsControlsProjection();
  let previous: ReturnType<typeof project> = {};
  let navigationVersion=0;
  let previousMascots: SettingsSnapshot["controls"]["mascots"] | null = null;
  const node = (name: string) => context[name] ?? context.document?.querySelector?.("#" + name.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()));
  const handlers: Partial<SettingsCallbacks> = context.__settingsFixtureHandlers ??= {};
  const bound: Set<string> = context.__settingsFixtureBound ??= new Set<string>();
  const bind = (key: keyof SettingsCallbacks, target: vm.Context | undefined, event: string, args: () => unknown[] = () => [], suffix = "") => {
    if (!target?.addEventListener || bound.has(key + suffix)) return;
    bound.add(key + suffix); target.addEventListener(event, () => { const callback = handlers[key]; if (callback) return Reflect.apply(callback, undefined, args()); });
  };
  context.readAiKeyDraft ??= () => node("aiApiKeyInput")?.value ?? "";
  context.clearAiKeyDraft ??= () => { const input = node("aiApiKeyInput"); if (input) input.value = ""; };
  context.installSettingsCallbacks ??= (next: Partial<SettingsCallbacks>) => {
    Object.assign(handlers, next);
    for (const [key, name] of [["chooseBackground", "chooseBackgroundButton"], ["resetBackground", "resetBackgroundButton"], ["saveAi", "saveAiConfigButton"], ["testAi", "testAiConnectionButton"], ["clearCache", "clearAudioCacheButton"], ["clearHistory", "clearSearchHistoryButton"], ["exportData", "exportDataButton"], ["importData", "importDataButton"], ["purge", "purgeUnavailableTracksButton"]] as const) if (next[key]) bind(key, node(name), "click");
    if (next.aiFormat) bind("aiFormat", node("aiApiFormatSelect"), "change");
    if (next.source) bind("source", node("streamSourceSelect"), "change", () => [node("streamSourceSelect").value]);
    if (next.normalization) bind("normalization", node("loudnessNormalizationToggle"), "change", () => [node("loudnessNormalizationToggle").checked]);
    if (next.slider) for (const [kind, name] of [["blur", "glassBlurSlider"], ["alpha", "panelAlphaSlider"], ["dim", "backgroundDimSlider"]]) bind("slider", node(name), "input", () => [kind, node(name).value], name);
    if (next.cache) for (const name of ["audioCacheEnabled", "audioCacheCapacity"]) bind("cache", node(name), "change", () => [], name);
    if (next.collection) for (const [kind, name] of [["order", "shuffleCollectionOrder"], ["limit", "shuffleCollectionLimit"]]) bind("collection", node(name), "change", () => [kind, node(name).value], name);
    for (const button of context.themeOptions ?? []) if (next.theme) bind("theme", button, "click", () => [button.dataset.themeOption], button.dataset.themeOption);
    for (const button of context.accentColorOptions ?? []) if (next.accent) bind("accent", button, "change", () => [button.value], button.value);
    for (const button of context.shortcutRecordButtons ?? []) if (next.shortcut) bind("shortcut", button, "click", () => [button.dataset.shortcutAction], button.dataset.shortcutAction);
    for (const button of context.shortcutClearButtons ?? []) if (next.clearShortcut) bind("clearShortcut", button, "click", () => [button.dataset.shortcutClear], button.dataset.shortcutClear);
  };
  return (state: SettingsSnapshot) => {
    const model = project(state, context.root?.dataset?.platform ?? "windows");
    for (const [name, field] of Object.entries(model)) {
      if (field === previous[name]) continue;
      const [kind, value] = name.split(":");
      const target = kind === "theme" ? context.themeOptions?.find((button: vm.Context) => button.dataset.themeOption === value)
        : kind === "accent" ? context.accentColorOptions?.find((button: vm.Context) => button.value === value)
        : kind === "shortcut" ? context.shortcutRecordButtons?.find((button: vm.Context) => button.dataset.shortcutAction === value) : node(name);
      if (!target) continue;
      applySettingsField(target, field, previous[name]);
      if (field.text !== undefined) target.textContent = field.text;
      if (field.placeholder !== undefined) target.placeholder = field.placeholder;
      if (field.disabled !== undefined) target.disabled = field.disabled;
      if (field.title === null) target.removeAttribute("title"); else if (field.title !== undefined) target.title = field.title;
      if (kind === "theme") { target.classList.toggle("is-selected", field.selected); target.setAttribute("aria-checked", String(field.selected)); }
      if (kind === "shortcut") target.classList.toggle("is-recording", field.selected);
      if (kind === "accent" && field.color && target.nextElementSibling) target.nextElementSibling.style.backgroundColor = field.color;
    }
    if (clearKey && state.view.ai.clearKeyVersion && state.view.ai.clearKeyVersion !== context.__fixtureKeyCleared) { context.clearAiKeyDraft(); context.__fixtureKeyCleared = state.view.ai.clearKeyVersion; }
    if (state.view.themeVersion) for (const group of context.imageOnlyGroups ?? []) group.classList.toggle("is-disabled", state.theme !== "image");
    if (state.controls) for (const [key, name] of [["backupExport", "exportDataButton"], ["backupImport", "importDataButton"], ["history", "clearSearchHistoryButton"]] as const) { const target = node(name); if (target) target.disabled = state.controls.dataBusy[key]; }
    if (state.controls && context.mascotPicker && context.document?.createElement) {
      if(state.controls.mascots !== previousMascots) {
        const tiles=state.controls.mascots.map(item=>{const tile=context.document.createElement("button");tile.dataset.mascotId=item.id;tile.addEventListener("click",()=>handlers.mascot?.(item.id));return tile;});
        context.mascotPicker.replaceChildren(...tiles); previousMascots=state.controls.mascots;
      }
      for(const tile of context.mascotPicker.children) tile.classList.toggle("is-selected",tile.dataset.mascotId === state.controls.activeMascot);
    }
    if(state.session.navigationVersion && state.session.navigationVersion !== navigationVersion) {
      navigationVersion=state.session.navigationVersion;const current=state.session.currentView;
      for(const item of context.navItems??[])item.classList.toggle("active",item.dataset.view === current);
      for(const name of ["home","search","favorites","playlists"]) {const view=node(name+"View");if(view){view.hidden=name !== current;view.classList.toggle("is-active",name === current);}}
      const placeholder=node("placeholderView"),title=node("placeholderTitle");if(placeholder)placeholder.hidden=["home","search","favorites","playlists"].includes(current??"");if(title && !placeholder?.hidden)title.textContent=state.session.placeholderTitle;
    }
    previous = model;
  };
}
export { attachSettingsControlPorts };
