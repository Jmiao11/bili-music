# Q-3a：播放队列抽屉调研与方案

## 基线与范围

本次只读调研及文档整理，不实现功能。证据均为仓库相对路径及 **1 起始行号**；下文“建议”均为后续实现提案，不代表已经获得产品代码、状态机、G0 或冻结断言的修改授权。

2026-11-07 fetch 后，本地 master 原为 `d0fb92577c3b1d2bc50c7d6bfd96377e7024fadc`，产品基线为其父提交 `94ef03bb97d9ae3117f2f08c3255f17714b61dc3`。远程 `origin/master` 为 `2d39770ac1dacaec08edb74a8f5cfe5292d355fd`，包含进度条修复，双方分叉。用户已明确允许按本地 **194/149** 继续，豁免本任务的 HEAD == origin/master 前置条件；没有合并、推送 master，也没有更改产品和测试文件。未来实施前须重新对齐届时批准的基线。

脚本对 Git blob 核算，并核对工作区转 LF 后内容相同：G0 **194 条，首个 trackchange dispatch 的 0 起始索引 149**，Git/LF SHA256 为 `4bf021a64f953f8ce5b4f0339d05ea698517c0dd33f4c4136ec99b96befcd5c7`。计算条件与 `scripts/vite/verify-dist.ts:107` 相同：`event.action === "dispatch" && event.type === "bilibili-music-trackchange"`，不能把早先的同名 listen 算成首次派发。远程对应值为 **200/155**、SHA256 `0b46fab6237fd126936164332e3db46cdd04b0f2f1fbcab9f92cac50acaae395`，不纳入本次本地文档的“当前 G0”。历史批次记录保持原样。

## 1. 队列数据与来源入口

队列按**父条目**计数。一个普通视频是一项，一个多 BV 合集也只是一项；合集成员与分P不是外层 queue 索引。播放栏也是 `currentIndex + 1 / queue.length`，不能把抽屉展开的子行数当作队列总数。证据：`ui/features/playback/playback-queue-state.ts:27`、`ui/features/playback/playback-display-view.ts:16`。

| 数据 | 当前含义及约束 | 证据 |
|---|---|---|
| `queue` | 已升级为真实播放队列的规范化快照；普通项带视频元数据，资料库项可带 `entryId`，合集项另带 `collection`。不是当前搜索展示列表的别名。 | `ui/features/playback/playback-queue-state.ts:6`、`:34`、`:60` |
| `currentIndex` | 外层父条目的 0 起始索引，初始 `-1`；实际合集音轨由 `activeQueueTrack` 解出。 | `ui/features/playback/playback-queue-state.ts:18`、`:22` |
| `randomRemaining` | 本轮尚未选取的父条目索引栈，尾部弹出；初始化排除当前项，播放指定项时过滤掉它。它不是抽屉的展示顺序。列表循环才会在耗尽后补一轮。 | `ui/features/playback/playback-queue-state.ts:59`、`:98`、`:104`、`:105` |
| `queueSource` | 播放来源身份：初始 `none`，直接播放 `direct`，恢复后 `restored`；其他入口有 `search`、`ranking`、`recommendation`、`favorites`、`playlist`、`recent`、`collection`。用于分页归属、列表高亮及最近播放分P提示。 | `ui/features/playback/playback-queue-state.ts:19`、`:60`、`:87`；`ui/features/tracks/track-list-ui.ts:37`、`:141`、`:164`；`ui/features/playback/playback-core.ts:501` |
| `playlistId` | 仅 `playlist` 来源保留歌单身份，其他替换来源设为 null；不等于要求播放队列随歌单实时变动。合集重新入场时可用它定位资料库引用。 | `ui/features/playback/playback-queue-state.ts:61`；`ui/features/playback/playback-core.ts:523` |
| `queueSearchVersion` | 仅 search/collection 来源保留请求版本；同来源、同版本才可把后续分页追加到现有播放队列。新搜索不会直接换队列。 | `ui/features/playback/playback-queue-state.ts:61`、`:99`；`ui/features/search/search-state.ts:57`、`:77` |
| 合集冻结成员与游标 | `data.snapshot.items` 为一轮使用的完整成员快照；`memberIndex` 选中成员，`remaining` 是剩余成员索引栈；`playedCount`/`chargedUnits` 统计已结算的不同音频单位，`unitCharged` 防重复结算；`historyTrack` 保存已从新快照消失的历史成员。当前分P另由 `currentPageIndex` 和 session 的 `currentPages` 表示。 | `types/command-contract.d.ts:25`；`ui/features/playback/playback-queue-state.ts:70`、`:76`、`:121`、`:158` |
| `collectionNeedsRefresh`、历史与分P轮次 | 正常选择合集父条目要求重新解析完整快照并冻结；历史返回/恢复不强制刷新。`history` 保存实际父索引、CID，混合队列还保存 entryId/BV/历史成员快照；`randomPageRound` 是 BV 内分P轮次，与父项随机栈分开。 | `ui/features/playback/playback-queue-state.ts:63`、`:84`、`:94`、`:140`；`ui/features/playback/playback-core.ts:522` |

