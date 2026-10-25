import {setModalStage} from "../../app/shell-stages.ts";
import {accentChannels,projectImageForeground} from "./settings-state.ts";
import type {SettingsSnapshot} from "./settings-state.ts";
import type {SettingsDom} from "./appearance.ts";
function prepareSettingsPanel(dom:SettingsDom):void { setModalStage("settings",{hidden:false}); }
function renderSettingsSnapshot(state:SettingsSnapshot,previous:SettingsSnapshot|null,dom:SettingsDom):void {
  const before=previous?.view,view=state.view;
  if(view.themeVersion && view.themeVersion !== before?.themeVersion) {
    dom.root.dataset.theme=state.theme??"dark";
    if(state.theme === "dynamic") for(const property of ["--glass-blur","--panel-alpha","--background-dim"]) dom.root.style.removeProperty(property);
  }
  if(view.sliders && view.sliders !== before?.sliders) {
    const kind=view.sliders.kind;
    if(kind === "all" || kind === "blur") dom.root.style.setProperty("--glass-blur",state.glassBlur+"px");
    if(kind === "all" || kind === "dim") dom.root.style.setProperty("--background-dim",String(state.backgroundDim/100));
  }
  if(view.accent && view.accent !== before?.accent) accentChannels(state.accentColor,view.accent.theme).forEach((channel,index)=>dom.root.style.setProperty('--accent-'+['r','g','b'][index],String(channel)));
  if(view.backgroundVersion && view.backgroundVersion !== before?.backgroundVersion) {
    if(state.background) dom.root.style.setProperty("--app-background",'url("'+state.background.dataUrl+'")');
    else dom.root.style.removeProperty("--app-background");
  }
  projectImageForeground(state);
  const session = state.session;
  if (session.panelVersion && session.panelVersion !== previous?.session.panelVersion) {
    if (session.panelOpen) requestAnimationFrame(() => {
      setModalStage("settings",{open:true});
    });
    else {
      if (dom.settingsModal.contains(document.activeElement)) dom.openSettingsButton.focus({
        preventScroll: true
      });
      setModalStage("settings",{open:false});
    }
  }
}
function finishSettingsPanelTransition(event: TransitionEvent, dom: SettingsDom): void {
  if (event.target === dom.settingsModal && !dom.settingsModal.classList.contains("is-open")) setModalStage("settings",{hidden:true});
}
export { finishSettingsPanelTransition, prepareSettingsPanel, renderSettingsSnapshot };
