# 存储层规则

## 收藏与歌单的按需 v2（C1）

`favorites.json` / `playlists.json` 分别支持 v1、v2；共用 `VERSION` 不变，播放状态的独立升级见下节。v1 只在内存转成 `LibraryEntry`，读取或无效操作不写回。每次真实修改按内容选择格式：没有合集写 v1 的原视频数组；含合集写 v2，歌单文件的所有 items 统一使用带类型条目。删除最后一个合集后可写回 v1，原保护备份仍保留。

- 视频条目：`{kind:"video",entryId:"video:<小写BV>",video:TrackSnapshot}`；v1 不保存 entryId，按 BV 推导。
- 合集条目：`{kind:"collection",entryId:<UUID>,collectionId,anchorBvid,title,thumbnailUrl,videoCount,addedAt,snapshot:{fetchedAt,items:TrackSnapshot[]},sourceStatus:"active"|"invalid"}`。
- 去重键分别为 `video:<小写BV>` / `collection:<id>`；同一视频单独存在与出现在合集快照中互不影响。合集在收藏与每个歌单中独立保存 entryId、加入时间和最近完整快照，不新增独立快照文件。
- 快照须非空、成员 BV 有效且不重复、计数一致。刷新只替换相同合集 id 的存活 entryId，保留原加入时间；删除后重加取得新 UUID，旧结果不能恢复原引用。合集缩减为一个视频仍可更新。

第一次把现有 v1 文件写成 v2 前，在同一次存储锁中逐字节备份为同目录的 `favorites.v1.bak.json` / `playlists.v1.bak.json`。使用 create-new 与同步写入，已有有效 v1 备份不覆盖；不存在原文件时不伪造保护备份。创建、读取或校验备份失败均停止升级，原文件不写入。已有残缺文件不能冒充备份，目录及符号链接不作为有效备份文件。随后仍走既有 tmp/bak/rename 原子写入。

ZIP 继续使用原白名单和容器：导出只包含当前活动资料库，不导出两份 `.v1.bak.json`；导入先完整预检 v1/v2，写入含合集的 v2 前同样保护现有 v1。v1 与含合集 v2 保留输入原始字节；没有合集的 v2 在导入时按需降为 v1。写入失败沿用既有整体回滚，已创建的保护备份保留。旧程序（对照 `9bc3ec8`）读取 v2 会报版本或结构错误，读取失败使写操作退出；升级前应先导出备份，不承诺旧版直接读取新资料库。

打开合集先显示当前引用的快照并显式刷新，使用 V2 独立无 cookie、8 秒详情客户端。同 id 的前端并发请求共享一个 Promise；首屏强制绕过旧内存缓存，后续分页使用本次完整内存列表。不轮询全库、不自动换成员探测；风控直接报错。成员失效、详情缺失旧合集或网络失败只表示「来源无法校验」，保留快照与日期，用户可明确选择另一快照成员重试；详情接口不能证明合集整体删除时不持久标失效。已有明确的 invalid 状态显示「合集来源已失效」，仍保留可逐个尝试播放的成员。

刷新不改变既有播放队列；C2 整体播放资料库包含合集父条目，从展开视图播放仍使用普通 BV 列表。AI 偏好与失效视频清理只读取普通视频，不把合集锚点当成独立资料库视频。

## 播放状态的按需 v2（C2）

`playback-state.json` 仅在 queue 含合集父条目时写 v2；否则写原 v1 字段，不保存 entryId 或 traversal。v1 读取不写回。v2 的 collection 保存独立完整快照、memberIndex、剩余成员、配额计数、已计数音频身份和历史回放成员；traversal 保存顶层随机轮次、entryId/BV/CID 历史、分P轮次及随机/循环模式。恢复冻结列表与游标，不为恢复请求新列表。

