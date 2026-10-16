# 改功能指南

先在对应领域 actions 改状态/流程，再让组件接收稳定显示 props。组件不直接调 IPC；命令形状同步维护 `types/command-contract.d.ts`。原生端口、焦点与开关阶段见 [架构](frontend-architecture.md)。

| 功能 | 状态切片 | 界面 | 流程/副作用 | 主要测试 |
|---|---|---|---|---|
| 首页榜单/推荐 | home | AppShell、TrackList/TrackRow、HomeHint/HomeSetupHint | home.ts、home-view.ts；榜单 Rust ranking.rs | home-characterization.dom、root-lists.dom、home-actions |
| 搜索/BV/分页 | search；播放另属 playbackQueue | SearchForm、SearchTabs、TrackList | search.ts、main.ts、draft-ports.ts；BV入口 playback-core.ts | search-characterization.dom、search-restore-characterization.dom、pasted-bv-pages |
| 收藏 | library | TrackList/TrackRow | library-ui.ts、library-state.ts；Rust library | library-characterization.dom、library-actions、library-lists-baseline.dom |
| 歌单/三处拖拽 | library、library.drags | PlaylistList、PlaylistActions/PlaylistCreateActions、TrackList | library-ui.ts、library-state.ts；Rust playlists | library-lists-vue.dom、library-lists-characterization.dom、library-drag-null.dom |
| 分P/禁用恢复 | pages、library.disabledPages/disabledPagePending | PagesList；AppShell外壳 | video-pages.ts、pages-view.ts、root-modals.ts、page-selection.ts | pages-characterization.dom、pages-real-dom.dom、pages-list.dom、disabled-page-navigation |
| 资料库全部浮层 | library.session | LibraryModalBody | library-ui.ts、library-view.ts、root-modals.ts；focus-trap.ts | library-modal-actions/focus/input/render.dom、library-modal-vue.dom、favorite-import.dom |
| 播放栏/进度 | playbackQueue/Session/Display | PlaybackBar | playback-core.ts、playback-commands.ts、media-adapter.ts、appearance.ts | playback-core-characterization、playback-ui-characterization.dom、playback-control-characterization |
| 音量/响度 | playbackSettings | PlaybackBar、SettingsPanel | appearance.ts、playback-settings-view.ts、media-adapter.ts | playback-volume-characterization、loudness-normalization、playback-tree.dom |
| 状态/失败提示 | playbackMessages | PlaybackNotice | playback-messages.ts、playback-notice.ts；计时/定位仍属控制器 | playback-messages-characterization、playback-notice、playback-ui-characterization.dom |
| 沉浸页 | playbackDisplay、playbackSession | ImmersivePlayer | appearance.ts、playback-commands.ts；hidden/RAF/焦点原阶段 | playback-ui-characterization.dom、playback-tree.dom |
| 歌词/候选/偏移 | lyricsDisplay（只承载显示） | LyricsDisplay | lyrics.ts 保持获取/匹配/滚动；Rust lyrics | lyrics-display-state、lyrics-*、playback-ui-characterization.dom |
| 设置主题/背景/三滑块 | settings | SettingsPanel | appearance.ts、settings-state.ts、settings-controls.ts、settings-adapter.ts | settings-characterization、controls-settings-characterization.dom、dynamic-background.dom、accent-color.dom |
| 设置AI/Key | settings.ai（不含Key） | SettingsPanel 非受控Key输入 | appearance.ts 临时参数、settings-state.ts；Rust ai.rs | settings-actions、settings-privacy.dom、controls-settings-characterization.dom |
| 设置快捷键/缓存/备份 | settings | SettingsPanel | appearance.ts、settings-state.ts；Rust shortcuts/audio_cache/library::backup | shortcut-settings、settings-privacy.dom、controls-settings-characterization.dom、Rust backup隐私测试 |
| 迷你窗 | 主窗快照→跨窗payload | mini.html、mini.ts（独立原生入口） | mini-player-host.ts、playback-mini-view.ts、commands、Rust mini window | mini-host-characterization、mini-snapshot.dom、mini-player-config.dom |
| 启动/watchdog | application-store组合；Rust ReadyGate | App/AppShell、WindowTitlebar、Sidebar、ResizeHotspots | app.ts→root-mount.ts→startup-before-main.ts→main.ts；main-window-ready.ts、Rust main_window.rs | root-shell.dom、real-module-startup.dom、playback-startup-installation.dom、main-window-ready、Rust ReadyGate |

文件无后缀的测试在 `tests/*.test.ts`；`.dom` 在 `tests/dom/*.dom.ts`。输入草稿不加 v-model，异步结果不得捕获旧分页草稿；Key、cookie、直链不进显示状态/日志。新节点一旦动态绑定，原控制器的同属性写入必须同时退出。
