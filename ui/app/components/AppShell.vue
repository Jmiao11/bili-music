<script setup lang="ts">
import type {mainWindowRefs} from "../../platform/main-window-refs.ts";
import type {draftBindings} from "../../platform/draft-ports.ts";
import type { ShellProjection } from "../shell-projection.ts";
import type { ShellStages,SidebarPresentation } from "../shell-stages.ts";
import type { MascotPresentation } from "../mascot.ts";
import type { DynamicBackgroundPresentation } from "../../features/settings/dynamic-background.ts";
import type { RootModals } from "../root-modals.ts";
import type { libraryCallbacks, pagesCallbacks } from "../root-modals.ts";
import PagesList from "../../features/pages/components/PagesList.vue";
import LibraryModalBody from "../../features/library/components/LibraryModalBody.vue";
import SettingsPanel from "../../features/settings/components/SettingsPanel.vue";
import type {SettingsControls} from "../../features/settings/settings-controls.ts";
import type {SettingsCallbacks} from "../../features/settings/root-settings.ts";
import PlaylistActions from "../../features/library/components/PlaylistActions.vue";
import PlaylistCreateActions from "../../features/library/components/PlaylistCreateActions.vue";
import SearchTabs from "../../features/search/components/SearchTabs.vue";
import SearchForm from "../../features/search/components/SearchForm.vue";
import HomeSetupHint from "../../features/home/components/HomeSetupHint.vue";
import HomeHint from "../../features/home/components/HomeHint.vue";
import PlaybackBar from "../../features/playback/components/PlaybackBar.vue";
import ImmersivePlayer from "../../features/immersive/components/ImmersivePlayer.vue";
import PlaybackNotice from "../../features/playback/components/PlaybackNotice.vue";
import type { HomeControls, PageCallbacks } from "../root-controls.ts";
import type { ApplicationSnapshot } from "../../store/application-store.ts";
import type { PlaybackCallbacks, PlaybackControls } from "../../features/playback/root-playback.ts";
import ListHost from "../../features/tracks/components/ListHost.vue";
import type { RootLists } from "../../features/tracks/root-lists.ts";
import Mascot from "./Mascot.vue";
import DynamicBackground from "../../features/settings/components/DynamicBackground.vue";
import WindowTitlebar from "./WindowTitlebar.vue";
import ResizeHotspots from "./ResizeHotspots.vue";
import Sidebar from "./Sidebar.vue";
defineProps<{mainWindowRefs:typeof mainWindowRefs;draftBindings:typeof draftBindings;shell:ShellProjection; stages:ShellStages;sidebar:SidebarPresentation;maximized:boolean|null;mascot:MascotPresentation; captureMascotStage:(stage:HTMLDivElement|null)=>void; background:DynamicBackgroundPresentation; modals:RootModals; libraryCallbacks:typeof libraryCallbacks; pagesCallbacks:typeof pagesCallbacks; settingsControls:SettingsControls;settingsCallbacks:SettingsCallbacks;homeControls: HomeControls; pageCallbacks: PageCallbacks; lists: RootLists; snapshot: ApplicationSnapshot; callbacks: PlaybackCallbacks; playback: PlaybackControls }>();
</script>
<template>
    <DynamicBackground :model="background" />
    <WindowTitlebar :maximized="maximized" />
    <ResizeHotspots />
    <div class="app-shell">
      <Sidebar :model="sidebar" :current-view="shell.currentView" />

      <main class="main-panel panel" aria-labelledby="queue-heading">
        <section id="view-home" class="view" :class="{'is-active':shell.currentView === 'home','needs-setup':shell.homeNeedsSetup}" :hidden="shell.currentView !== 'home'" :data-home-mode="shell.homeMode">
          <div class="home-stage">
            <header class="home-head">
              <div class="home-title-block">
                <div class="home-title-copy">
                  <span id="home-source-label" class="home-source-label" hidden>{{ shell.homeSource }}</span>
                  <h1 id="home-title">{{ shell.homeTitle }}</h1>
                  <p class="home-subtitle">{{ shell.homeSubtitle }}</p>
                </div>
              </div>
              <div class="home-actions">
                <span id="home-cache-note" class="home-cache-note" hidden>{{ shell.homeCache }}</span>
                <button id="refresh-ranking-button" :ref="element => mainWindowRefs.refreshRankingButton(element as HTMLButtonElement|null)" :title="shell.homeRefreshTitle" :disabled="shell.homeRefreshDisabled" class="secondary-button home-refresh-button" type="button">刷新</button>
              </div>
            </header>

            <HomeHint :main-window-refs="mainWindowRefs" :draft-bindings="draftBindings" :model="homeControls" :callbacks="pageCallbacks" />

            <section class="home-ranking-panel" aria-label="推荐列表">
              <div class="home-ranking-bar">
                <span id="home-list-label">{{ shell.homeList }}</span>
                <span class="home-ranking-hint">点击条目开始播放</span>
              </div>
              <p id="home-ranking-status" class="home-status-live" role="status" aria-live="polite">{{ shell.homeStatus }}</p>
              <p id="home-ranking-error" :ref="element => mainWindowRefs.homeRankingError(element as HTMLParagraphElement|null)" class="home-error" role="status" aria-live="polite">{{ shell.homeError }}</p>
              <HomeSetupHint :model="homeControls" :callbacks="pageCallbacks" />
              <ListHost id="home-ranking-list" :on-host="mainWindowRefs.homeRankingList" class="tracklist ranking-list" aria-label="推荐列表" :model="lists.home" />
            </section>
          </div>
        </section>

        <section id="view-search" class="view" :class="{'is-active':shell.currentView === 'search'}" :hidden="shell.currentView !== 'search'">
          <div class="search-stage">
            <section class="search-command-panel" aria-label="搜索控制">
              <div class="search-command-head">
                <span class="search-vinyl-mark" aria-hidden="true"></span>
                <div class="search-command-copy">
                  <span class="search-source-label">关键词 / BV 直达</span>
                  <h1>搜索音乐</h1>
                  <p>输入关键词查找 B站音乐区内容，粘贴 BV 号可直接进入播放链路。</p>
                </div>
              </div>

              <SearchForm :draft-bindings="draftBindings" :disabled="snapshot.search.view.buttonDisabled" :callbacks="pageCallbacks" />
            </section>

            <section class="search-results-panel" aria-label="搜索结果">
              <SearchTabs :tids="snapshot.search.tids" :sort="snapshot.search.sortMode" :callbacks="pageCallbacks" />

              <header class="list-head search-results-head">
                <div>
                  <h1 id="queue-heading">搜索结果</h1>
                  <p id="search-status" class="search-status" role="status">{{ shell.searchStatus }}</p>
                </div>
                <span id="queue-count" class="queue-count">{{ shell.queueCount }}</span>
              </header>

              <ListHost id="search-results" :on-host="mainWindowRefs.searchResults" class="tracklist" aria-label="搜索结果和播放队列" :model="lists.search" />
            </section>
          </div>
        </section>

        <section id="view-favorites" class="view library-view" :class="{'is-active':shell.currentView === 'favorites'}" :hidden="shell.currentView !== 'favorites'">
          <header class="list-head">
            <div>
              <h1>我的收藏</h1>
              <p id="favorites-status" class="search-status" role="status">{{ shell.favoritesStatus }}</p>
            </div>
            <span id="favorites-count" class="queue-count">{{ shell.favoritesCount }}</span>
          </header>
          <ListHost id="favorites-list" :on-host="mainWindowRefs.favoritesList" class="tracklist library-list" aria-label="我的收藏" :model="lists.favorites" />
        </section>

        <section id="view-playlists" class="view library-view" :class="{'is-active':shell.currentView === 'playlists'}" :hidden="shell.currentView !== 'playlists'">
          <header class="list-head library-head">
            <div>
              <h1>我的歌单</h1>
              <p id="playlists-status" class="search-status" role="status">{{ shell.playlistsStatus }}</p>
            </div>
            <PlaylistCreateActions :callbacks="pageCallbacks" />
          </header>
          <div class="playlist-layout">
            <ListHost id="playlists-list" :on-host="mainWindowRefs.playlistsList" class="playlist-list" aria-label="歌单列表" :model="lists.directories" />
            <section class="playlist-detail" aria-label="歌单内容">
              <header class="playlist-detail-head">
                <div>
                  <h2 id="playlist-title">{{ shell.playlistTitle }}</h2>
                  <p id="playlist-meta">{{ shell.playlistMeta }}</p>
                </div>
                <PlaylistActions :visible="snapshot.library.playlists.length > 0" :callbacks="pageCallbacks" />
              </header>
              <ListHost id="playlist-tracks" :on-host="mainWindowRefs.playlistTracks" class="tracklist library-list" aria-label="歌单歌曲" :model="lists.playlist" />
            </section>
          </div>
        </section>

        <section id="view-placeholder" class="view placeholder-view" :hidden="['home','search','favorites','playlists'].includes(shell.currentView)">
          <div class="empty-state">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 5h8v2H8Zm0 4h5v2H8Z" /></svg>
            <h2 id="placeholder-title">{{ shell.placeholderTitle }}</h2>
            <p>这一入口先占位，不接真实数据。</p>
          </div>
        </section>
      </main>
    </div>

    <ImmersivePlayer :draft-bindings="draftBindings" :lyrics="snapshot.lyricsDisplay" :display="snapshot.playbackDisplay" :controls="playback" :callbacks="callbacks" />
    <PlaybackNotice :messages="snapshot.playbackMessages" />
    <PlaybackBar :main-window-refs="mainWindowRefs" :hidden="shell.resultHidden" :display="snapshot.playbackDisplay" :settings="snapshot.playbackSettings" :controls="playback" :callbacks="callbacks" :status="snapshot.playbackMessages.status" />

    <Mascot :model="mascot" :on-stage="captureMascotStage" />

    <div id="settings-modal" class="settings-mask" :class="{'is-open':stages.settings.open}" :aria-hidden="!stages.settings.open" :hidden="stages.settings.hidden">
      <SettingsPanel :draft-bindings="draftBindings" :appearance-status="shell.appearanceStatus" :purge-busy="shell.purgeBusy" :state="snapshot.settings" :model="settingsControls" :callbacks="settingsCallbacks" :normalization="snapshot.playbackSettings.normalizationEnabled" :normalization-version="snapshot.playbackSettings.view.enabledVersion" />
    </div>

    <div id="library-modal" :ref="element => mainWindowRefs.libraryModal(element as HTMLDivElement|null)" class="settings-mask" :class="{'is-open':stages.library.open}" :aria-hidden="!stages.library.open" :hidden="stages.library.hidden">
      <div class="settings-panel panel library-modal-panel" role="dialog" aria-modal="true" aria-labelledby="library-modal-title">
        <header class="settings-header">
          <div>
            <h2 id="library-modal-title">{{ shell.libraryTitle }}</h2>
            <p id="library-modal-subtitle" :hidden="!shell.librarySubtitle">{{ shell.librarySubtitle }}</p>
          </div>
          <button id="close-library-modal-button" :ref="element => mainWindowRefs.closeLibraryModalButton(element as HTMLButtonElement|null)" class="tool-button" type="button" aria-label="关闭">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4Z" /></svg>
          </button>
        </header>

        <div id="library-modal-body" :ref="element => mainWindowRefs.libraryModalBody(element as HTMLDivElement|null)" class="library-modal-body"><LibraryModalBody v-for="model in modals.library ? [modals.library] : []" v-bind="model" :key="model.key" v-bind.prop="libraryCallbacks" /></div>
        <p id="library-modal-status" class="appearance-status" role="status">{{ shell.libraryStatus }}</p>
      </div>
    </div>

    <div id="pages-modal" :ref="element => mainWindowRefs.pagesModal(element as HTMLDivElement|null)" class="modal settings-mask" :class="{'is-open':stages.pages.open}" :aria-hidden="!stages.pages.open" :hidden="stages.pages.hidden">
      <div class="modal-card settings-panel panel pages-modal-card" role="dialog" aria-modal="true" aria-labelledby="pages-modal-title" aria-describedby="pages-modal-sub">
        <div class="pages-modal-heading">
          <h2 id="pages-modal-title">{{ shell.pagesTitle }}</h2>
          <button id="pages-modal-restore-all" :ref="element => mainWindowRefs.pagesModalRestoreAll(element as HTMLButtonElement|null)" class="small-button quiet" type="button" :hidden="shell.restoreHidden" :disabled="shell.restoreDisabled">{{ shell.restoreText }}</button>
        </div>
        <p id="pages-modal-sub" class="modal-sub">{{ shell.pagesSub }}</p>
        <p id="pages-modal-status" class="pages-modal-status" role="alert" aria-live="assertive">{{ shell.pagesStatus }}</p>
        <ul id="pages-modal-list" :ref="element => mainWindowRefs.pagesModalList(element as HTMLUListElement|null)" class="pages-list"><PagesList v-for="model in modals.pages ? [modals.pages] : []" v-bind="model" :key="model.key" v-bind.prop="pagesCallbacks" /></ul>
        <div class="modal-actions">
          <button id="pages-modal-close" :ref="element => mainWindowRefs.pagesModalClose(element as HTMLButtonElement|null)" class="small-button" type="button">关闭</button>
        </div>
      </div>
    </div>

    </template>