“冻结”指本轮成员集合及遍历游标，不是永久不更新：重新进入合集会取完整快照，失败才复用完整本地快照；播放结果可补充成员元数据。证据：`ui/features/collections/collection-state.ts:35`、`ui/features/playback/playback-queue-state.ts:178`。抽屉只读这些数据，不能为展开列表另发合集/分P请求。

| 入口 | 升级/扩展过程 | 证据 |
|---|---|---|
| 搜索点击 | `playSearchResult` → `playListItem("search", results, index, requestVersion)`；后者替换父队列、清空历史、重建随机剩余项后播放。 | `ui/features/playback/playback-core.ts:764`、`:803` |
| 搜索分页 | 请求版本及执行时草稿回读隔离旧响应；展示先去重，唯一新增项传给 `appendSearchQueue`。仅当前队列仍属本次搜索才扩展 queue；随机模式把新增索引洗牌追加到 remaining 的尾部，保存恢复状态。 | `ui/features/search/search-state.ts:38`、`:87`；`ui/features/playback/playback-core.ts:275`；`ui/features/playback/playback-queue-state.ts:99` |
| 首页榜单/推荐 | 行点击取当前 ranking/recommendations，经 `playListItem` 建立 `ranking`/`recommendation` 队列。 | `ui/features/tracks/track-list-ui.ts:135` |
| 收藏/歌单 | `libraryQueueEntries` 保留混排父条目及 entryId，合集初始化成员游标；点击经 `playListItem`，歌单同时传 playlistId。 | `ui/features/library/library-ui.ts:83`；`ui/features/playback/playback-queue-state.ts:27` |
| 最近播放 | 点击将当时 recent.items 升级为 `recent` 队列；实际加载时按 BV 查最近记录的 CID/page 提示，未命中仍用现有默认分P选择。 | `ui/features/tracks/track-list-ui.ts:163`；`ui/features/playback/playback-core.ts:501`、`:554` |
| 合集详情页 | `playCollectionItem` 把详情页已展示的成员作为普通视频队列，来源 `collection`；分页按其 requestVersion 扩展。它不同于资料库中的单个合集父条目。 | `ui/features/collections/collection-controller.ts:38`、`:46` |

## 2. 跳转：复用已有播放链路

| 已有动作 | 能否直接表达“队列第 N 项” | 证据 |
|---|---|---|
| `playQueueIndex(index, options)` | 可以，传 N−1；现为模块私有。清恢复状态、按真实音频状态记历史、选择父索引、清分P、消耗该项的随机索引，随后进入现有取流/取消/版本隔离链路。 | `ui/features/playback/playback-core.ts:811`、`:1086` |
| `playListItem` / `playSearchResult` | 是“把来源列表换成队列再播放”；即使传当前 queue，非当前点击仍会替换队列、清历史和重洗随机栈。不能用它伪装原队列内跳转。 | `ui/features/playback/playback-core.ts:775`、`:803` |
| `playNext` / `playPrevious` | 下一首先尝试推进合集成员，再按顺序/随机取父项；上一首消费真实历史并恢复 CID/成员。都不接受任意 N。不能反复 next 来跳到 N。 | `ui/features/playback/playback-core.ts:894`、`:922` |
| queue actions 的 `selectIndex` / `selectPage` | 仅提交状态，不负责停止旧音频或开始取流，不能从组件直接组合成播放器。`selectPage` 只适用于当前 BV。 | `ui/features/playback/playback-queue-state.ts:89`、`:94` |
| `playCurrentVideoPage` | 能切当前 BV 的已知分P，不能选择其他父项/合集成员。 | `ui/features/playback/playback-core.ts:295` |

**建议：不新增播放状态机分支。** 导出并通过控制器稳定回调接入已有 `playQueueIndex`，组件只传父索引；复用其既有 actions 和 `loadCurrentTrack`，不把 `selectIndex`、取流和 audio 操作复制到抽屉。根挂载先于控制器求值，应沿用 `root-playback.ts` 的稳定转发/稍后 install 模式，避免由首屏投影提前导入播放控制器。证据：`ui/features/playback/root-playback.ts:33`、`:51`，`ui/app/root-mount.ts:12`、`:48`。

