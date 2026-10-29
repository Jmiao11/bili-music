# 最近播放（R-1）

资料库导航在收藏与歌单之间增加最近播放，复用 settings.navigate/setActiveView、TrackRow 和 TrackColumns；播放时间占用 plays 列及其宽度/隐藏规则。列表来自听歌记录，按最近播放时间倒序，忽略 BV 大小写去重，上限200；不改变按 BV 累计次数并移到首位的持久化规则。

## 数据与离线

- `play-history.json` 保持 version 1，新增 serde default 的可选 lastCid、lastPage、lastPartName；旧文件缺省为空。v1.0.0 的原始 item/file 结构没有 deny_unknown_fields，兼容测试用原结构读取新增字段后的实际文件。旧记录按普通视频播放，有 lastCid 的记录使用最近分P。元数据仍仅来自现有快照。
- 开发数据在 `.local-data/`；当前 Windows 发布数据在 `%APPDATA%/bili-music/`。本任务不改路径，未读取真实运行时数据。
- Rust `check_audio_cache` 为只读批量命令，仅查询有 lastCid 的条目；与取流前 lookup 共用 inspect_cached_file_at 的音轨选择、7天备忘有效期、enabled、索引项、文件名与文件存在判断。读取失败不显示可离线标记。只读查询不创建目录、不更新访问时间、不清理索引；原 lookup 继续承担这些写入。
- `loadPagesForCurrentVideo` 在线请求失败后依次读取现有 get_cached_video_pages、使用已知分P、保持原提示及单视频行为。每次异步回退后核对原 requestVersion，迟到结果不能覆盖新播放。最近播放将 lastCid 作为现有播放入口的分P提示；不修改队列调度、解析、CDN探测、失败跳过或媒体监听。
- 原链路中分P请求依赖游客身份/WBI/视频详情网络请求，不读取磁盘分P缓存；其失败丢 CID 曾间接使音频缓存必 miss。本次按授权修复这一失败分支。封面、歌词和响度失败不阻断音频；真实断网播放仍需 Windows 手测。

## 状态与生命周期

recent 为唯一应用 store 的独立切片；排序、格式化及状态均无 DOM 或平台时钟，当前时间由控制器在进入页面时传入。行投影复用稳定会话和浅比较：进度不刷新列表，当前播放变化仅改变受影响行。recent controller 订阅已有 store，不改变提交与通知策略；仅页面可见时挂载 window online/offline，离页/合集覆盖时移除。进入页面、音质变化、已有设置“缓存已清空”成功状态触发只读标记刷新，不轮询。查询版本隔离迟到结果。

标题后的12px闪电使用 text3，title 为“已缓存,可离线播放”。离线时仅此页未命中行 opacity .45，title 为“需要联网”，点击仍走原播放流程。未增加清空记录按钮。新表头仅进入页面时挂载，沿用列宽分隔线控制器；无新增节点ref或原生显示写入例外。

## G0 单项重建

旧fixture已存档于仓库外报告目录的 `R-1-G0-before.json`。经本任务单项授权及用户补充确认，仅增加侧栏最近播放的 click 监听（索引155），序列 **193/149 → 194/149**；删除新增后与旧序列逐条一致。播放/请求/trackchange/媒体监听、四项IPC listen、跨窗同步及首个trackchange索引保持。

- 新fixture Git/LF SHA256：`4bf021a64f953f8ce5b4f0339d05ea698517c0dd33f4c4136ec99b96befcd5c7`。
- `mini-host-loading.dom.ts` 仅将总数193同步为194，其他断言保持；real-module-startup.dom.ts 经用户单项授权仅同步模块清单计数68→70；模块图/状态守卫/类型与DOM分组仅登记两个新模块及新测试，原行为断言保持。backup.rs 两处测试调用经用户单项授权补三个 None，不改断言或业务代码。
- 新测试：recent-plays.test.ts（真实store/生命周期），recent-plays.dom.ts（真实挂载与三级回退、cacheCid、记录字段、迟到隔离）；Rust history兼容性与cache共享判断一致性测试。完整验收与截图保留于仓库外报告。两项仓库外变异（缓存查询版本核验、分P回退请求核验）均被新增测试捕获并恢复。
