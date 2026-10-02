const searchForm = document.querySelector("#search-form");

const searchKeyword = document.querySelector("#search-keyword");

const searchButton = document.querySelector("#search-button");

const musicTabs = [...document.querySelectorAll(".music-tab[data-tids]")];

const sortModeTabs = [...document.querySelectorAll(".music-tab[data-sort-mode]")];

const searchStatus = document.querySelector("#search-status");

const playbackNotice = document.querySelector("#playback-notice");

const searchResults = document.querySelector("#search-results");

const homePanel = document.querySelector("#view-home");

const homeModeTabs = [...document.querySelectorAll(".home-mode-tab[data-home-mode]")];

const homeSourceLabel = document.querySelector("#home-source-label");

const homeTitle = document.querySelector("#home-title");

const homeSubtitle = homePanel?.querySelector(".home-subtitle");

const homeCacheNote = document.querySelector("#home-cache-note");

const homeListLabel = document.querySelector("#home-list-label");

const homeRankingStatus = document.querySelector("#home-ranking-status");

const homeRankingError = document.querySelector("#home-ranking-error");

const homeRankingList = document.querySelector("#home-ranking-list");

const homeSetupHint = document.querySelector("#home-setup-hint");

const homeSetupTitle = document.querySelector("#home-setup-title");

const homeSetupSub = document.querySelector("#home-setup-sub");

const homeSetupSettings = document.querySelector("#home-setup-settings");

const refreshRankingButton = document.querySelector("#refresh-ranking-button");

const homeHintRow = document.querySelector("#home-hint-row");

const homeHintInput = document.querySelector("#home-hint-input");

const homeHintApply = document.querySelector("#home-hint-apply");

const queueCount = document.querySelector("#queue-count");

const status = document.querySelector("#status");

const result = document.querySelector("#result");

const thumbnail = document.querySelector("#thumbnail");

const title = document.querySelector("#title");

const uploader = document.querySelector("#uploader");

const duration = document.querySelector("#duration");

const queuePosition = document.querySelector("#queue-position");

const playerPagesButton = document.querySelector("#player-pages-button");

const playerPagesGroup = document.querySelector(".player-pages-group");

const skipVideoButton = document.querySelector("#skip-video-button");

const previousButton = document.querySelector("#previous-button");

const nextButton = document.querySelector("#next-button");

const loopModeButton = document.querySelector("#loop-mode-button");

const shuffleToggle = document.querySelector("#shuffle-toggle");

const audio = document.querySelector("#audio");

const resumePlayPauseButton = document.querySelector("#play-pause-button");

const resumeProgressSlider = document.querySelector("#progress-slider");

const resumeCurrentTimeLabel = document.querySelector("#current-time");

const immersiveResumeProgressSlider = document.querySelector("#immersive-progress-slider");

const immersiveResumeCurrentTimeLabel = document.querySelector("#immersive-current-time");

const immersiveResumeDurationLabel = document.querySelector("#immersive-duration");

const favoritesStatus = document.querySelector("#favorites-status");

const favoritesCount = document.querySelector("#favorites-count");

const favoritesList = document.querySelector("#favorites-list");

const playlistsStatus = document.querySelector("#playlists-status");

const playlistsList = document.querySelector("#playlists-list");

const playlistTitle = document.querySelector("#playlist-title");

const playlistMeta = document.querySelector("#playlist-meta");

const playlistTracks = document.querySelector("#playlist-tracks");

const playlistActions = document.querySelector("#playlist-actions");

const createPlaylistButton = document.querySelector("#create-playlist-button");

const renamePlaylistButton = document.querySelector("#rename-playlist-button");

const deletePlaylistButton = document.querySelector("#delete-playlist-button");

const favoriteCurrentButton = document.querySelector("#favorite-current-button");

const immersiveFavoriteButton = document.querySelector("#immersive-favorite-button");

const libraryModal = document.querySelector("#library-modal");

const closeLibraryModalButton = document.querySelector("#close-library-modal-button");

const libraryModalTitle = document.querySelector("#library-modal-title");

const libraryModalSubtitle = document.querySelector("#library-modal-subtitle");

const libraryModalBody = document.querySelector("#library-modal-body");

const libraryModalStatus = document.querySelector("#library-modal-status");

const purgeUnavailableTracksButton = document.querySelector("#purge-unavailable-tracks-button");

const purgeAppearanceStatus = document.querySelector("#appearance-status");

const pagesModal = document.querySelector("#pages-modal");

const pagesModalTitle = document.querySelector("#pages-modal-title");

const pagesModalSub = document.querySelector("#pages-modal-sub");

const pagesModalRestoreAll = document.querySelector("#pages-modal-restore-all");

const pagesModalStatus = document.querySelector("#pages-modal-status");

const pagesModalList = document.querySelector("#pages-modal-list");

const pagesModalClose = document.querySelector("#pages-modal-close");

export { audio, closeLibraryModalButton, createPlaylistButton, deletePlaylistButton, duration, favoriteCurrentButton, favoritesCount, favoritesList, favoritesStatus, homeCacheNote, homeHintApply, homeHintInput, homeHintRow, homeListLabel, homeModeTabs, homePanel, homeRankingError, homeRankingList, homeRankingStatus, homeSetupHint, homeSetupSettings, homeSetupSub, homeSetupTitle, homeSourceLabel, homeSubtitle, homeTitle, immersiveFavoriteButton, immersiveResumeCurrentTimeLabel, immersiveResumeDurationLabel, immersiveResumeProgressSlider, libraryModal, libraryModalBody, libraryModalStatus, libraryModalSubtitle, libraryModalTitle, loopModeButton, musicTabs, nextButton, pagesModal, pagesModalClose, pagesModalList, pagesModalRestoreAll, pagesModalStatus, pagesModalSub, pagesModalTitle, playbackNotice, playerPagesButton, playerPagesGroup, playlistActions, playlistMeta, playlistTitle, playlistTracks, playlistsList, playlistsStatus, previousButton, purgeAppearanceStatus, purgeUnavailableTracksButton, queueCount, queuePosition, refreshRankingButton, renamePlaylistButton, result, resumeCurrentTimeLabel, resumePlayPauseButton, resumeProgressSlider, searchButton, searchForm, searchKeyword, searchResults, searchStatus, shuffleToggle, skipVideoButton, sortModeTabs, status, thumbnail, title, uploader };