一期建议点击当前父项不重复播放、不重新冻结合集；仍显示当前高亮，播放/恢复继续用原播放栏。此处是抽屉点击策略，不改变核心函数被其他调用方使用时的行为。普通父项直接跳转沿用 `playQueueIndex` 默认 `randomStartPage=false`，选首个未禁用分P；recent 来源保留历史分P提示。自动/下一首在随机且内部顺序为 random 时传 `randomStartPage=true`，两者目前并非同一入口语义，不能擅自统一。证据：`ui/features/playback/playback-core.ts:501`、`:540`、`:811`、`:915`。

### 随机与上一首的确切语义

- 指定父项跳转只从 `randomRemaining` 移除目标，保持其他剩余项的顺序；不重洗、不把离开的项塞回、不恢复已经消耗的项。目标此前已不在栈中时过滤结果不变。证据：`ui/features/playback/playback-queue-state.ts:104`，`ui/features/playback/playback-core.ts:850`。
- 不同父项跳转默认把离开项及 CID 加入 history；离开合集时，只有当前请求确实持有活跃音频才记录，避免把尚未播出的取消任务记进历史。上一首弹出历史，以 `recordCurrent:false` 返回；返回也不会把目标重新加入剩余栈。证据：`ui/features/playback/playback-queue-state.ts:63`、`:94`、`:121`；`ui/features/playback/playback-core.ts:834`、`:930`。
- 例：A 已选，remaining 为 `[D,C,B]`，点 C 后为 `[D,B]`，历史记 A；上一首回 A 后仍为 `[D,B]`，下一父项取 B。若当前是合集，next 可能先走剩余成员，因此这个例子仅描述外层父项。现有混排测试明确覆盖历史返回不补回外层随机项：`tests/collection-playback-queue.test.ts:66`。

### 合集跳转落点

正常点击**非当前合集父项**沿用 `selectIndex` 的 refreshCollection 默认值：重新校验完整快照，必要时更新资料库引用，再 `freezeCollection`。顺序模式，或 shuffle 开启但合集内部顺序为 sequential，选完整快照第一个成员；shuffle 且内部顺序为 random 时洗牌选首成员，并随机选其未禁用分P。普通顺序选首个未禁用分P，不一定是 P1。证据：`ui/features/playback/playback-queue-state.ts:70`、`:94`；`ui/features/playback/playback-core.ts:522`、`:540`。当前抽屉显示的旧游标不承诺是重新进入的落点，应标明“重新进入按当前播放规则开始”。

上一首则恢复历史 BV/CID；必要时使用 `historyTrack`，不按上面的新入场规则重置成员。恢复文件同样保留冻结轮次，不刷新。证据：`ui/features/playback/playback-queue-state.ts:84`、`:121`；`ui/features/playback/playback-core.ts:237`、`:930`。

**一期合集子项只读，父分组头可跳转。** 建议默认折叠非当前合集，当前合集可展开快照成员，子项缩进并标记当前成员；可手动展开其他合集查看。任意“指定其他合集的第 M 个成员/第 P 个分P”目前没有完整入口，不能先改 memberIndex 再调用会重新冻结的父项跳转。该能力留待单独定义成员/分P轮次、配额及历史语义后授权，不纳入一期。证据：`ui/features/playback/playback-queue-state.ts:158`、`ui/features/playback/playback-core.ts:837`、`:522`。

## 3. 删除与清空：状态及持久化风险

现有 actions 没有“移除队列项”接口；`replaceQueue` 会清历史、重置选中项，不能当作无损删除。依据：`ui/features/playback/playback-queue-state.ts:60`、`:181`。下列是后续所需改动分析，不是已确定的新动作实现。

