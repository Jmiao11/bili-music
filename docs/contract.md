# 前后端命令与事件契约

## 文件与边界

- `types/command-contract.d.ts`：30 个 DTO 的 JSON 类型、74 个命令的 Args/Result 映射及 invoke 签名。
- `types/event-contract.d.ts`：本项目 Tauri 事件及第三方/框架边界。
- `types/tauri.d.ts`：将上述声明接到现有 `window.__TAURI__`，主窗口、迷你窗共用。
- `tests/fixtures/contract/`：37 份输出金样（29 个 DTO，含 Some/None 和嵌套可空样例）及 1 份仅输入样例。
- `src-tauri/src/contract_tests.rs` 与各 DTO 所属模块的测试区：Rust 序列化和输入反序列化检查。
- `types/contract-fixtures.ts`：编译期 JSON 样例赋值、全部命令结果覆盖、正确调用和 `@ts-expect-error` 反例。
- `tests/command-contract.test.cjs`：注册/映射/前端调用集合，以及播放进度快照的取整特征。

生产 JS 仍使用现有 invoke，全局声明不增加运行时包装。UI 仅给 `home.js` 的 invokeWithTimeout 和超时 Promise 添加 JSDoc；invokeAppearance 是原 invoke 的别名，自动保留其泛型签名。

## JSON 类型规则

1. 命令顶层参数使用 Tauri 默认 camelCase。DTO 内部字段只遵循自身 serde，不自动递归改名。
2. 输出 Option 字段必须存在，声明为 `字段: T | null`；输入 Option 可以缺省，声明为 `字段?: T | null`。输入、输出方向不同的类型分别声明。
3. unit 输出为 null；Result 的成功类型是 T，不是 `{ Ok: T }`。Promise 的类型不描述 reject 载荷。
4. 整数的 JSON 表示是 number；Map 是 Record，BTreeSet 是数组。number 不保证整数性或 u64 精度范围，Rust 仍负责验证。
5. Rust String 保持 string，不把取流方式、歌词状态、AI 接口规范擅自收窄为业务联合类型。
6. invoke 只能使用 CommandMap 的键。无参数/只有可选参数的命令允许省略参数对象；必填参数有负向类型用例。
7. DTO 只声明真实字段。歌词兼容性探测的 camelCase 别名不是 Rust 输出字段，不能为消除诊断而补进 DTO。

### DTO 方向（按命令传输用途分类）

| 方向 | DTO | 样例与验证 |
|---|---|---|
| 仅输入 | TrackSnapshotInput | input-track-snapshot.json；Rust Deserialize 与 TS 输入赋值，不新增 Serialize |
| 双向 | TrackSnapshot | 输出金样；同时是 PlaybackState.queue 的输入元素，Rust 单独及嵌套反序列化、TS 队列赋值 |
| 双向 | PlaybackState | some/none 输出金样复用为输入；输出 page/cid 必有字段，输入可以省略 |
| 双向 | ShortcutBindings | some/none 输出金样复用为输入；输入允许省略绑定字段 |
| 仅输出 | AudioResponse、VideoPage、SearchVideo、RankingTrack、YtDlpAvailability、BackgroundImage、AudioCacheSettings、AudioCacheUsage、FavoriteToggleResult、Playlist、ImportPage、SearchHistoryItem、PlayHistoryItem、UnavailableTrack、PurgeResult、Shortcuts、AiConfigView、AiConnectionTestResult、Lyrics、PageMeta、CachedVideoPages、VideoMeta、LyricsBinding、ResolveOutcome、Candidate、ScoredCandidate | 各自序列化金样与 TS 输出赋值；有 Option 或嵌套 Option 的样例包括 Some/None |

部分“仅输出”类型也实现 Deserialize 以读取数据文件；这不意味着它是前端命令的输入类型。AiConfig 含 key，是内部存储类型，不生成契约 fixture。

## fixture 生成与更新

普通 cargo test 只读 fixture。输出样例由真实 DTO 序列化成紧凑 JSON，无尾部换行，避免 CRLF 检出影响字节比较。只有显式设置 UPDATE_CONTRACT_FIXTURES=1 才写输出样例。

PowerShell：

