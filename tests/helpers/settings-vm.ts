import path from "node:path";
import vm from "node:vm";
import { readFileSync } from "./module-syntax.ts";
const settingsUi = path.join(import.meta.dirname, "../../ui");
const settingsVmSource = ["page-selection.ts", "settings-state.ts", "settings-view.ts", "settings-adapter.ts"].map(file => readFileSync(path.join(settingsUi, file), "utf8")).join("\n");
function attachSettingsVm(context: vm.Context): void {
  const node = () => ({ value: "", textContent: "", hidden: false, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, removeAttribute() {}, contains() { return false; }, querySelector() { return null; } });
  for (const name of ["root","navItems","homeView","searchView","favoritesView","playlistsView","placeholderView","placeholderTitle","settingsModal","openSettingsButton","themeOptions","accentColorOptions","chooseBackgroundButton","backgroundName","appearanceStatus","imageOnlyGroups","glassBlurSlider","glassBlurValue","panelAlphaSlider","panelAlphaValue","backgroundDimSlider","backgroundDimValue","streamSourceSelect","streamSourceStatus","audioCacheEnabled","audioCacheCapacity","shuffleCollectionOrder","shuffleCollectionLimit","audioCacheUsage","audioCacheStatus","clearAudioCacheButton","aiApiFormatSelect","aiBaseUrlInput","aiModelInput","aiApiKeyInput","saveAiConfigButton","testAiConnectionButton","aiConfigStatus","shortcutRecordButtons"]) if (!(name in context)) context[name] = ["navItems", "themeOptions", "accentColorOptions", "imageOnlyGroups", "shortcutRecordButtons"].includes(name) ? [] : node();
  context.root.style.setProperty ??= () => {};
  context.root.style.removeProperty ??= () => {};
  context.document ??= { documentElement: context.root, activeElement: null };
  context.requestAnimationFrame ??= () => {};
  context.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  context.getSettingsDomForTest = () => context;
  vm.runInContext(settingsVmSource + `
let settingsForTest = initialSettingsState();
    if (typeof shortcutBindings !== "undefined") settingsForTest.shortcutBindings = { ...settingsForTest.shortcutBindings, ...shortcutBindings };
    const settingsActionsForTest = createSettingsActions(() => settingsForTest, next => { const previous = settingsForTest; settingsForTest = next; renderSettingsSnapshot(next, previous, getSettingsDomForTest()); }, {
      invoke: (...args) => invokeAppearance(...args), report() {}, settings: {
        getItem: key => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key === "bilibili-music.theme" && typeof THEME_KEY !== "undefined" ? THEME_KEY : key, value),
        removeItem: key => localStorage.removeItem(key),
        cancelCacheNotice: () => { if (typeof audioCacheStatusTimer !== "undefined") { if (audioCacheStatusTimer !== null) clearTimeout(audioCacheStatusTimer); audioCacheStatusTimer = null; } },
        scheduleCacheNotice: callback => setTimeout(callback, 3000),
      }
    });
    function getSettingsActions() { return settingsActionsForTest; }
    function getSettingsSnapshot() { return settingsForTest; }
    function settingsDom() { return getSettingsDomForTest(); }
  `, context);
}
export { attachSettingsVm };
