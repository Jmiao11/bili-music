<script setup lang="ts">
import PlaybackBar from "./PlaybackBar.vue";
import ImmersivePlayer from "./ImmersivePlayer.vue";
import PlaybackNotice from "./PlaybackNotice.vue";
import type { ApplicationSnapshot } from "../application-store.ts";
import type { PlaybackCallbacks, PlaybackControls } from "../root-playback.ts";
import ListHost from "./ListHost.vue";
import type { RootLists } from "../root-lists.ts";
import WindowTitlebar from "./WindowTitlebar.vue";
import ResizeHotspots from "./ResizeHotspots.vue";
import Sidebar from "./Sidebar.vue";
defineProps<{ lists: RootLists; snapshot: ApplicationSnapshot; callbacks: PlaybackCallbacks; playback: PlaybackControls }>();
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

            <div id="home-hint-row" class="home-hint-row" hidden>
              <div class="home-hint-controls">
                <input id="home-hint-input" class="home-hint-input" type="text" maxlength="60" aria-label="用一句话描述你现在想听什么" placeholder="用一句话描述你现在想听什么，可留空" />
                <button id="home-hint-apply" class="primary-cta" type="button">生成推荐</button>
              </div>
            </div>

            <section class="home-ranking-panel" aria-label="推荐列表">
              <div class="home-ranking-bar">
                <span id="home-list-label">按你的口味生成</span>
                <span class="home-ranking-hint">点击条目开始播放</span>
              </div>
              <p id="home-ranking-status" class="home-status-live" role="status" aria-live="polite"></p>
              <p id="home-ranking-error" class="home-error" role="status" aria-live="polite"></p>
              <div id="home-setup-hint" class="home-setup-hint" hidden>
                <p class="home-setup-title" id="home-setup-title">「为你推荐」需要你自己的大模型 API Key</p>
                <p class="home-setup-sub" id="home-setup-sub">在「设置 → AI 推荐」填入 API Key，即可根据你的收藏、歌单与听歌记录生成推荐。不配置也能正常搜索与播放。</p>
                <button id="home-setup-settings" class="primary-cta" type="button">去设置</button>
              </div>
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

              <form id="search-form" class="searchbar" role="search">
                <label class="sr-only" for="search-keyword">搜索歌曲、歌手，或粘贴 BV 号直接播放</label>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m20.3 21.7-5.7-5.7a8 8 0 1 1 1.4-1.4l5.7 5.7ZM4 10a6 6 0 1 0 12 0A6 6 0 0 0 4 10Z" /></svg>
                <input id="search-keyword" required placeholder="搜索歌曲、歌手，或粘贴 BV 号直接播放" autocomplete="off" />
                <span class="search-hint">BV 号自动识别</span>
                <button id="search-button" class="search-submit" type="submit">搜索</button>
              </form>
            </section>

            <section class="search-results-panel" aria-label="搜索结果">
              <div class="search-tabs-row">
                <div class="search-tabs-groups">
                  <div id="music-tabs" class="music-tabs search-tab-group" role="tablist" aria-label="音乐分区">
                    <button class="music-tab is-active" type="button" role="tab" aria-selected="true" data-tids="3">全部</button>
                    <button class="music-tab" type="button" role="tab" aria-selected="false" data-tids="28">原创</button>
                    <button class="music-tab" type="button" role="tab" aria-selected="false" data-tids="31">翻唱</button>
                  </div>
                  <div id="search-sort-modes" class="music-tabs search-tab-group" role="tablist" aria-label="搜索排序模式">
                    <button class="music-tab" type="button" role="tab" aria-selected="false" data-sort-mode="single">单曲</button>
                    <button class="music-tab" type="button" role="tab" aria-selected="false" data-sort-mode="collection">合集</button>
                  </div>
                </div>
              </div>

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
            <div class="playlist-create-actions">
              <button id="import-playlist-button" class="secondary-button" type="button">导入 B站收藏夹</button>
              <button id="create-playlist-button" class="secondary-button" type="button">新建歌单</button>
            </div>
          </header>
          <div class="playlist-layout">
            <ListHost id="playlists-list" class="playlist-list" aria-label="歌单列表" :model="lists.directories" />
            <section class="playlist-detail" aria-label="歌单内容">
              <header class="playlist-detail-head">
                <div>
                  <h2 id="playlist-title">选择一个歌单</h2>
                  <p id="playlist-meta">歌单里的歌曲会显示在这里。</p>
                </div>
                <div id="playlist-actions" class="playlist-actions" hidden>
                  <button id="rename-playlist-button" class="small-button quiet" type="button">改名</button>
                  <button id="delete-playlist-button" class="small-button quiet danger" type="button">删除</button>
                </div>
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
      <div class="settings-panel panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings-header">
          <div>
            <h2 id="settings-title">设置</h2>
            <p>主题、背景与音频设置</p>
          </div>
          <button id="close-settings-button" class="tool-button" type="button" aria-label="关闭设置">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4Z" /></svg>
          </button>
        </header>

        <section class="setting-group">
          <h3>主题</h3>
          <div class="theme-row" role="radiogroup" aria-label="主题">
            <button class="theme-option" type="button" data-theme-option="dark">
              <span class="swatch swatch-dark"></span>
              深色
            </button>
            <button class="theme-option" type="button" data-theme-option="light">
              <span class="swatch swatch-light"></span>
              浅色
            </button>
            <button class="theme-option" type="button" data-theme-option="image">
              <span class="swatch swatch-image"></span>
              背景图
            </button>
            <button class="theme-option" type="button" data-theme-option="dynamic">
              <span class="swatch swatch-dynamic"></span>
              动态
            </button>
          </div>
        </section>

        <section id="image-settings" class="setting-group image-only">
          <h3>背景图</h3>
          <div class="setting-actions">
            <button id="choose-background-button" class="secondary-button" type="button">选择本地图片</button>
            <button id="reset-background-button" class="small-button quiet" type="button">恢复默认</button>
          </div>
          <small id="background-name">使用默认背景</small>
        </section>

        <section id="texture-settings" class="setting-group image-only">
          <h3>质感微调</h3>
          <label class="slider-row">
            <span>毛玻璃模糊 <output id="glass-blur-value">40px</output></span>
            <input id="glass-blur-slider" type="range" min="0" max="80" value="40" />
          </label>
          <label class="slider-row">
            <span>面板不透明度 <output id="panel-alpha-value">72%</output></span>
            <input id="panel-alpha-slider" type="range" min="20" max="100" value="72" />
          </label>
          <label class="slider-row">
            <span>背景暗化 <output id="background-dim-value">90%</output></span>
            <input id="background-dim-slider" type="range" min="40" max="95" value="90" />
          </label>
        </section>

        <section class="setting-group">
          <h3>桌宠</h3>
          <div id="mascot-picker" class="mascot-picker"></div>
        </section>

        <details class="setting-group collapsible-group">
          <summary><h3>音频</h3></summary>
          <div class="setting-subgroup audio-source-section">
            <label class="select-row audio-source-row" for="stream-source-select">
              <span>音频获取方式</span>
              <select id="stream-source-select" class="settings-select">
                <option value="guest" title="游客直连（免登录，推荐）">游客直连</option>
                <option value="auto" title="自动（游客优先，失败用 yt-dlp 兜底）">自动兜底</option>
              </select>
            </label>
            <small id="stream-source-status"></small>
            <small class="setting-note">决定从 B 站获取音频的方式。游客直连免登录、开箱即用；自动模式在获取失败时用 yt-dlp 兜底，需自备 yt-dlp.exe。</small>
          </div>
          <div class="setting-subgroup">
            <label class="checkbox-row" for="loudness-normalization-toggle">
              <input id="loudness-normalization-toggle" type="checkbox" aria-describedby="loudness-normalization-note" />
              响度归一化
            </label>
            <small id="loudness-normalization-note" class="setting-note">降低已测量歌曲之间的音量差异，不放大较轻的歌曲。未测量的歌曲保持原音量。</small>
          </div>
          <div class="setting-subgroup audio-cache-section">
            <label class="checkbox-row" for="audio-cache-enabled">
              <input id="audio-cache-enabled" type="checkbox" aria-describedby="audio-cache-note" disabled />
              启用本地音频缓存
            </label>
            <small id="audio-cache-note" class="setting-note">缓存播放过的音频，可提升再次播放的速度和稳定性。缓存会占用磁盘空间，可随时清除。</small>
            <div class="audio-cache-details">
              <div class="audio-cache-row audio-cache-usage-row">
                <span>缓存占用</span>
                <small id="audio-cache-usage" class="setting-note audio-cache-usage">读取中…</small>
                <button id="clear-audio-cache-button" class="audio-cache-clear" type="button">清空缓存</button>
              </div>
              <label class="audio-cache-row" for="audio-cache-capacity">
                <span>缓存上限</span>
                <select id="audio-cache-capacity" class="settings-select" disabled>
                  <option value="536870912">512 MB</option>
                  <option value="1073741824">1 GB</option>
                  <option value="2147483648" selected>2 GB</option>
                  <option value="5368709120">5 GB</option>
                  <option value="10737418240">10 GB</option>
                </select>
              </label>
            </div>
            <small id="audio-cache-status" class="setting-note audio-cache-status" role="status" aria-live="polite"></small>
          </div>
          <div class="setting-subgroup shuffle-collection-section">
            <label class="shuffle-collection-row" for="shuffle-collection-order">
              <span>随机时合集内顺序</span>
              <select id="shuffle-collection-order" class="settings-select">
                <option value="random">随机</option>
                <option value="sequential">按原顺序</option>
              </select>
            </label>
            <label class="shuffle-collection-row" for="shuffle-collection-limit">
              <span>随机时每个合集播放</span>
              <select id="shuffle-collection-limit" class="settings-select">
                <option value="all">全部</option>
                <option value="1">1 首</option>
                <option value="3">3 首</option>
                <option value="5">5 首</option>
                <option value="10">10 首</option>
              </select>
            </label>
            <small class="setting-note">开启随机播放时，遇到多P视频（合集）的播放方式。可随时点分P标识旁的跳过按钮跳过当前合集。</small>
          </div>
        </details>

        <details id="accent-color-settings" class="setting-group collapsible-group">
          <summary><h3>主题色</h3></summary>
          <div class="theme-row" role="radiogroup" aria-label="主题色">
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="pink" data-accent-color checked />
              <span class="accent-dot" aria-hidden="true"></span>
              <span>粉</span>
            </label>
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="blue" data-accent-color />
              <span class="accent-dot" aria-hidden="true"></span>
              <span>蓝</span>
            </label>
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="purple" data-accent-color />
              <span class="accent-dot" aria-hidden="true"></span>
              <span>紫</span>
            </label>
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="green" data-accent-color />
              <span class="accent-dot" aria-hidden="true"></span>
              <span>绿</span>
            </label>
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="orange" data-accent-color />
              <span class="accent-dot" aria-hidden="true"></span>
              <span>橙</span>
            </label>
            <label class="accent-option">
              <input class="sr-only" type="radio" name="accent-color" value="cyan" data-accent-color />
              <span class="accent-dot" aria-hidden="true"></span>
              <span>青</span>
            </label>
          </div>
        </details>

        <details class="setting-group ai-settings collapsible-group">
          <summary><h3>AI 推荐</h3></summary>
          <label class="settings-field" for="ai-api-format-select">
            <span>接口规范</span>
            <select id="ai-api-format-select" class="settings-select">
              <option value="openai-chat-completions">OpenAI Chat Completions</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="anthropic-messages">Anthropic Messages</option>
            </select>
          </label>
          <label class="settings-field" for="ai-model-input">
            <span>模型</span>
            <input id="ai-model-input" class="settings-input" type="text" autocomplete="off" placeholder="gpt-4o-mini" />
          </label>
          <label class="settings-field" for="ai-api-key-input">
            <span>API Key</span>
            <input id="ai-api-key-input" class="settings-input" type="password" autocomplete="new-password" placeholder="留空则保留已保存的 key" />
          </label>
          <label class="settings-field" for="ai-base-url-input">
            <span>Base URL<span
                  class="ai-help-trigger"
                  tabindex="0"
                  role="button"
                  aria-label="Base URL 填写说明"
                  aria-describedby="ai-help-bubble">?<span
                    id="ai-help-bubble"
                    class="ai-help-bubble"
                    role="tooltip"><strong>规则</strong>
                    <ul>
                      <li>请填到服务商要求的版本段，例如 https://api.openai.com/v1</li>
                      <li>只追加所选规范的端点，不自动补 /v1</li>
                      <li>缺少协议头时补 https://，末尾的 / 会去掉</li>
                    </ul>
                    <strong>示例</strong>
                    <ul>
                      <li>OpenAI：https://api.openai.com/v1</li>
                      <li>智谱：open.bigmodel.cn/api/v1</li>
                      <li>智谱 Anthropic：open.bigmodel.cn/api/anthropic/v1</li>
                      <li>百炼：dashscope.aliyuncs.com/compatible-mode/v1</li>
                    </ul></span></span></span>
            <input id="ai-base-url-input" class="settings-input" type="url" autocomplete="off" placeholder="https://api.openai.com/v1" />
          </label>
          <small class="setting-note">鼠标悬浮 Base URL 旁的“?”可查看填写说明</small>
          <div class="setting-actions">
            <button id="save-ai-config-button" class="secondary-button" type="button">保存 AI 配置</button>
            <button id="test-ai-connection-button" class="small-button quiet" type="button">测试连接</button>
          </div>
          <small id="ai-config-status">尚未读取 AI 配置</small>
        </details>

        <details class="setting-group collapsible-group">
          <summary><h3>快捷键</h3></summary>
          <div class="setting-subgroup shortcut-row">
            <h4>上一曲</h4>
            <div class="shortcut-binding-actions">
              <button class="secondary-button shortcut-record-button" type="button" data-shortcut-action="previous">未设置</button>
              <button class="small-button quiet" type="button" data-shortcut-clear="previous">清除</button>
            </div>
          </div>
          <div class="setting-subgroup shortcut-row">
            <h4>播放/暂停</h4>
            <div class="shortcut-binding-actions">
              <button class="secondary-button shortcut-record-button" type="button" data-shortcut-action="playPause">未设置</button>
              <button class="small-button quiet" type="button" data-shortcut-clear="playPause">清除</button>
            </div>
          </div>
          <div class="setting-subgroup shortcut-row">
            <h4>下一曲</h4>
            <div class="shortcut-binding-actions">
              <button class="secondary-button shortcut-record-button" type="button" data-shortcut-action="next">未设置</button>
              <button class="small-button quiet" type="button" data-shortcut-clear="next">清除</button>
            </div>
          </div>
          <div class="setting-subgroup shortcut-row">
            <h4>音量增加</h4>
            <div class="shortcut-binding-actions">
              <button class="secondary-button shortcut-record-button" type="button" data-shortcut-action="volumeUp">未设置</button>
              <button class="small-button quiet" type="button" data-shortcut-clear="volumeUp">清除</button>
            </div>
          </div>
          <div class="setting-subgroup shortcut-row">
            <h4>音量降低</h4>
            <div class="shortcut-binding-actions">
              <button class="secondary-button shortcut-record-button" type="button" data-shortcut-action="volumeDown">未设置</button>
              <button class="small-button quiet" type="button" data-shortcut-clear="volumeDown">清除</button>
            </div>
          </div>
          <small class="setting-note">系统级快捷键在软件处于后台时也会生效，支持 Windows 与 macOS。</small>
        </details>

        <details class="setting-group collapsible-group">
          <summary><h3>数据与隐私</h3></summary>
          <div class="setting-subgroup">
            <h4>数据备份</h4>
            <div class="setting-actions">
              <button id="export-data-button" class="secondary-button" type="button">导出数据</button>
              <button id="import-data-button" class="secondary-button" type="button">导入数据</button>
            </div>
          </div>
          <div class="setting-subgroup">
            <h4>搜索历史</h4>
            <div class="setting-actions">
              <button id="clear-search-history-button" class="small-button quiet" type="button">清空搜索历史</button>
            </div>
          </div>
          <div class="setting-subgroup">
            <h4>失效曲目</h4>
            <div class="setting-actions">
              <button id="purge-unavailable-tracks-button" class="small-button quiet" type="button">清理失效曲目</button>
            </div>
          </div>
          <small class="setting-note">导出的备份包含收藏、歌单、听歌记录、AI 配置与背景图，但不包含 AI API Key，在新设备导入后需要重新填写；导入会覆盖当前数据。清空搜索历史仅删除本地搜索记录，不影响收藏、歌单或播放队列。清理失效曲目会从收藏和所有歌单中移除这些歌曲。</small>
        </details>

        <p id="appearance-status" class="appearance-status" role="status"></p>
      </div>
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
