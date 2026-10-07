import { displayThumbnailUrl, formatDuration, formatPlayCount, formatPubdate } from "./track-utils.ts";
import type { SearchSnapshot } from "./search-state.ts";
import { musicTabs, result, searchButton, searchResults, searchStatus, sortModeTabs } from "./player-dom.ts";

type SearchRowBindings = {
  createActions(video: SearchSnapshot["results"][number]): HTMLElement;
  bindActivation(item: HTMLElement, button: HTMLButtonElement, video: SearchSnapshot["results"][number], activate: (selection?: { startPage?: CommandContract.VideoPage; pages?: CommandContract.VideoPage[] }) => void): void;
  play(index: number, selection?: { startPage?: CommandContract.VideoPage; pages?: CommandContract.VideoPage[] }): void;
};

function renderSearchRows(search: SearchSnapshot, bindings: SearchRowBindings): void {
  searchResults.replaceChildren();

  search.results.forEach((video, index) => {
    const item = document.createElement("li");
    item.className = "track-row";
    const playButton = document.createElement("button");
    const eq = document.createElement("span");
    const coverWrap = document.createElement("span");
    const meta = document.createElement("span");
    const trackTitle = document.createElement("span");
    const trackUp = document.createElement("span");
    const trackPlay = document.createElement("span");
    const trackPubdate = document.createElement("span");
    const trackDuration = document.createElement("span");

    playButton.type = "button";
    playButton.className = "track";
    playButton.dataset.resultIndex = String(index);

    eq.className = "eq";
    eq.setAttribute("aria-hidden", "true");
    eq.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    playButton.append(eq);

    coverWrap.className = "track-cover";
    if (video.thumbnailUrl) {
      const cover = document.createElement("img");
      cover.src = displayThumbnailUrl(video.thumbnailUrl);
      cover.alt = "";
      cover.loading = "lazy";
      cover.referrerPolicy = "no-referrer";
      coverWrap.append(cover);
    } else {
      const coverPlaceholder = document.createElement("span");
      coverPlaceholder.className = "cover-placeholder";
      coverWrap.append(coverPlaceholder);
    }
    playButton.append(coverWrap);

    meta.className = "track-meta";
    trackTitle.className = "track-title";
    trackTitle.textContent = video.title || video.bvid;
    trackUp.className = "track-up";
    trackUp.textContent = video.uploader || video.bvid;
    meta.append(trackTitle, trackUp);
    playButton.append(meta);

    trackPlay.className = "track-play";
    trackPlay.textContent = formatPlayCount(video.playCount);
    playButton.append(trackPlay);

    trackPubdate.className = "track-pubdate";
    trackPubdate.textContent = formatPubdate(video.pubdate);
    playButton.append(trackPubdate);

    trackDuration.className = "track-duration";
    trackDuration.textContent = video.durationSeconds
      ? formatDuration(video.durationSeconds)
      : "0:00";
    playButton.append(trackDuration);

    item.append(playButton, bindings.createActions(video));
    bindings.bindActivation(item, playButton, video, (pageSelection) =>
      bindings.play(index, pageSelection));
    searchResults.append(item);
  });
}

function renderMusicTabs(search: SearchSnapshot): void {
  for (const tab of musicTabs) {
    const selected = Number(tab.dataset.tids) === search.tids;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
}

function renderSortTabs(search: SearchSnapshot): void {
  for (const tab of sortModeTabs) {
    const selected = tab.dataset.sortMode === search.sortMode;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
}

function renderSearchSnapshot(search: SearchSnapshot, previous: SearchSnapshot | null, bindings: SearchRowBindings): boolean {
  const view = search.view;
  if (view.status !== null && view.status !== previous?.view.status) searchStatus.textContent = view.status;
  if (view.buttonDisabled !== null && view.buttonDisabled !== previous?.view.buttonDisabled) searchButton.disabled = view.buttonDisabled;
  if (view.resultVisible !== null && view.resultVisible !== previous?.view.resultVisible) result.hidden = !view.resultVisible;
  if (view.musicVersion !== null && view.musicVersion !== previous?.view.musicVersion) renderMusicTabs(search);
  if (view.sortVersion !== null && view.sortVersion !== previous?.view.sortVersion) renderSortTabs(search);
  if (view.rowsVersion !== null && view.rowsVersion !== previous?.view.rowsVersion) {
    renderSearchRows(search, bindings); return true;
  }
  return false;
}

export { renderSearchSnapshot };
