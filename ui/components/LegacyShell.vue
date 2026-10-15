<script setup lang="ts">
import SettingsPanel from "./SettingsPanel.vue";
import type {SettingsControls} from "../settings-controls.ts";
import type {SettingsCallbacks} from "../root-settings.ts";
import PlaylistActions from "./PlaylistActions.vue";
import PlaylistCreateActions from "./PlaylistCreateActions.vue";
import SearchTabs from "./SearchTabs.vue";
import SearchForm from "./SearchForm.vue";
import HomeSetupHint from "./HomeSetupHint.vue";
import HomeHint from "./HomeHint.vue";
import PlaybackBar from "./PlaybackBar.vue";
import ImmersivePlayer from "./ImmersivePlayer.vue";
import PlaybackNotice from "./PlaybackNotice.vue";
import type { HomeControls, PageCallbacks } from "../root-controls.ts";
import type { ApplicationSnapshot } from "../application-store.ts";
import type { PlaybackCallbacks, PlaybackControls } from "../root-playback.ts";
import ListHost from "./ListHost.vue";
import type { RootLists } from "../root-lists.ts";
import WindowTitlebar from "./WindowTitlebar.vue";
import ResizeHotspots from "./ResizeHotspots.vue";
import Sidebar from "./Sidebar.vue";
defineProps<{ settingsControls:SettingsControls;settingsCallbacks:SettingsCallbacks;homeControls: HomeControls; pageCallbacks: PageCallbacks; lists: RootLists; snapshot: ApplicationSnapshot; callbacks: PlaybackCallbacks; playback: PlaybackControls }>();
</script>
<template>
    <div class="dynamic-background" aria-hidden="true">
      <div class="dynamic-background-layer is-visible"></div>
      <div class="dynamic-background-layer"></div>
    </div>
    <WindowTitlebar />
    <ResizeHotspots />
    <div class="app-shell">
      <Sidebar />

      <main class="main-panel panel" aria-labelledby="queue-heading">
        <section id="view-home" class="view is-active" data-home-mode="ranking">
          <div class="home-stage">
            <header class="home-head">
              <div class="home-title-block">
                <div class="home-title-copy">
                  <span id="home-source-label" class="home-source-label" hidden></span>
                  <h1 id="home-title">为你推荐</h1>
                  <p class="home-subtitle">根据收藏、搜索、歌单和听歌记录生成</p>
                </div>
              </div>
              <div class="home-actions">
                <span id="home-cache-note" class="home-cache-note" hidden></span>
                <button id="refresh-ranking-button" class="secondary-button home-refresh-button" type="button">刷新</button>
              </div>
            </header>

            <HomeHint :model="homeControls" :callbacks="pageCallbacks" />

            <section class="home-ranking-panel" aria-label="推荐列表">
              <div class="home-ranking-bar">
                <span id="home-list-label">按你的口味生成</span>
                <span class="home-ranking-hint">点击条目开始播放</span>
              </div>
              <p id="home-ranking-status" class="home-status-live" role="status" aria-live="polite"></p>
              <p id="home-ranking-error" class="home-error" role="status" aria-live="polite"></p>
              <HomeSetupHint :model="homeControls" :callbacks="pageCallbacks" />
              <ListHost id="home-ranking-list" class="tracklist ranking-list" aria-label="推荐列表" :model="lists.home" />
            </section>
          </div>
        </section>

        <section id="view-search" class="view" hidden>
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

              <SearchForm :disabled="snapshot.search.view.buttonDisabled" :callbacks="pageCallbacks" />
            </section>

            <section class="search-results-panel" aria-label="搜索结果">
              <SearchTabs :tids="snapshot.search.tids" :sort="snapshot.search.sortMode" :callbacks="pageCallbacks" />

              <header class="list-head search-results-head">
                <div>
                  <h1 id="queue-heading">搜索结果</h1>
                  <p id="search-status" class="search-status" role="status">搜索结果会显示在这里。</p>
                </div>
                <span id="queue-count" class="queue-count">0 首</span>
              </header>

              <ListHost id="search-results" class="tracklist" aria-label="搜索结果和播放队列" :model="lists.search" />
            </section>
          </div>
        </section>

        <section id="view-favorites" class="view library-view" hidden>
          <header class="list-head">
            <div>
              <h1>我的收藏</h1>
              <p id="favorites-status" class="search-status" role="status">收藏的歌曲会显示在这里。</p>
            </div>
            <span id="favorites-count" class="queue-count">0 首</span>
          </header>
          <ListHost id="favorites-list" class="tracklist library-list" aria-label="我的收藏" :model="lists.favorites" />
        </section>

        <section id="view-playlists" class="view library-view" hidden>
          <header class="list-head library-head">
            <div>
              <h1>我的歌单</h1>
              <p id="playlists-status" class="search-status" role="status">创建歌单，把喜欢的歌放在一起。</p>
            </div>
            <PlaylistCreateActions :callbacks="pageCallbacks" />
          </header>
          <div class="playlist-layout">
            <ListHost id="playlists-list" class="playlist-list" aria-label="歌单列表" :model="lists.directories" />
            <section class="playlist-detail" aria-label="歌单内容">
              <header class="playlist-detail-head">
                <div>
                  <h2 id="playlist-title">选择一个歌单</h2>
                  <p id="playlist-meta">歌单里的歌曲会显示在这里。</p>
                </div>
                <PlaylistActions :visible="snapshot.library.playlists.length > 0" :callbacks="pageCallbacks" />
              </header>
              <ListHost id="playlist-tracks" class="tracklist library-list" aria-label="歌单歌曲" :model="lists.playlist" />
            </section>
          </div>
        </section>

        <section id="view-placeholder" class="view placeholder-view" hidden>
          <div class="empty-state">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 5h8v2H8Zm0 4h5v2H8Z" /></svg>
            <h2 id="placeholder-title">功能开发中</h2>
            <p>这一入口先占位，不接真实数据。</p>
          </div>
        </section>
      </main>
    </div>

    <ImmersivePlayer :lyrics="snapshot.lyricsDisplay" :display="snapshot.playbackDisplay" :controls="playback" :callbacks="callbacks" />
    <PlaybackNotice :messages="snapshot.playbackMessages" />
    <PlaybackBar :display="snapshot.playbackDisplay" :settings="snapshot.playbackSettings" :controls="playback" :callbacks="callbacks" :status="snapshot.playbackMessages.status" />

    <div id="mascot-stage" aria-label="小黑咪">
      <div id="mascot-slot" aria-hidden="true"></div>
      <div id="mascot-bubble" hidden></div>
    </div>

    <div id="settings-modal" class="settings-mask" aria-hidden="true" hidden>
      <SettingsPanel :state="snapshot.settings" :model="settingsControls" :callbacks="settingsCallbacks" :normalization="snapshot.playbackSettings.normalizationEnabled" :normalization-version="snapshot.playbackSettings.view.enabledVersion" />
    </div>

    <div id="library-modal" class="settings-mask" aria-hidden="true" hidden>
      <div class="settings-panel panel library-modal-panel" role="dialog" aria-modal="true" aria-labelledby="library-modal-title">
        <header class="settings-header">
          <div>
            <h2 id="library-modal-title">加入歌单</h2>
            <p id="library-modal-subtitle">选择一个歌单，或新建后加入。</p>
          </div>
          <button id="close-library-modal-button" class="tool-button" type="button" aria-label="关闭">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4Z" /></svg>
          </button>
        </header>

        <div id="library-modal-body" class="library-modal-body"></div>
        <p id="library-modal-status" class="appearance-status" role="status"></p>
      </div>
    </div>

    <div id="pages-modal" class="modal settings-mask" aria-hidden="true" hidden>
      <div class="modal-card settings-panel panel pages-modal-card" role="dialog" aria-modal="true" aria-labelledby="pages-modal-title" aria-describedby="pages-modal-sub">
        <div class="pages-modal-heading">
          <h2 id="pages-modal-title">选择分P</h2>
          <button id="pages-modal-restore-all" class="small-button quiet" type="button" hidden>全部恢复</button>
        </div>
        <p id="pages-modal-sub" class="modal-sub"></p>
        <p id="pages-modal-status" class="pages-modal-status" role="alert" aria-live="assertive"></p>
        <ul id="pages-modal-list" class="pages-list"></ul>
        <div class="modal-actions">
          <button id="pages-modal-close" class="small-button" type="button">关闭</button>
        </div>
      </div>
    </div>

    </template>
