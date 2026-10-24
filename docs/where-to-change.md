# 改功能指南

两个窗口的界面全部由Vue渲染。先在对应领域 actions 改状态/流程，再让组件接收稳定显示 props。组件不直接调 IPC；命令形状同步维护 `types/command-contract.d.ts`。原生端口、焦点与开关阶段见 [架构](frontend-architecture.md)。

路径以 `ui/` 为基准：应用组合在 `store/`，原生端口在 `platform/`，功能在 `features/`。下表组件名在对应功能的 `components/`；外壳在 `app/components/`，共用曲目行在 `features/tracks/components/`。

| 功能 | 状态切片 | 界面 | 流程/副作用 | 主要测试 |
|---|---|---|---|---|
| 方案 C 变量、外壳、四页与行/播放栏 | 沿用既有切片 | [设计规范](ui-spec.md)、styles/tokens.css、styles.css、AppShell、Sidebar、TrackRow、PlaybackBar、app/components/Icon.vue | 仅展示与变量映射，不改控制器；侧栏保留 220/72px | tracks-baseline.dom、playback-tree.dom、verify:dist（G0 不变） |
| 动态背景 | 组件本地显示投影，不新增业务store切片 | features/settings/components/DynamicBackground.vue | features/settings/dynamic-background.ts取色/取消 | native-writes-baseline.dom、dynamic-background.dom |
| 页面导航/外壳/提示优先级 | 现有home/search/library/settings；本地动画阶段 | AppShell、Sidebar、WindowTitlebar | app/shell-projection.ts、app/shell-stages.ts、app/sidebar.ts、app/window-controls.ts；platform/main-window-refs.ts只回传节点 | native-writes-baseline.dom、controls-settings-characterization.dom、pages/library浮层测试 |
| 首页榜单/推荐 | home | AppShell、TrackList/TrackRow、HomeHint/HomeSetupHint | features/home/home.ts、features/home/home-view.ts；推荐请求在 store/app-state.ts，榜单 Rust ranking.rs，推荐预算/降级 ai/recommendation.rs，协议参数 ai/protocol.rs | home-characterization.dom、root-lists.dom、home-actions、Rust ai::recommendation/ai::protocol |
| 搜索/BV/分页 | search；播放另属 playbackQueue | SearchForm、SearchTabs、TrackList | features/search/search.ts、app/main.ts、platform/draft-ports.ts；BV入口 features/playback/playback-core.ts | search-characterization.dom、search-restore-characterization.dom、pasted-bv-pages |
| 多 BV 合集/通用视频列表 | collection；播放沿用 playbackQueue | AppShell、PlaybackNotice、TrackList/TrackRow | features/collections/collection-state.ts、collection-controller.ts；Rust lyrics.rs、commands/media.rs；详情使用独立8秒无cookie客户端，合集附加字段宽松解析；本批仅合集来源 | tracks-vue.dom、Rust lyrics/detail_tests.rs 与合集测试 |
| 收藏 | library | TrackList/TrackRow | features/library/library-ui.ts、features/library/library-state.ts；Rust library | library-characterization.dom、library-actions、library-lists-baseline.dom |
| 合集进入资料库（C1） | library 的 video/collection 条目；collection 的完整快照、引用与刷新版本 | CollectionToolbar、TrackRow 的合集角标、LibraryModalBody 的三种加入意图 | features/library/library-entry.ts、library-state.ts；features/collections/collection-state.ts、collection-controller.ts；Rust library/entries.rs、collections.rs、favorites.rs、playlists.rs、backup.rs | collections-library-actions、collections-library.dom；Rust entries 与 backup 的 v1/v2/备份/回滚回归 |
| 歌单总览/详情、侧栏/三处拖拽 | library、library.view.playlistDetail（不持久化）、library.drags | PlaylistList、PlaylistActions/PlaylistCreateActions、TrackList | features/library/library-ui.ts、features/library/library-state.ts；Rust playlists | library-lists-vue.dom、library-lists-characterization.dom、library-drag-null.dom |
| 分P/禁用恢复 | pages、library.disabledPages/disabledPagePending | PagesList；AppShell外壳 | features/pages/video-pages.ts、features/pages/pages-view.ts、app/root-modals.ts、features/pages/page-selection.ts | pages-characterization.dom、pages-real-dom.dom、pages-list.dom、disabled-page-navigation |
| 资料库全部浮层 | library.session | LibraryModalBody | features/library/library-ui.ts、features/library/library-view.ts、app/root-modals.ts；shared/focus-trap.ts | library-modal-actions/focus/input/render.dom、library-modal-vue.dom、favorite-import.dom |
| 播放栏/进度 | playbackQueue/Session/Display | PlaybackBar | features/playback/playback-core.ts、features/playback/playback-commands.ts、platform/media-adapter.ts、features/settings/appearance.ts | playback-core-characterization、playback-ui-characterization.dom、playback-control-characterization |
| 音量/响度 | playbackSettings | PlaybackBar、SettingsPanel | features/settings/appearance.ts、features/playback/playback-settings-view.ts、platform/media-adapter.ts | playback-volume-characterization、loudness-normalization、playback-tree.dom |
| 状态/失败提示 | playbackMessages | PlaybackNotice | features/playback/playback-messages.ts、features/playback/playback-notice.ts；计时/定位仍属控制器 | playback-messages-characterization、playback-notice、playback-ui-characterization.dom |
| 沉浸页 | playbackDisplay、playbackSession | ImmersivePlayer | features/settings/appearance.ts、features/playback/playback-commands.ts；hidden/RAF/焦点原阶段 | playback-ui-characterization.dom、playback-tree.dom |
| 歌词/候选/偏移 | lyricsDisplay（只承载显示） | LyricsDisplay | features/immersive/lyrics.ts 保持获取/匹配/滚动；Rust lyrics | lyrics-display-state、lyrics-*、playback-ui-characterization.dom |
| 设置主题/背景/三滑块 | settings | SettingsPanel | features/settings/appearance.ts、features/settings/settings-state.ts、features/settings/settings-controls.ts、features/settings/settings-adapter.ts | settings-characterization、controls-settings-characterization.dom、dynamic-background.dom、accent-color.dom |
| 设置AI/Key | settings.ai（不含Key） | SettingsPanel 非受控Key输入 | features/settings/appearance.ts 临时参数、features/settings/settings-state.ts；Rust ai.rs | settings-actions、settings-privacy.dom、controls-settings-characterization.dom |
| 设置快捷键/缓存/备份 | settings | SettingsPanel | features/settings/appearance.ts、features/settings/settings-state.ts；Rust shortcuts/audio_cache/library::backup | shortcut-settings、settings-privacy.dom、controls-settings-characterization.dom、Rust backup隐私测试 |
| 迷你窗 | 主窗快照→跨窗payload | mini/components/MiniApp.vue（独立同步根） | mini.ts→mini/window-controller.ts、mini/root-mount.ts；主窗mini/mini-player-host.ts与mini-player-projection.ts；Rust mini window | mini-player-window.dom、mini-host-characterization、mini-snapshot.dom、mini-player-config.dom |
| 启动/watchdog | application-store组合；Rust ReadyGate | App/AppShell、WindowTitlebar、Sidebar、ResizeHotspots | app.ts→app/root-mount.ts→app/startup-before-main.ts→app/main.ts；app/main-window-ready.ts、Rust main_window.rs | root-shell.dom、real-module-startup.dom、playback-startup-installation.dom、main-window-ready、Rust ReadyGate |

文件无后缀的测试在 `tests/*.test.ts`；`.dom` 在 `tests/dom/*.dom.ts`。输入草稿不加 v-model，异步结果不得捕获旧分页草稿；Key、cookie、直链不进显示状态/日志。新节点一旦动态绑定，原控制器的同属性写入必须同时退出。

例外只有架构登记的audio、文档根主题、窗口/几何/焦点副作用与离屏取色。组件内非受控草稿端口保持唯一写入；新增控制器原生显示写入由scripts/vue/native-writes.ts拒绝。

C2 的资料库点击通过 libraryQueueEntries 保留混排父条目与 entryId；合集单击播放、双击或角标展开，父条目按 entryId 高亮。playback-queue-state 统一选择父条目、冻结成员与分P，playback-core 仅接线真实 BV/CID；Rust playback_state.rs 与 backup.rs 管理按需 v2。Rust 取流链路不变。合集被收藏及其中成员被单独收藏互不影响。

合集最终设计见 `docs/design/collections.md`；回归见 collection-playback-queue.test.ts、collection-playback.dom.ts 与 Rust playback_state/backup 测试。
