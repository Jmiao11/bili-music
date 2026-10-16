const audio=document.querySelector<HTMLAudioElement>("#audio")!;
let searchResults: HTMLUListElement;
let homeRankingError: HTMLParagraphElement;
let homeRankingList: HTMLUListElement;
let refreshRankingButton: HTMLButtonElement;
let homeHintInput: HTMLInputElement;
let homeHintApply: HTMLButtonElement;
let playbackBarNode: HTMLElement;
let playerPagesButton: HTMLButtonElement;
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
const homeModeTabs: (HTMLElement & {dataset:DOMStringMap & {homeMode:string}})[]=[];
const mainWindowRefs={
 searchResults:(node:HTMLUListElement|null):void=>{if(node)searchResults=node;},
 homeRankingError:(node:HTMLParagraphElement|null):void=>{if(node)homeRankingError=node;},
 homeRankingList:(node:HTMLUListElement|null):void=>{if(node)homeRankingList=node;},
 refreshRankingButton:(node:HTMLButtonElement|null):void=>{if(node)refreshRankingButton=node;},
 homeHintInput:(node:HTMLInputElement|null):void=>{if(node)homeHintInput=node;},
 homeHintApply:(node:HTMLButtonElement|null):void=>{if(node)homeHintApply=node;},
 result:(node:HTMLElement|null):void=>{if(node)playbackBarNode=node;},
 playerPagesButton:(node:HTMLButtonElement|null):void=>{if(node)playerPagesButton=node;},
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
export { audio, searchResults, homeRankingError, homeRankingList, refreshRankingButton, homeHintInput, homeHintApply, playbackBarNode, playerPagesButton, resumePlayPauseButton, favoritesList, playlistsList, playlistTracks, libraryModal, closeLibraryModalButton, libraryModalBody, pagesModal, pagesModalRestoreAll, pagesModalList, pagesModalClose, homeModeTabs };
export {mainWindowRefs};