首次从 v1 升为 v2 前复用存储锁、backup_before_v2 与原子写入，创建 `playback-state.v1.bak.json`；有效备份不覆盖，备份失败原文件不动。不存在原 v1 时不伪造备份。导入先验证完整快照、游标和历史身份，复用备份与整体失败回滚；导出仍使用现有 ZIP 白名单，不包含保护备份。旧程序无法恢复 v2 播放状态；库文件及独立播放历史格式不因此改变。

## 全局锁与令牌

`src-tauri/src/storage.rs` 使用进程内唯一的 `Mutex<()>` 串行化数据根目录文件操作。它不协调不同应用进程，也不把多个文件变成文件系统级原子事务。

最外层存储入口调用 `lock_storage()`，取得 `StorageGuard` 后向下传递引用。守卫不可 `Send`、不可 `Clone`，字段私有，只能由加锁函数创建。同一线程重复加锁立即返回错误，debug 和 release 都生效。锁中毒时通过 `PoisonError::into_inner` 恢复使用，不新增界面提示。

`library::read_json_or_default` 和 `library::write_json_atomic` 要求 `&StorageGuard`。内部读写、迁移和路径辅助函数接收同一个令牌，不再自行加锁。测试调用 `_at` 等路径入口时，在最外层取得令牌并传入；线程局部测试目录覆盖只存在于 `cfg(test)`。

全局锁替代原来的 `DISABLED_PAGES_FILE_LOCK`、`UNAVAILABLE_TRACKS_FILE_LOCK`、`LOUDNESS_FILE_LOCK` 和 `VIDEO_PAGES_CACHE_WRITE_LOCK`。任务级 busy 标志继续保留。

## 覆盖范围与入口

覆盖收藏、歌单、搜索历史、播放历史、播放状态、失效曲目与 purge、禁用分P、快捷键、响度记录、AI 配置、推荐结果、歌词偏移、歌词绑定、分P缓存、背景图片副本，以及备份导入和导出涉及的根目录文件。

- 同步资料库命令在入口取得锁，覆盖读取、修改、写回的完整区间。
- AI 配置读写和推荐保存各自在存储入口加锁。联网调用只在同步读取配置时短暂取得锁，网络阶段不持锁。
- 歌词偏移、绑定与分P缓存入口加锁。自动匹配在网络请求结束后的写入调用处取得锁。
- 背景图片读取为锁内内存快照；解码、缩放和 JPEG 压缩在释放锁后执行。保存副本的删除与复制处于同一次持锁区间。
- 快捷键写入释放存储锁后才调用系统快捷键重载，避免重载读取配置时重入。
- purge 在同一令牌下处理收藏、歌单和失效标记，保留原执行顺序和失败边界：第二个文件写入失败时，第一个文件的更新不回滚。

## 持锁禁止事项

持锁期间禁止 `.await`、网络请求、文件选择对话框、响度分析、图片解码与压缩、ZIP 压缩与解压。只在锁内进行必要的文件读写、JSON 处理和回滚。

导出流程：文件选择在锁外；持锁将根目录文件读入内存快照并移除 AI key；释放锁后压缩、写出 ZIP。收藏和歌单来自同一个存储快照。

导入流程：在锁外解压、检查条目与大小，并用各领域现有类型反序列化、校验版本。任何校验失败都不开始写入。持锁后处理需要补 key 的 AI 配置；全部通过后保存回滚快照、写入全部文件，失败时仍在同一次持锁区间内回滚。

写入使用临时文件、旧文件备份和重命名，命名复用 `atomic_temp_path`、`atomic_backup_path`。普通文件和本身带 `api_key` 的 AI 配置保持备份原始字节，不重新序列化。JSON 写入与原始字节导入共用文件写入和替换实现；缓存与带令牌的 JSON 入口共用同一份 JSON 实现。

## AI key 与导入校验

导出不包含 `api_key`。导入缺少该字段时，在持锁区间读取本机 key、补全、重新序列化并校验补全后的配置；通过后才写任何文件。补全或校验失败时磁盘不变。

