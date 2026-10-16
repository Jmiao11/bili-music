const searchKeyword = document.querySelector<HTMLInputElement>("#search-keyword")!;

const searchStatus = document.querySelector<HTMLParagraphElement>("#search-status")!;

const searchResults = document.querySelector<HTMLUListElement>("#search-results")!;

const homePanel = document.querySelector<HTMLElement>("#view-home")!;

const homeModeTabs = [...document.querySelectorAll<HTMLElement & { dataset: DOMStringMap & { homeMode: string } }>(".home-mode-tab[data-home-mode]")];

const homeSourceLabel = document.querySelector<HTMLSpanElement>("#home-source-label")!;

const homeTitle = document.querySelector<HTMLHeadingElement>("#home-title")!;

const homeSubtitle = homePanel?.querySelector<HTMLParagraphElement>(".home-subtitle");

const homeCacheNote = document.querySelector<HTMLSpanElement>("#home-cache-note")!;

const homeListLabel = document.querySelector<HTMLSpanElement>("#home-list-label")!;

const homeRankingStatus = document.querySelector<HTMLParagraphElement>("#home-ranking-status")!;

const homeRankingError = document.querySelector<HTMLParagraphElement>("#home-ranking-error")!;

const homeRankingList = document.querySelector<HTMLUListElement>("#home-ranking-list")!;

const refreshRankingButton = document.querySelector<HTMLButtonElement>("#refresh-ranking-button")!;

const homeHintInput = document.querySelector<HTMLInputElement>("#home-hint-input")!;

const homeHintApply = document.querySelector<HTMLButtonElement>("#home-hint-apply")!;

const queueCount = document.querySelector<HTMLSpanElement>("#queue-count")!;

const result = document.querySelector<HTMLElement>("#result")!;

const playerPagesButton = document.querySelector<HTMLButtonElement>("#player-pages-button")!;

const audio = document.querySelector<HTMLAudioElement>("#audio")!;

const resumePlayPauseButton = document.querySelector<HTMLButtonElement>("#play-pause-button")!;

const favoritesStatus = document.querySelector<HTMLParagraphElement>("#favorites-status")!;

const favoritesCount = document.querySelector<HTMLSpanElement>("#favorites-count")!;

const favoritesList = document.querySelector<HTMLUListElement>("#favorites-list")!;

const playlistsStatus = document.querySelector<HTMLParagraphElement>("#playlists-status")!;

const playlistsList = document.querySelector<HTMLUListElement>("#playlists-list")!;

const playlistTitle = document.querySelector<HTMLHeadingElement>("#playlist-title")!;

const playlistMeta = document.querySelector<HTMLParagraphElement>("#playlist-meta")!;

const playlistTracks = document.querySelector<HTMLUListElement>("#playlist-tracks")!;

const libraryModal = document.querySelector<HTMLDivElement>("#library-modal")!;

const closeLibraryModalButton = document.querySelector<HTMLButtonElement>("#close-library-modal-button")!;

const libraryModalTitle = document.querySelector<HTMLHeadingElement>("#library-modal-title")!;

const libraryModalSubtitle = document.querySelector<HTMLParagraphElement>("#library-modal-subtitle")!;

const libraryModalBody = document.querySelector<HTMLDivElement>("#library-modal-body")!;

const libraryModalStatus = document.querySelector<HTMLParagraphElement>("#library-modal-status")!;

const purgeUnavailableTracksButton = document.querySelector<HTMLButtonElement>("#purge-unavailable-tracks-button")!;

const purgeAppearanceStatus = document.querySelector<HTMLParagraphElement>("#appearance-status")!;

const pagesModal = document.querySelector<HTMLDivElement>("#pages-modal")!;

const pagesModalTitle = document.querySelector<HTMLHeadingElement>("#pages-modal-title")!;

const pagesModalSub = document.querySelector<HTMLParagraphElement>("#pages-modal-sub")!;

const pagesModalRestoreAll = document.querySelector<HTMLButtonElement>("#pages-modal-restore-all")!;

const pagesModalStatus = document.querySelector<HTMLParagraphElement>("#pages-modal-status")!;

const pagesModalList = document.querySelector<HTMLUListElement>("#pages-modal-list")!;

const pagesModalClose = document.querySelector<HTMLButtonElement>("#pages-modal-close")!;

export { audio, closeLibraryModalButton, favoritesCount, favoritesList, favoritesStatus, homeCacheNote, homeHintApply, homeHintInput, homeListLabel, homeModeTabs, homePanel, homeRankingError, homeRankingList, homeRankingStatus, homeSourceLabel, homeSubtitle, homeTitle, libraryModal, libraryModalBody, libraryModalStatus, libraryModalSubtitle, libraryModalTitle, pagesModal, pagesModalClose, pagesModalList, pagesModalRestoreAll, pagesModalStatus, pagesModalSub, pagesModalTitle, playerPagesButton, playlistMeta, playlistTitle, playlistTracks, playlistsList, playlistsStatus, purgeAppearanceStatus, purgeUnavailableTracksButton, queueCount, refreshRankingButton, result, resumePlayPauseButton, searchKeyword, searchResults, searchStatus };