| 操作 | 必须协调的状态/副作用 | 风险与建议 |
|---|---|---|
| 删除非当前普通父项 | 一次提交移除 queue 项；若在当前项之前则 currentIndex−1；randomRemaining 去掉删除索引并重编号；history 丢弃该父项记录并重编号其他记录，保留 CID/pageLevel/entryId/BV/track。保持当前音频、分P、配额与恢复位置。若在解析/恢复途中，需协调捕获的旧 index，避免异步元数据写到移位后的另一项。 | 中高：不仅是数组 splice。一期不做；二期先做这一类。证据：`ui/features/playback/playback-queue-state.ts:9`、`:44`；`ui/features/playback/playback-core.ts:505`、`:602`。 |
| 删除当前父项 | 先明确候选后继，再做索引事务；停止旧音频并失效旧请求/恢复，清当前分P和随机分P轮次，处理历史、显示、失败计数/提示及新项加载。不能 splice 后调用 playNext，否则会错过顺序后继，或继续已删除合集的成员。最后一项删除时应停止播放、清 pendingResume、清恢复文件。 | 高：触及播放/请求状态机。建议二期独立小批，规则先批准。后继建议沿既有外层随机/顺序/列表循环选择，删除意图不受单曲自动重播限制；顺序末尾无后继则停止。证据：`ui/features/playback/playback-core.ts:154`、`:162`、`:173`、`:894`；`ui/features/playback/playback-queue-state.ts:115`。 |
| 删除整个合集父项 | 与前两类相同，并删除它的整个冻结游标和所有对应历史；若当前为该合集，不能只删除当下 BV。其他父项内部成员索引无需重排。 | 高：v2 历史要求 index 与 entryId/BV 一致；一期不做。证据：`src-tauri/src/library/playback_state.rs:180`、`:203`。 |
| 仅删除合集中的成员 | 不应直接删 `data.snapshot.items` 或改 videoCount：它代表完整来源快照；还涉及 memberIndex、remaining、chargedUnits、historyTrack、分P配额和后续刷新。需要单独定义本轮排除策略及是否持久化。 | 高，二期也建议暂缓。不为删除一个子项引入新存储格式。证据：`src-tauri/src/library/entries.rs:100`；`ui/features/playback/playback-queue-state.ts:70`、`:76`、`:158`。 |
| 清空 | 所有父项和遍历记录清空，currentIndex 回到无当前项；协调取消/恢复、唯一 audio、显示状态与恢复文件，清理焦点。不能只有 queue=[] 而继续播放旧音频。 | 高，随当前项删除一并设计。证据：`ui/features/playback/playback-queue-state.ts:18`；`ui/features/playback/playback-core.ts:178`。 |

**来源关联也必须处理。** 删除后 queue 索引与原搜索/首页/合集详情的展示索引不再相等；原高亮及元数据回填依赖这些索引，继续保留 source/version 会标错行。二期推荐首次结构编辑后脱离原列表，采用已有 `direct` 来源并清 `queueSearchVersion`/`playlistId`，停止原来源分页扩展；资料库实体、收藏、听歌记录和缓存不因“移出播放队列”而删除。这样只改变运行时队列和 playback-state，用户从来源页重新点击仍可建立新队列。是否接受“编辑队列后不再自动接收搜索分页”需用户决定；如坚持保留来源联动，则另需按身份映射改造高亮、回填和分页，不能沿用索引。证据：`ui/features/tracks/track-list-ui.ts:37`、`:47`，`ui/features/playback/playback-core.ts:608`，`ui/features/playback/playback-queue-state.ts:99`。

### playback-state v1/v2

- 前端 `savePlaybackState`：无合集写 v1 的普通视频快照；含合集写 v2，附完整父队列及 traversal。恢复 v2 还原轮次/历史；v1 重新生成随机剩余项，来源统一 restored。打开、关闭、展开抽屉不需要保存；跳转继续用现有成功加载后的保存及 timeupdate 保存，不新增持久化字段或保存定时器。证据：`ui/features/playback/playback-core.ts:178`、`:223`、`:654`、`:1011`。
- Rust 最终按是否仍含合集归一化版本；无合集时去掉 traversal/entryId。因此删掉最后一个合集会回到 v1，重启后不保留原 v2 遍历历史，这是当前格式的既有行为，不应承诺相反。含合集继续 v2；v2 校验成员游标、计数、randomRemaining 的唯一性与范围、history 身份。证据：`src-tauri/src/library/playback_state.rs:115`、`:134`、`:162`、`:215`。
- 首次从磁盘 v1 写 v2，先创建并校验 `.v1.bak.json`，失败保持原文件，不能绕过。删除本身不需要升级格式；空队列经 clear 命令删除恢复文件，不写非法空 v2。保存仍走原子写入。证据：`src-tauri/src/library/playback_state.rs:271`、`src-tauri/src/library/entries.rs:199`。
- **当前恢复文件最多保存前 200 个父项**，并截断/夹紧相关索引；运行时搜索分页没有这个 200 项限制。跳到第 200 项之后再重启可能不能恢复到同一父项。不能把这项既有边界误写成抽屉渲染上限；一期不改持久化，报告和验收需明确。证据：`src-tauri/src/library/playback_state.rs:279`，`ui/features/playback/playback-queue-state.ts:99`。
- 现有保存错误只警告，恢复读取坏状态返回 None；不能在文档中声称失败会自动回滚内存删除。二期须明确保存失败可见反馈及用户重试策略，另行授权，不顺带重写整个持久化。证据：`ui/features/playback/playback-core.ts:206`、`src-tauri/src/library/playback_state.rs:260`。

