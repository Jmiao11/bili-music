import { readApplicationStore } from "../../store/application-store.ts";
import { playListItem, savePlaybackState, updateQueueUi } from "../playback/playback-core.ts";
import { installCollectionCallbacks } from "./collection-port.ts";
import { LOAD_MORE_THRESHOLD_PX } from "../../shared/controller-runtime.ts";

function openCollection(): void {
  const state = readApplicationStore().getState();
  const prompt = state.collection.prompt;
  if (!prompt) return;
  const previousView = state.settings.session.currentView ?? "home";
  const previousScroll = document.querySelector<HTMLElement>(`#view-${previousView} .tracklist`)?.scrollTop ?? 0;
  readApplicationStore().actions.collection.open({ kind: "collection", bvid: prompt.bvid, id: prompt.summary.id }, prompt.summary.title, prompt.summary.total, previousView, previousScroll);
}

function closeCollection(): void {
  const state = readApplicationStore().getState().collection;
  readApplicationStore().actions.collection.close();
  const list = document.querySelector<HTMLElement>(`#view-${state.previousView} .tracklist`);
  list?.scrollTo({ top: state.previousScroll });
}

function loadMoreCollection(): Promise<void> {
  return readApplicationStore().actions.collection.loadNextPage((items, version) => {
    if (readApplicationStore().actions.playbackQueue.appendSearchQueue(items, version, Math.random, "collection")) {
      savePlaybackState(); updateQueueUi();
    }
  });
}

function playCollectionItem(index: number): void {
  const state = readApplicationStore().getState().collection;
  playListItem("collection", state.items, index, { searchVersion: state.requestVersion });
}

function onCollectionScroll(event: Event): void {
  const list = event.currentTarget as HTMLElement;
  if (list.scrollHeight - list.scrollTop - list.clientHeight <= LOAD_MORE_THRESHOLD_PX) void loadMoreCollection();
}
const collectionCallbacks = { open: openCollection, close: closeCollection, retry: loadMoreCollection, scroll: onCollectionScroll };
installCollectionCallbacks(collectionCallbacks);
export { collectionCallbacks, loadMoreCollection, playCollectionItem };
