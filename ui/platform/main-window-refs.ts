import type { HomeFeed } from "../features/home/home-view.ts";

const audio=document.querySelector<HTMLAudioElement>("#audio")!;
let searchResults: HTMLUListElement;
let homeRankingError: HTMLParagraphElement | null = null;
let homeRankingRetry: (() => void) | null = null;
const homeFeedRefs = { back: null as HTMLButtonElement | null, open: { ranking: null, newSongs: null } as Record<HomeFeed, HTMLButtonElement | null> };
let refreshRankingButton: HTMLButtonElement;
let homeHintInput: HTMLInputElement;
let homeHintApply: HTMLButtonElement;
let playbackBarNode: HTMLElement;
let playerPagesButton: HTMLButtonElement;
const playerQualityRefs = { button: null as HTMLButtonElement | null, menu: null as HTMLElement | null };
let resumePlayPauseButton: HTMLButtonElement;
let favoritesList: HTMLUListElement;
let playlistsList: HTMLUListElement;
let playlistTracks: HTMLUListElement;
let libraryModal: HTMLDivElement;
let closeLibraryModalButton: HTMLButtonElement;
let libraryModalBody: HTMLDivElement;
let pagesModal: HTMLDivElement;
let pagesModalRestoreAll: HTMLButtonElement;
let pagesModalList: HTMLUListElement;
let pagesModalClose: HTMLButtonElement;
const queueDrawerRefs = { button: null as HTMLButtonElement | null, drawer: null as HTMLElement | null, list: null as HTMLUListElement | null, close: null as HTMLButtonElement | null, clear: null as HTMLButtonElement | null, confirm: null as HTMLElement | null };
const mainWindowRefs={
 queueButton:(node:HTMLButtonElement|null):void=>{queueDrawerRefs.button=node;},
 queueDrawer:(node:HTMLElement|null):void=>{queueDrawerRefs.drawer=node;},
 queueDrawerList:(node:HTMLUListElement|null):void=>{queueDrawerRefs.list=node;},
 queueDrawerClose:(node:HTMLButtonElement|null):void=>{queueDrawerRefs.close=node;},
 queueDrawerClear:(node:HTMLButtonElement|null):void=>{queueDrawerRefs.clear=node;},
 queueDrawerConfirm:(node:HTMLElement|null):void=>{queueDrawerRefs.confirm=node;},
 searchResults:(node:HTMLUListElement|null):void=>{if(node)searchResults=node;},
 homeRankingError:(node:HTMLParagraphElement|null):void=>{
   if (homeRankingError === node) return;
   if (homeRankingRetry) homeRankingError?.removeEventListener("click", homeRankingRetry);
   homeRankingError = node;
   if (homeRankingRetry) node?.addEventListener("click", homeRankingRetry);
 },
 homeFeedBack:(node:HTMLButtonElement|null):void=>{homeFeedRefs.back=node;},
 homeFeedCardOpen:(source:HomeFeed,node:HTMLButtonElement|null):void=>{homeFeedRefs.open[source]=node;},
 refreshRankingButton:(node:HTMLButtonElement|null):void=>{if(node)refreshRankingButton=node;},
 homeHintInput:(node:HTMLInputElement|null):void=>{if(node)homeHintInput=node;},
 homeHintApply:(node:HTMLButtonElement|null):void=>{if(node)homeHintApply=node;},
 result:(node:HTMLElement|null):void=>{if(node)playbackBarNode=node;},
 playerPagesButton:(node:HTMLButtonElement|null):void=>{if(node)playerPagesButton=node;},
 playerQualityButton:(node:HTMLButtonElement|null):void=>{playerQualityRefs.button=node;},
 playerQualityMenu:(node:HTMLElement|null):void=>{playerQualityRefs.menu=node;},
 resumePlayPauseButton:(node:HTMLButtonElement|null):void=>{if(node)resumePlayPauseButton=node;},
 favoritesList:(node:HTMLUListElement|null):void=>{if(node)favoritesList=node;},
 playlistsList:(node:HTMLUListElement|null):void=>{if(node)playlistsList=node;},
 playlistTracks:(node:HTMLUListElement|null):void=>{if(node)playlistTracks=node;},
 libraryModal:(node:HTMLDivElement|null):void=>{if(node)libraryModal=node;},
 closeLibraryModalButton:(node:HTMLButtonElement|null):void=>{if(node)closeLibraryModalButton=node;},
 libraryModalBody:(node:HTMLDivElement|null):void=>{if(node)libraryModalBody=node;},
 pagesModal:(node:HTMLDivElement|null):void=>{if(node)pagesModal=node;},
 pagesModalRestoreAll:(node:HTMLButtonElement|null):void=>{if(node)pagesModalRestoreAll=node;},
 pagesModalList:(node:HTMLUListElement|null):void=>{if(node)pagesModalList=node;},
 pagesModalClose:(node:HTMLButtonElement|null):void=>{if(node)pagesModalClose=node;},
};
function installHomeRankingRetry(onRetry: () => void): void {
  homeRankingRetry = onRetry;
  homeRankingError?.addEventListener("click", onRetry);
}
export { audio, searchResults, installHomeRankingRetry, homeFeedRefs, refreshRankingButton, homeHintInput, homeHintApply, playbackBarNode, playerPagesButton, resumePlayPauseButton, favoritesList, playlistsList, playlistTracks, libraryModal, closeLibraryModalButton, libraryModalBody, pagesModal, pagesModalRestoreAll, pagesModalList, pagesModalClose };
export {mainWindowRefs};
export {playerQualityRefs};

export { queueDrawerRefs };