## 4. 界面、组件和焦点

按 `docs/ui-spec.md:112`：右侧抽屉宽 **360px**，位于标题栏和播放栏之间；头部 **48px**，普通行 **44px**，封面 **32px**，合集分组头 **36px**，子项左缩进 **16px**。表面独立不透明，复用 `--surface`/`--floating-surface` 及主题文字/分隔线；不采样页面背景、不新增图片请求或浮层几何观察器。标题栏与播放栏的现有尺寸变量可直接定位，不覆盖原生缩放热区。证据：`docs/ui-spec.md:102`，`ui/styles/tokens.css:38`、`:43`，`ui/styles.css:36`、`:5320`。

**推荐新建 `QueueDrawer.vue` 与小型 `QueueDrawerRow.vue`，不扩充 TrackRow。** TrackRow 固有多列、收藏/加入歌单/移除歌单、拖拽及分P观察接线；现有 `.track-row` 主样式又限定六个页面列表。硬复用需要大量关闭开关，且容易把“移出队列”接成“从歌单删除”。新行只接稳定显示模型、当前高亮和父项选择回调；复用现有 Icon、缩略图规范化、时长格式化和主题变量。证据：`ui/features/tracks/components/TrackRow.vue:20`、`:34`、`:40`，`ui/features/tracks/track-list-ui.ts:60`，`ui/styles.css:5015`。

`#queue-position` 当前是无回调 span，内容为原计数；应保留 id/class 和计数文本，改成 `type=button`。建议 `aria-label="播放队列"`、`aria-controls="queue-drawer"`、`aria-expanded`；抽屉用具名 `role=dialog`、`aria-modal=false`，保留播放栏可操作。普通项是按钮，当前项 `aria-current=true`；合集分组展开按钮单独提供 `aria-expanded`，只读成员不伪装为可跳转按钮。空队列仍可打开显示空状态。证据：`ui/features/playback/components/PlaybackBar.vue:72`，`ui/features/playback/playback-display-view.ts:16`。

建议焦点/阶段契约：

1. 打开：同步 `hidden=false, is-open=false, aria-hidden=true`；沿既有开关阶段在下一动画帧设 open，随后通过 typed ref 聚焦抽屉标题（tabindex=-1）或关闭按钮，并滚动当前项到可见范围。阶段 RAF 仅用于动画，不替代业务同步 render。现有阶段及测试证据：`ui/app/shell-stages.ts:2`、`:7`，`tests/dom/playback-ui-characterization.dom.ts:66`。
2. 关闭按钮、再次点击入口、Esc 关闭：同步撤去 is-open、设 aria-hidden=true，并把焦点还给入口；transitionend 后 hidden=true。关闭开始即禁止内部控件继续聚焦，保留同一壳节点；减少动态效果时无需等待不存在的 transition。焦点、scroll 和 RAF 由控制器管理，不在 SFC 内操作。
3. 打开期间安装 document 的外部 pointerdown 与 keydown；外部点击排除入口和抽屉节点，保留用户点击目标的焦点，若焦点仍在即将隐藏的抽屉中则返回入口。非模态抽屉不强制 Tab 陷阱；Tab 离开后可继续操作播放栏。Esc 只关闭最上层可交互表面，需与已有音质菜单/资料库/设置互斥或明确优先级，不能同时消费。
4. 关闭/卸载配对移除临时监听并取消阶段回调；快速开关、跳转后再关闭不得把焦点留在 aria-hidden 区域。滚动仅在首次打开或真实播放身份改变且当前行离开可视区时执行；不随进度更新滚动、不在异步快照刷新时抢焦点。

外部关闭/焦点的既有模式可参照 `ui/features/playback/root-playback.ts:56`、`:64`、`:67`、`:85`。所有宿主属性、节点和开关仍由 Vue 写；typed ref 的 contains/focus/scroll 端口要精确登记。抽屉壳保持挂载，沿用 **hidden/is-open/aria-hidden**，不用 v-if/Transition 控制开关。首次打开前可以让行模型为空，不渲染队列内容；“默认不挂载”应准确解释为不挂载行内容/临时监听，不是有按钮却没有固定的受控抽屉壳。

## 5. G0、监听与迷你窗

**隐藏抽屉内容不能保证启动序列完全不变。** Vue 入口按钮的 click 会在首屏安装，即使抽屉从未打开。现有序列由真实挂载后的事件安装/IPC/派发组成并全量比较，不能通过延迟收集或改探针规避。证据：`ui/app/root-mount.ts:48`、`scripts/vite/verify-dist.ts:97`、`tests/dom/playback-startup-installation.dom.ts:21`。