本机配置不存在时补入空 key；读取失败或 JSON 损坏时沿用原错误并拒绝导入；合法 JSON 缺少字符串 key 时沿用空 key 回退。本机配置本身不另做领域结构或版本校验。

领域校验复用原有反序列化类型与版本规则，不回显无效文件内容。新增无效数据错误只包含白名单文件名，并经 `safe_error` 返回。背景图片不做图像解码校验。

保留现有回滚语义：回滚不完整时报告失败文件与快照位置并保留快照；回滚成功但快照清理失败时报告清理失败。加锁不增加跨文件事务或 panic 自动回滚。

## 明确例外

音频缓存 `cache/audio` 保留 `AUDIO_CACHE_INDEX_LOCK` 和 `cache_busy`。`audio_cache.rs` 仅通过别名接到 `read_json_or_default_without_storage_lock`、`write_json_atomic_without_storage_lock`；这两个入口的名字只能出现在 `storage.rs` 和 `audio_cache.rs`。

Q-2 的音频缓存/响度测量用 `BV:CID:音轨ID` 区分实际 AAC 轨，旧项保留但不复用。缓存 version 1 索引的可选 `qualityMemos` 保存 `BV:CID:请求档位 → {audioId, recordedAt}`，有效期7天；损坏备忘视为缺失，清空缓存同时清空备忘。写入复用既有索引原子写入，并与当前 resolve 身份互斥；完整规则见 [音质设计](design/audio-quality.md)。

直接文件 I/O 的生产例外按文件与函数固定，不能使用通配符：

| 文件 | 函数 | 原因 |
| --- | --- | --- |
| `audio_cache.rs` | `finish_download_at` | 音频缓存文件落盘，使用缓存索引锁 |
| `audio_cache.rs` | `delete_items_at` | 缓存淘汰 |
| `audio_cache.rs` | `remove_part_file` | 缓存下载残留清理 |
| `audio_cache.rs` | `cache_track_audio` | 联网写入缓存子目录 |
| `audio_cache.rs` | `clear_cache_at` | 清空缓存子目录 |
| `lyrics.rs` | `read_lyrics_cache_inner` | 读取 `lyrics/<id>.json` 子目录 |
| `lyrics.rs` | `write_lyrics_cache` | 写入歌词缓存子目录 |
| `lyrics.rs` | `clear_lyrics_cache` | 清空歌词缓存子目录 |
| `loudness.rs` | `local_audio_source` | 响度分析读取音频缓存 |
| `main.rs` | `proxy_local_audio` | 播放核心读取本地音频缓存 |
| `search.rs` | `read_netscape_cookies` | 外部 cookie 文件，不属于应用数据 |
| `library/backup.rs` | `export_data_blocking` | 锁外创建用户选择的 ZIP 输出文件 |
| `library/backup.rs` | `import_data_blocking` | 锁外打开用户选择的 ZIP 输入文件 |

测试模块中的临时文件准备、故障注入与结果读取不受生产 I/O 棘轮限制。

## 守卫与回归测试

存储 I/O 棘轮复用去注释词法器，扫描 `src-tauri/src` 所有 Rust 文件，禁止存储模块外直接使用规定的文件读写 API，只有上述明确例外可以通过。它是源码棘轮，不是完整 AST 分析；别名和其它文件 API 不属于该文本守卫的检测范围。无锁 JSON 入口另有使用范围守卫。

并发测试使用线程局部钩子和通道闸门，不靠 sleep 构造交错。等待“写入尚未完成”的否定断言使用 200ms 超时。覆盖两个歌词偏移 key、导入与播放历史写入、失败回滚与并发写入、导出快照与 purge。临时取消全局互斥后四项均失败，恢复后通过。

导入测试覆盖白名单每种 JSON 的错误结构和不支持版本、AI 缺必需字段、补 key 后校验失败、原始字节保留、有效备份往返，以及原有回滚故障边界。重入检测和中毒后恢复读写也有测试。
