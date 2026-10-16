import {accentChannels} from "./settings-state.ts";
import type {SettingsSnapshot} from "./settings-state.ts";
import type {SettingsDom} from "./appearance.ts";
function prepareSettingsPanel(dom:SettingsDom):void { dom.settingsModal.hidden=false; }
function renderSettingsSnapshot(state:SettingsSnapshot,previous:SettingsSnapshot|null,dom:SettingsDom):void {
  const before=previous?.view,view=state.view;
  if(view.themeVersion && view.themeVersion !== before?.themeVersion) {
    dom.root.dataset.theme=state.theme??"dark";
    if(state.theme === "dynamic") for(const property of ["--glass-blur","--panel-alpha","--background-dim"]) dom.root.style.removeProperty(property);
  }
  if(view.sliders && view.sliders !== before?.sliders) {
    const kind=view.sliders.kind;
    if(kind === "all" || kind === "blur") dom.root.style.setProperty("--glass-blur",state.glassBlur+"px");
    if(kind === "all" || kind === "alpha") dom.root.style.setProperty("--panel-alpha",String(state.panelAlpha/100));
    if(kind === "all" || kind === "dim") dom.root.style.setProperty("--background-dim",String(state.backgroundDim/100));
  }
  if(view.accent && view.accent !== before?.accent) accentChannels(state.accentColor,view.accent.theme).forEach((channel,index)=>dom.root.style.setProperty('--accent-'+['r','g','b'][index],String(channel)));
  if(view.backgroundVersion && view.backgroundVersion !== before?.backgroundVersion) {
    if(state.background) dom.root.style.setProperty("--app-background",'url("'+state.background.dataUrl+'")');
    else dom.root.style.removeProperty("--app-background");
  }
  const session = state.session;
  if (session.navigationVersion && session.navigationVersion !== previous?.session.navigationVersion) {
    for (const item of dom.navItems) item.classList.toggle("active", item.dataset.view === session.currentView);
    const realViews: Partial<Record<string, HTMLElement>> = {
      home: dom.homeView, search: dom.searchView, favorites: dom.favoritesView, playlists: dom.playlistsView
    };
    for (const [name, element] of Object.entries(realViews)) {
      if (!element) continue;
      element.hidden = name !== session.currentView;
      element.classList.toggle("is-active", name === session.currentView);
    }
    const real = session.currentView ? realViews[session.currentView] : null;
    dom.placeholderView.hidden = Boolean(real);
    if (!real) dom.placeholderTitle.textContent = session.placeholderTitle;
  }
  if (session.panelVersion && session.panelVersion !== previous?.session.panelVersion) {
    if (session.panelOpen) requestAnimationFrame(() => {
      dom.settingsModal.classList.add("is-open");
      dom.settingsModal.setAttribute("aria-hidden", "false");
    });
    else {
      if (dom.settingsModal.contains(document.activeElement)) dom.openSettingsButton.focus({
        preventScroll: true
      });
      dom.settingsModal.classList.remove("is-open");
      dom.settingsModal.setAttribute("aria-hidden", "true");
    }
  }
}
function finishSettingsPanelTransition(event: TransitionEvent, dom: SettingsDom): void {
  if (event.target === dom.settingsModal && !dom.settingsModal.classList.contains("is-open")) dom.settingsModal.hidden = true;
}
export { finishSettingsPanelTransition, prepareSettingsPanel, renderSettingsSnapshot };