建议的最小监听预算：

| 时机 | 数量/位置 | 处理 |
|---|---|---|
| 启动 | **+1：`#queue-position` click**，在 PlaybackBar.vue 原 span 位置 | 唯一必需的新增启动监听。保留其余节点及源码监听安装顺序。 |
| 打开至关闭阶段 | document pointerdown + keydown 共 2 条；抽屉关闭按钮 click、transitionend 各 1 条；列表委托 click 1 条 | 后三项可由 Vue 使用条件 handler，初始隐藏且未打开时无 handler；document 的两项由控制器安装/移除。快速开关不能累积。行和分组由同一个委托选择回调处理，Enter/Space 使用原生按钮 click。 |
| 内容滚动 | 一期不新增 scroll/ResizeObserver/audio/IPC 监听 | 用固定尺寸布局和 ref 的 scrollIntoView/scrollTo；如未来窗口化渲染再单独列预算。 |

上述 **+1 是提案，不是已测结果**。若实现严格只有这一项且位于首次 trackchange 之前，本地基线候选将为 195/150；最终仍须运行真实探针报告实际条数、首索引与 Git/LF SHA，再逐条核对播放、请求、trackchange、媒体、四项 IPC listen、跨窗同步的受保护投影，申请后才更新 fixture。SHA 在实现前不能预报；不得按预测值重建。G0 审批依据：`AGENTS.md:65`。

音质菜单或更高层浮层出现时建议关闭抽屉，沿用已有同步根投影观察实现互斥，不额外订阅媒体事件。实现前需盘点实际 Vue handler 数量；若 close/transition/行点击在初始隐藏时也安装，就必须如实增加预算，不能仍声称只 +1。现有音质菜单也是打开后才安装全局监听：`ui/features/playback/root-playback.ts:85`。

迷你窗**预期不改**：独立 MiniApp 根及既有跨窗消息不增加抽屉数据、开关状态或命令；主窗跳转后仅按现有通道更新当前歌曲。mini 投影只取当前音轨/播放/收藏/主题字段，没传整队列。证据：`ui/mini/mini-player-projection.ts:5`、`ui/app/root-mount.ts:48`；实施验证仍需断言跨窗 payload 字段及 IPC listen 保持。

## 6. 长队列与纯进度更新

一期建议**先不引入虚拟滚动或“仅当前附近项”裁剪**。搜索可持续分页，运行时没有 200 项硬上限；数百条紧凑行先以原生 overflow、懒加载封面、稳定 key 和显示模型复用承载，合集按需展开，避免默认把全部合集成员铺平。只裁当前附近而不实现完整滚动占位，会使远处条目不可达，不能作为优化。证据：`ui/features/search/search-state.ts:87`，`ui/features/playback/playback-queue-state.ts:99`。现有 DOM 用例有 1000 行及 100 次进度提交不重绘列表的契约，但这不是实际 WebView 性能测量：`tests/dom/playback-tree.dom.ts:78`。

投影仅依赖 queue 父项引用、currentIndex、实际成员/分P身份和本地展开/阶段信息；不把完整 snapshot、playbackDisplay 或时间进度 props 传给 QueueDrawer。纯进度、lastSavedAt 等提交返回同一个抽屉 model/rows/stage/callback 引用，使 Vue 跳过整个组件；高亮变化只替换旧/新行模型，未变行保留引用。现有根以公开 render 同步提交，现有行投影已使用依赖比较及行模型复用，可沿用做法。证据：`ui/app/root-mount.ts:27`、`:48`，`ui/features/playback/root-playback.ts:10`，`ui/features/tracks/track-list-ui.ts:48`、`:98`。

实施验收应记录首次打开、展开大合集、切换当前项、滚动的实际 WebView 耗时/卡顿与节点数，至少合成 500/1000 父项及一个 200 成员合集；本次没有运行性能测量，不能给出毫秒结论。如果出现持续掉帧/明显打开延迟，再加入支持 36/44px 混合行的窗口化、完整高度占位、焦点行保留和 overscan；届时另批授权局部 scroll/resize 监听。不要新增依赖或先写通用虚拟列表。

## 7. 分期、文件清单与授权

### 第一期：展示、父项跳转、当前高亮/自动滚动

不提供删除、清空、排序、收藏操作或任意合集成员跳转。开关/展开不持久化；业务播放继续走现有核心。建议改动位置如下，均为后续清单，本次未修改：