```powershell
$env:UPDATE_CONTRACT_FIXTURES = '1'
try {
    cargo test --workspace _contract_fixture -- --skip command_input_contract_fixtures_deserialize --test-threads=1
} finally {
    Remove-Item Env:UPDATE_CONTRACT_FIXTURES
}
cargo test --workspace
npm run typecheck
```

先更新输出测试再运行输入测试，避免首次生成时读取尚不存在的输出文件。`--test-threads=1` 避免更新期间同时读取正在写入的文件。仅输入 fixture 手工维护，必须同时通过 Rust Deserialize 和 TS 赋值；不要用伪造的 Serialize 实现替代验证。

更新后审阅 JSON 字节变化。不要只更新 fixture 来迁就未授权的行为变化。C1 的契约校验文件及声明文件若产生诊断，会直接失败，不能收入 UI 诊断清单。

## 新增或修改命令

1. 核对 Rust 签名、注入参数、cfg、返回类型和 serde 属性。State/AppHandle 不进入前端 Args。
2. 为新增 DTO 增加输出金样或输入 fixture；双向类型两种都做，Option 覆盖 Some/None。
3. 更新 CommandMap、DTO 与 `types/contract-fixtures.ts`；类型反例必须继续实际产生错误。
4. 注册守卫核对 debug = CommandMap；release = CommandMap − DEBUG_ONLY_COMMANDS。当前 debug-only 只有 debug_register_local_stream，新增成员必须显式修改守卫源码。
5. UI 调用必须属于 release 集合，实际命令名必须是字符串字面量。invokeWithTimeout 的内部转发单独检查，包装函数的调用点仍必须是字面量。
6. 执行 Rust debug/release、Node、npm typecheck 与 CRLF 克隆验证，审阅诊断变化；常规更新仅允许缩减清单。

现有命令映射守卫采用每行一条声明的格式棘轮；改格式时应明确调整扫描器，不能静默跳过解析不了的条目。

## 时长输入与存储边界

TrackSnapshotInput.durationSeconds 接受非负 JSON 整数，直接保留 u64 精度；小数先检查有限性和原值非负，再四舍五入，结果必须小于 2^64。-0 接受为 0；负数和越界值拒绝。

这影响 record_play、toggle_favorite、add_to_playlist、create_imported_playlist 的外部曲目输入。TrackSnapshot、PlaybackState 的队列元素、数据文件读取和备份导入保持严格整数校验。前端 playbackTrackSnapshot 已取整；currentTrackSnapshot 的播放记录快照保留取流结果的小数。

当前游客解析时长来源是 u64，yt-dlp 结果保留 f64，所以 CHANGELOG 描述已确认的 yt-dlp 播放记录问题。没有修改 prepare_audio、取消协调、代理、guest/WBI 或前端播放流程。

## 事件

| 名称 | 载荷 | 来源 |
|---|---|---|
| taskbar-media-control | previous / play_pause / next | taskbar.rs::clicked_action 与 emit；仅 Windows 实现 |
| global-shortcut | previous / play_pause / next / volume_up / volume_down | ShortcutBindings::entries，经 shortcuts.rs emit |
| mini-player-state | MiniPlayerStatePayload | mini-player-host.js::miniPlayerState，经 emitTo 发给 mini |
| mini-player-command | { action: previous / toggle_play / next / toggle_favorite } | mini.js::bindControls 与 emitCommand |
| mini-player-ready | 无载荷；Tauri event 插件把 None 序列化为 null | mini.js；Tauri 2.11.3 event/plugin.rs 的 Option<JsonValue> |

本项目事件的 listen/emit/emitTo 使用精确载荷。框架 `tauri://`、`plugin:` 名称有独立边界；其它第三方名称需在 TauriExternalEventMap 中显式登记，默认载荷为 unknown。不得用这些重载掩盖业务事件载荷错误。

DOM CustomEvent 的 detail 继续在 WindowEventMap/DocumentEventMap 中维护，不与 TauriEvent.payload 混用。

## 当前限制

