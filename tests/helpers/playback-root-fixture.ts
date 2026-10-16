import {applySettingsField} from "../../ui/features/settings/components/field-directive.ts";
import {attachSettingsControlPorts} from "./settings-controls-fixture.ts";
import type vm from "node:vm";
import type { createApplicationStore } from "../../ui/store/app-state.ts";
import { projectPlaybackControls, projectPlaybackProgress } from "../../ui/features/playback/playback-display-view.ts";
import { projectPlaybackMessages } from "../../ui/features/playback/playback-messages-projection.ts";
import type { PlaybackCallbacks } from "../../ui/features/playback/root-playback.ts";

const legacyPlaybackNodeNames = ["duration", "favoriteCurrentButton", "immersiveFavoriteButton", "immersiveResumeCurrentTimeLabel", "immersiveResumeDurationLabel", "immersiveResumeProgressSlider", "loopModeButton", "nextButton", "playbackNotice", "playerPagesGroup", "previousButton", "queuePosition", "resumeCurrentTimeLabel", "resumeProgressSlider", "shuffleToggle", "skipVideoButton", "status", "thumbnail", "title", "uploader"];

// Installation-before fixtures use native output ports; installed tests mount the real App.
function mountPlaybackFixtureRoot(context: vm.Context, store: ReturnType<typeof createApplicationStore>): void {
  context.playbackBarNode ??= context.result;
  context.revealPlaybackBar ??= ()=>{if(context.result)context.result.hidden=false;};
  const settingsPort=attachSettingsControlPorts(context);
  store.subscribe(state=>settingsPort(state.settings));
  context.readSearchDraft ??= () => context.searchKeyword?.value ?? "";
  context.writeSearchDraft ??= (value: string) => { if(context.searchKeyword) context.searchKeyword.value=value; };
  context.readHomeHintDraft ??= () => context.homeHintInput?.value ?? "";
  context.installPageCallbacks ??= (callbacks: {submit?: (event: unknown)=>void}) => { if(callbacks.submit) context.searchForm?.addEventListener("submit",callbacks.submit); };
  const initialTrack = store.getState().playbackDisplay.renderedTrack;
  const rendered = new WeakMap<object, Map<string, unknown>>();
  const node = (binding: string, id: string) => context[binding] ?? context.document?.querySelector?.("#" + id);
  function write(target: vm.Context | undefined, key: string, value: unknown) {
    if (!target) return;
    let values = rendered.get(target); if (!values) { values = new Map(); rendered.set(target, values); }
    if (values.has(key) && Object.is(values.get(key), value)) return;
    values.set(key, value);
    if (key.startsWith("class:")) target.classList?.toggle?.(key.slice(6), value);
    else if (key.startsWith("data:")) { if (target.dataset) target.dataset[key.slice(5)] = value; }
    else if (key.startsWith("attr:")) target.setAttribute?.(key.slice(5), value);
    else if (key === "progress") target.style?.setProperty("--progress", value);
    else target[key] = value;
  }
  let rendering = false, normalizationVersion = 0;
  const render = () => {
    if (rendering) return;
    rendering = true;
    try {
    const state = store.getState(), display = state.playbackDisplay, messages = projectPlaybackMessages(state.playbackMessages);
    const normalization = node("loudnessNormalizationToggle","loudness-normalization-toggle");
    if(normalization) applySettingsField(normalization,{checked:state.playbackSettings.normalizationEnabled,checkedVersion:state.playbackSettings.view.enabledVersion},{checkedVersion:normalizationVersion});
    normalizationVersion = state.playbackSettings.view.enabledVersion;
    if (state.playbackMessages.statusVersion) write(context.status, "textContent", messages.status);
    if (state.playbackMessages.notice.version && context.playbackNotice) {
      const notice = context.playbackNotice;
      if (messages.kind !== null) write(notice, "data:kind", messages.kind);
      write(notice, "textContent", messages.notice);
      const classes = rendered.get(notice) ?? new Map();
      if (classes.get("noticeVisible") !== messages.visible) notice.classList?.[messages.visible ? "add" : "remove"]?.("is-visible");
      classes.set("noticeVisible", messages.visible); rendered.set(notice, classes);
    }
    if (messages.x !== null) context.playbackNotice?.style?.setProperty("--playback-notice-x", `${messages.x}px`);
    if (display.view.progressVersion || display.presentation.restoredPosition !== null) {
      const timeline = projectPlaybackProgress(display);
      for (const [binding, id] of [["resumeProgressSlider", "progress-slider"], ["immersiveResumeProgressSlider", "immersive-progress-slider"]]) {
        const target = node(binding, id); write(target, "max", String(timeline.max)); write(target, "value", String(timeline.value)); write(target, "progress", timeline.progress);
      }
      for (const [binding, id] of [["resumeCurrentTimeLabel", "current-time"], ["immersiveResumeCurrentTimeLabel", "immersive-current-time"]]) write(node(binding, id), "textContent", timeline.currentTime);
      write(node("immersiveResumeDurationLabel", "immersive-duration"), "textContent", timeline.duration);
    }
    if (display.presentation.duration !== "0:00" || display.view.progressVersion) write(node("duration", "duration"), "textContent", display.presentation.duration);
    if (display.view.buttonVersion) for (const [binding, id] of [["resumePlayPauseButton", "play-pause-button"], ["immersivePlayPauseButton", "immersive-play-pause-button"]]) {
      write(node(binding, id), "data:playing", String(display.buttonPlaying)); write(node(binding, id), "attr:aria-label", display.buttonPlaying ? "暂停" : "播放");
    }
    if (display.renderedTrack !== initialTrack) {
      write(node("title", "title"), "textContent", display.renderedTrack.title); write(node("uploader", "uploader"), "textContent", display.renderedTrack.uploader); write(node("thumbnail", "thumbnail"), "src", display.renderedTrack.thumbnailUrl);
    }
    if (state.playbackSettings.view.volumeVersion) {
      write(node("volumeSlider", "volume-slider"), "value", String(state.playbackSettings.userVolume)); write(node("volumeSlider", "volume-slider"), "progress", `${state.playbackSettings.userVolume * 100}%`);
    }
    if (typeof context.getQueueSnapshot === "function") {
      const queue = context.getQueueSnapshot(), library = context.libraryState ?? state.library;
      const controls = projectPlaybackControls(queue, state.playbackSession, library.favoriteBvids ?? new Set());
      write(context.queuePosition, "textContent", controls.queuePosition);
      write(context.loopModeButton, "data:loopMode", queue.loopMode);
      if (controls.loopLabel !== null) {
        write(context.loopModeButton, "title", controls.loopLabel); write(context.loopModeButton, "attr:aria-label", controls.loopLabel); write(context.loopModeButton, "class:is-active", queue.loopMode !== "sequence"); write(context.shuffleToggle, "checked", queue.shuffle);
      }
      for (const [binding, id] of [["favoriteCurrentButton", "favorite-current-button"], ["immersiveFavoriteButton", "immersive-favorite-button"]]) {
        const target = node(binding, id); write(target, "disabled", controls.favoriteDisabled); write(target, "data:favoriteBvid", controls.bvid); write(target, "class:is-favorited", controls.favorited); write(target, "title", controls.favoriteTitle); write(target, "textContent", binding === "favoriteCurrentButton" ? controls.favoriteText : controls.immersiveFavoriteText);
      }
      write(context.playerPagesButton, "hidden", controls.pagesHidden); write(context.playerPagesGroup, "hidden", controls.pagesHidden);
      if (!controls.pagesHidden) { write(context.playerPagesButton, "textContent", controls.pagesText); write(context.playerPagesButton, "attr:aria-label", controls.pagesLabel); write(context.playerPagesButton, "title", "查看分P"); }
    }
    } finally { rendering = false; }
  };
  context.__renderFixtureRoot = render;
  store.subscribe(render);
  context.installPlaybackCallbacks ??= (callbacks: Partial<PlaybackCallbacks>) => {
    const bindings: [keyof PlaybackCallbacks, string, string, string][] = [
      ["previous", "previousButton", "previous-button", "click"], ["next", "nextButton", "next-button", "click"],
      ["loop", "loopModeButton", "loop-mode-button", "click"], ["shuffle", "shuffleToggle", "shuffle-toggle", "change"],
      ["toggle", "resumePlayPauseButton", "play-pause-button", "click"], ["toggleImmersive", "immersivePlayPauseButton", "immersive-play-pause-button", "click"],
      ["previousImmersive", "immersivePreviousButton", "immersive-previous-button", "click"], ["nextImmersive", "immersiveNextButton", "immersive-next-button", "click"],
      ["volume", "volumeSlider", "volume-slider", "input"], ["skip", "skipVideoButton", "skip-video-button", "click"],
    ];
    for (const [key, binding, id, event] of bindings) {
      const target = node(binding, id), callback = callbacks[key];
      if (target?.addEventListener && callback) target.addEventListener(event, () => Reflect.apply(callback, undefined, key === "shuffle" ? [target.checked] : key === "volume" ? [target.value] : []));
    }
    for (const [binding, id] of [["resumeProgressSlider", "progress-slider"], ["immersiveResumeProgressSlider", "immersive-progress-slider"]]) {
      const target = node(binding, id);
      if (callbacks.seekStart) target?.addEventListener?.("pointerdown", callbacks.seekStart);
      if (callbacks.preview) target?.addEventListener?.("input", () => callbacks.preview!(target.value));
      if (callbacks.seek) target?.addEventListener?.("change", () => callbacks.seek!(target.value));
    }
  };
}
export { legacyPlaybackNodeNames, mountPlaybackFixtureRoot };