| 文件 | 必要改动 |
|---|---|
| `ui/features/playback/components/PlaybackBar.vue` | queue-position 改为原生按钮，ARIA、稳定 toggle 回调和入口 ref。 |
| 新 `ui/features/playback/components/QueueDrawer.vue`、`QueueDrawerRow.vue` | 紧凑表面、头部、父行、只读成员分组、空状态；只接显示 props/回调/ref，无业务访问。 |
| 新 `ui/features/playback/queue-drawer.ts`、`queue-drawer-view.ts` | 前者控制关闭/焦点/滚动及晚安装播放回调；后者纯投影、依赖缓存与行引用复用。不重复建立 store 或播放队列。 |
| `ui/features/playback/root-playback.ts`、`playback-core.ts` | 稳定 toggle/选择转发，后置接线；导出既有 playQueueIndex。播放算法不改，但仍属于受保护链路的接入，需要明确授权范围。 |
| `ui/app/root-mount.ts`、`ui/app/components/App.vue`、`AppShell.vue` | 同步根传稳定 drawer model/回调，在主窗外壳接入独立组件；不传全快照给 drawer。 |
| `ui/app/shell-stages.ts` | 增加与已有 ModalStage 同形的本地 queue 阶段，保留同步 refreshPresentation。 |
| `ui/platform/main-window-refs.ts` | 按现有 typed ref 模式登记入口、壳、标题及滚动/当前行节点，控制器只做读取、focus/scroll。 |
| `ui/styles.css` | 仅 queue-drawer 作用域及入口按钮样式，复用现有 token；不动共用 TrackRow/列宽。 |
| `scripts/typecheck/tsconfig.main.json`、`tsconfig.node.json`；`scripts/tests/groups.ts` | 精确登记新增 TS/DOM 测试，不让 DOM 测试被默认 node --test 重复发现。证据：`scripts/typecheck/tsconfig.main.json:8`、`scripts/typecheck/tsconfig.node.json:16`、`scripts/tests/groups.ts:6`。 |
| `scripts/vue/check.ts`、`scripts/vue/native-writes.ts` | 新 SFC 使用的 Vue API 按需精确登记；新 focus/scroll 端口按实际完整表达式登记并配反例，不能放宽白名单。证据：`scripts/vue/check.ts:11`、`:44`。 |
| `tests/fixtures/playback-startup-installation.json`、`tests/fixtures/playback-ui-baseline.json` | **审批后才改** G0 和 result 内 span→button 的结构投影。完整 result 结构当前受精确比较保护，不能删除断言绕过。证据：`tests/dom/playback-ui-characterization.dom.ts:8`、`:12`。 |
| `tests/helpers/playback-root-fixture.ts` 及直接构造 PlaybackCallbacks 的测试 fixture | 仅补稳定回调/ref/真实 App 挂载接线，实施时检索所有调用方，保留原断言内容和执行次数。证据：`tests/helpers/playback-root-fixture.ts:7`。 |
| `docs/frontend-architecture.md`、`docs/where-to-change.md`、本方案；`AGENTS.md` 当前 G0 句 | 随实现登记入口、端口和批准后的 G0，不改历史记录。 |

一期不需要改 `playback-queue-state.ts`、Rust、IPC 合同或 mini 源码。若实作发现确需增加状态分支、改变默认跳转语义或扩大授权文件，先说明具体原因。

新增测试建议：

- 新 `tests/queue-drawer-view.test.ts`：空/普通/混排、重复 BV 但 entryId 不同、父索引与子行不混淆；纯进度返回相同 model/row 引用，高亮仅旧/新行更新；本地展开不改变业务快照。
- 新 `tests/dom/queue-drawer.dom.ts`：挂载真实 App；入口键盘点击、ARIA、打开/关闭阶段、Esc/外部点击/焦点返回、快速重开和减少动画；当前行滚动只在需要时发生，关闭后不能聚焦内部；浮层互斥、空队列。
- 同一 DOM 文件或新 `tests/dom/queue-drawer-playback.dom.ts`：父 N 跳转只使用真实 core；queueSource/playlistId/version/队列内容不被替换；顺序/随机/各循环模式、history 返回与 remaining 不补回；recent 分P提示；合集重入冻结、历史恢复、全禁用分P、连续快速点击导致旧请求迟到。仅 mock IPC/媒体边界，不访问业务服务。
- 500/1000 行纯进度 100 次：抽屉/列表/行渲染计数及滚动次数为 0；当前变化仅相关行更新；展开 200 成员合集保持父项总数不变；没有新增分P观察或网络调用。
- 增补真实启动验证：默认行未构造、临时监听未安装、只新增获批入口监听；反复开关后监听配对；audio 身份及媒体监听、四项 IPC、mini payload/跨窗同步逐项保持。已有 `tests/dom/playback-startup-installation.dom.ts`、`playback-tree.dom.ts` 等原断言保留。