- 不接入 ts-rs、specta、tauri-specta，不替换命令注册体系。
- strictNullChecks 尚未开启；类型中的 null 不等于现阶段能自动检测全部空值误用。
- 金样是代表性形状验证，不是对所有合法值、范围及版本的证明；业务校验与错误契约守卫继续保留。
- C1 一次性重建 UI 诊断清单。泛型条件元组转发及 Map 二元组推断各有一个诊断，仍在清单中，不用 any 或虚假 DTO 字段消除。
- Node 的契约守卫不依赖安装 TypeScript；编译期用例由 npm run typecheck 检查。
- 第三方事件及 Rust String 的业务枚举不在本批自动生成范围内。

## 74 个命令的结果覆盖

数组和 Record 使用元素 DTO 的 fixture；基本类型、null 不另造重复 JSON。下表与 CommandMap 一致。

| 命令 | Result 成功类型 | fixture 覆盖 |
|---|---|---|
| `read_public_favorite_page` | `ImportPage` | DTO；`import-page.json`；不需要额外 fixture |
| `create_imported_playlist` | `Playlist` | DTO；`playlist.json`；不需要额外 fixture |
| `set_taskbar_playback_state` | `null` | null；不需要额外 fixture |
| `open_mini_player` | `null` | null；不需要额外 fixture |
| `mini_player_ready` | `null` | null；不需要额外 fixture |
| `exit_mini_player` | `null` | null；不需要额外 fixture |
| `prepare_audio` | `AudioResponse` | DTO；`audio-response.json`；不需要额外 fixture |
| `analyze_track_loudness` | `number 或 null` | 基本类型或 null；不需要额外 fixture |
| `cache_track_audio` | `string` | 基本类型；不需要额外 fixture |
| `get_audio_cache_settings` | `AudioCacheSettings` | DTO；`audio-cache-settings.json`；不需要额外 fixture |
| `set_audio_cache_settings` | `AudioCacheSettings` | DTO；`audio-cache-settings.json`；不需要额外 fixture |
| `get_audio_cache_usage` | `AudioCacheUsage` | DTO；`audio-cache-usage.json`；不需要额外 fixture |
| `clear_audio_cache` | `number` | 基本类型；不需要额外 fixture |
| `get_track_loudness` | `number 或 null` | 基本类型或 null；不需要额外 fixture |
| `clear_loudness_data` | `null` | null；不需要额外 fixture |
| `get_video_pages` | `VideoPage[]` | 数组元素；`video-page.json`；不需要额外 fixture |
| `get_video_meta` | `VideoMeta` | DTO；`video-meta-none.json`, `video-meta-some.json`；不需要额外 fixture |
| `get_cached_video_pages` | `Record<string, CachedVideoPages>` | Record 值；`cached-video-pages.json`；不需要额外 fixture |
| `clear_video_pages_cache` | `number` | 基本类型；不需要额外 fixture |
| `cancel_prepare_audio` | `null` | null；不需要额外 fixture |
| `debug_register_local_stream` | `string` | 基本类型；不需要额外 fixture |
| `search_videos` | `SearchVideo[]` | 数组元素；`search-video-none.json`, `search-video-some.json`；不需要额外 fixture |
| `get_music_ranking` | `RankingTrack[]` | 数组元素；`ranking-track-none.json`, `ranking-track-some.json`；不需要额外 fixture |
| `get_stream_source` | `string` | 基本类型；不需要额外 fixture |
| `get_yt_dlp_availability` | `YtDlpAvailability` | DTO；`yt-dlp-availability.json`；不需要额外 fixture |
| `set_stream_source` | `string` | 基本类型；不需要额外 fixture |
| `open_bilibili_video` | `null` | null；不需要额外 fixture |
| `choose_background_image` | `BackgroundImage 或 null` | DTO；`background-image.json`；不需要额外 fixture |
| `load_background_image` | `BackgroundImage` | DTO；`background-image.json`；不需要额外 fixture |
| `list_favorites` | `TrackSnapshot[]` | 数组元素；`track-snapshot.json`；不需要额外 fixture |
| `is_favorite` | `boolean` | 基本类型；不需要额外 fixture |
| `toggle_favorite` | `FavoriteToggleResult` | DTO；`favorite-toggle-result.json`；不需要额外 fixture |
| `reorder_favorite` | `TrackSnapshot[]` | 数组元素；`track-snapshot.json`；不需要额外 fixture |
| `list_playlists` | `Playlist[]` | 数组元素；`playlist.json`；不需要额外 fixture |
| `create_playlist` | `Playlist[]` | 数组元素；`playlist.json`；不需要额外 fixture |
| `rename_playlist` | `Playlist[]` | 数组元素；`playlist.json`；不需要额外 fixture |
| `delete_playlist` | `Playlist[]` | 数组元素；`playlist.json`；不需要额外 fixture |
| `add_to_playlist` | `Playlist[]` | 数组元素；`playlist.json`；不需要额外 fixture |
| `remove_from_playlist` | `Playlist[]` | 数组元素；`playlist.json`；不需要额外 fixture |
| `reorder_playlist_item` | `Playlist[]` | 数组元素；`playlist.json`；不需要额外 fixture |
| `reorder_playlist` | `Playlist[]` | 数组元素；`playlist.json`；不需要额外 fixture |
| `record_search_history` | `null` | null；不需要额外 fixture |
| `get_search_history` | `SearchHistoryItem[]` | 数组元素；`search-history-item.json`；不需要额外 fixture |
| `clear_search_history` | `null` | null；不需要额外 fixture |
| `get_shortcuts` | `Shortcuts` | DTO；`shortcuts-none.json`, `shortcuts-some.json`；不需要额外 fixture |
| `set_shortcuts` | `null` | null；不需要额外 fixture |
| `record_play` | `null` | null；不需要额外 fixture |
| `get_play_history` | `PlayHistoryItem[]` | 数组元素；`play-history-item.json`；不需要额外 fixture |
| `get_playback_state` | `PlaybackState 或 null` | DTO；`playback-state-none.json`, `playback-state-some.json`；不需要额外 fixture |
| `save_playback_state` | `null` | null；不需要额外 fixture |
| `clear_playback_state` | `null` | null；不需要额外 fixture |
| `mark_track_unavailable` | `null` | null；不需要额外 fixture |
| `clear_track_unavailable` | `null` | null；不需要额外 fixture |
| `list_unavailable_tracks` | `UnavailableTrack[]` | 数组元素；`unavailable-track.json`；不需要额外 fixture |
| `list_disabled_pages` | `Record<string, number[]>` | Record/数组；不需要额外 fixture |
| `set_page_disabled` | `null` | null；不需要额外 fixture |
| `clear_disabled_pages` | `null` | null；不需要额外 fixture |
| `purge_unavailable_tracks` | `PurgeResult` | DTO；`purge-result.json`；不需要额外 fixture |
| `get_ai_config` | `AiConfigView` | DTO；`ai-config-view-none.json`, `ai-config-view-some.json`；不需要额外 fixture |
| `set_ai_config` | `AiConfigView` | DTO；`ai-config-view-none.json`, `ai-config-view-some.json`；不需要额外 fixture |
| `test_ai_connection` | `AiConnectionTestResult` | DTO；`ai-connection-test-result.json`；不需要额外 fixture |
| `get_saved_recommendations` | `SearchVideo[]` | 数组元素；`search-video-none.json`, `search-video-some.json`；不需要额外 fixture |
| `get_lyrics_by_id` | `Lyrics` | DTO；`lyrics.json`；不需要额外 fixture |
| `search_lyrics_songs` | `Candidate[]` | 数组元素；`candidate.json`；不需要额外 fixture |
| `clear_lyrics_cache` | `number` | 基本类型；不需要额外 fixture |
| `get_lyrics_offset` | `number` | 基本类型；不需要额外 fixture |
| `set_lyrics_offset` | `null` | null；不需要额外 fixture |
| `resolve_lyrics` | `ResolveOutcome` | DTO；`resolve-outcome-none.json`, `resolve-outcome-some.json`；不需要额外 fixture |
| `get_lyrics_binding` | `LyricsBinding 或 null` | DTO；`lyrics-binding.json`；不需要额外 fixture |
| `set_lyrics_binding` | `null` | null；不需要额外 fixture |
| `clear_lyrics_binding` | `null` | null；不需要额外 fixture |
| `get_recommendations` | `SearchVideo[]` | 数组元素；`search-video-none.json`, `search-video-some.json`；不需要额外 fixture |
| `export_data` | `string 或 null` | 基本类型或 null；不需要额外 fixture |
| `import_data` | `string 或 null` | 基本类型或 null；不需要额外 fixture |