需单项授权：①受保护播放入口导出/接线（不改状态机分支）；②`#queue-position` 新监听及 G0 重建；③冻结 result 结构从 span 到 button 的最小差异；④新增焦点/滚动原生端口及精确守卫登记。真实 App 挂载、SFC 扫描及 frozen helper 的纯环境接线在长期规则中预授权，但不能借此改业务预期。依据：`AGENTS.md:64`、`:65`。本方案不构成这些后续修改的授权。

### 第二期：队列结构编辑

建议拆为“非当前父项移除”与“当前项移除/清空”两个小批，整合集父项与普通父项使用同一索引事务；不做合集成员剔除。具体影响：

| 文件 | 后续范围 |
|---|---|
| `ui/features/playback/playback-queue-state.ts` | 专用父项移除/清空 action，同步重排 currentIndex/randomRemaining/history；保持其他合集冻结游标不变。 |
| `ui/features/playback/playback-core.ts`、`queue-drawer.ts`、`root-playback.ts` | 当前请求/恢复协调、选择后继、停止/重新加载/空状态、保存及错误反馈；处理解析中捕获旧 index 的竞态。 |
| `ui/features/playback/queue-drawer-view.ts`、`components/QueueDrawer.vue`、`QueueDrawerRow.vue`、`ui/styles.css` | 删除/清空按钮、忙态与可访问提示；删除后焦点移到相邻项或头部。若需要确认，复用现有组件流程，不用原生 prompt/confirm。 |
| `ui/features/tracks/track-list-ui.ts`、`playback-core.ts` 的搜索回填；`ui/features/search/search.ts`、`ui/features/collections/collection-controller.ts` | 采用 direct 脱离策略时主要验证原来源高亮消失、分页不再改队列；如决定保留来源联动，这些位置需身份映射改造，另行授权。 |
| `tests/queue-drawer-view.test.ts`、`tests/playback-queue-actions.test.ts`、`tests/collection-playback-queue.test.ts`、`tests/dom/queue-drawer-playback.dom.ts` | 新增而非替换原断言：删前/后/当前/末项、重复 BV、父/子索引、随机栈和历史重排、来源脱离、快速删除、解析/恢复迟到、清空后旧音频事件无效。 |
| `src-tauri/src/library/playback_state.rs` 的测试区；必要时 `entries.rs`/`backup.rs` 的测试区 | **Rust 测试文件修改也先单项授权**。补删除后 v1/v2 往返、最后合集降回 v1、空文件清除、首次升级备份失败原文件不变、200项截断与重排身份校验。优先验证既有存储函数，无需改序列化格式/生产 Rust。 |
| `scripts/tests/groups.ts`、`scripts/typecheck/tsconfig.node.json`、上述文档/端口守卫 | 仅新增测试及新增端口所需登记；G0 若因按钮初始挂载产生变化，另申请预算与 fixture 更新。 |

二期需单独批准状态机/请求失效与后继规则、结构编辑后的来源策略、持久化错误交互；若改变存储格式、生产 Rust 或冻结预期，再逐项申请。非当前项删除也不能冒充普通组件调整来免除风险点验证。

### 后续实施验收

按功能分支规则实施并验证；日常跑受影响的真实 actions/DOM 测试、typecheck、每批 verify:dist；合并前按 AGENTS 顺序全量 node --test → npm ci → test:dom → typecheck → verify:dist。只在改 Rust 时加 Cargo 检查；竞态变异只覆盖新写的风险点，每处 1–2 个，合规仓库外副本执行。纯文档本次不要求用户手测；功能实现后 Windows 手测建议 6 项：①布局/主题/最小窗口；②键盘/焦点/开关；③各来源与新搜索分页隔离；④随机跳转与上一首；⑤合集重入/成员高亮；⑥长队列滚动及迷你窗同步。未实现前不能写通过。

## 待用户决定（推荐值）

1. 一期范围：推荐只读列表、父项跳转、高亮/自动滚动；合集子项只读，当前父项点击不重播；删除/清空及任意成员跳转延期。
2. UI 与监听：推荐新紧凑组件、非模态抽屉、queue-position 原生按钮；接受实施时申请最少 1 条新增启动监听及冻结结构变更，其他监听仅在打开阶段存在。
3. 性能：推荐先稳定全父项渲染、合集按需展开，以实际 WebView 测量决定是否窗口化，不预加库；明确运行时长队列与恢复最多200父项是两件事。
4. 二期删除后来源：推荐首次结构编辑即脱离为 direct，不再接受原来源分页，也不删除收藏/歌单实体；当前项删除的后继/停止策略须另批确认。
