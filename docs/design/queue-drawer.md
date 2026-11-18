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

## 第一期实现记录（Q-3b，2026-11-08）

本节以 Q-3b 批准行为为准，前面的 Q-3a 方案为调研历史。实现基线 origin/master 为6008f1e107da72bd514389223ab4be876c4342a9；功能分支 feat/queue-drawer 从该提交创建，初始 HEAD 相等，同名远程分支不存在。主工作区已有版本改动保持；实现使用仓库外独立 worktree。

### 基线漂移复核

94ef03b..6008f1e 的提交为1b1c085（进度条结束修复）、2d39770（对应合并）、6008f1e（队列方案）。变更文件为 AGENTS.md、docs/frontend-architecture.md、docs/design/queue-drawer.md、tests/dom/mini-host-loading.dom.ts、tests/dom/playback-ui-characterization.dom.ts、tests/dom/startup-classic-characterization.dom.ts、tests/fixtures/playback-startup-installation.json、ui/features/immersive/components/ImmersivePlayer.vue、ui/features/playback/components/PlaybackBar.vue。

| 方案引用点 | 基线复核结论 |
|---|---|
| playQueueIndex / playListItem / playNext | playback-core.ts 相对94ef03b未改；本批仍只导出playQueueIndex，不改实现 |
| PlaybackBar #queue-position | 仍为原span；变化仅在进度条的pointerup/pointercancel/lostpointercapture与change条件 |
| AppShell / root-playback / shell-stages / dynamic-background浮层清单 | 相对94ef03b均未改，无行为方案失效项 |
| G0启动序列 | 两个滑条合计新增6条监听，200/155；旧方案194/149数字不用于本批验收 |

### 批准行为与调研建议的差异

- 空队列入口禁用；取消“空列表也可打开”的原建议。只允许入口、关闭按钮、Esc三种关闭，不做外部点击关闭。
- 合集重入不新增说明文案；当前父项点击无动作，子项只读。展开状态在QueueDrawerRow的本地ref中，当前项默认展开，其他默认收起。
- 抽屉阶段采用shell-stages同形的本地hidden/open + refreshPresentation模式，放在queue-drawer控制器中，不新增业务store。关闭按钮与transition handler初始不安装；RAF只管理开关动画。
- 按批准要求复用FloatingBackdrop，在image/dynamic且open时挂载；几何清单新增queue。复用ResizeObserver，不新增启动observer或scroll监听。
- app/main.ts后置安装稳定父项选择回调。QueueDrawer及行组件不访问store/actions/invoke/window；新增四个typed ref只做读取、focus、事件目标核验和scrollIntoView。没有新增原生显示写入，native-writes.ts及其白名单未改。

### G0与冻结结构登记

| 基线 | 条数 / 首个trackchange dispatch索引（0起始） | Git/LF SHA256 |
|---|---|---|
| 本批旧基线 | 200 / 155 | 0b46fab6237fd126936164332e3db46cdd04b0f2f1fbcab9f92cac50acaae395 |
| 本批新基线 | 201 / 156 | 2e998e7063032bddf8fcc4e515889fb1c84b166a918684228c9e8deed46720ab |

新增记录严格只有{action:listen,target:#queue-position,type:click,options:null}，来源PlaybackBar.vue的入口button。去掉这一条后，真实启动探针的旧新事件序列逐条完全相同；另以completeStartup + recordIpc逐条对比，媒体、请求、trackchange、四项IPC监听和跨窗消息均保持。旧fixture存档在仓库外任务报告目录old-g0.json，未覆盖旧档。

| 展示冻结/环境登记 | 最小变化；原业务断言保持 |
|---|---|
| playback-ui-baseline.json 的 queue-position 节点 | tag span→button；增加type=button、aria-label=播放队列、aria-controls=queue-drawer、aria-expanded=false、disabled空属性；class/id/♪0/0及其他完整结构相同，另用结构对照脚本验证 |
| mini-host-loading.dom.ts | 仅序列数量200→201及首次索引155→156 |
| startup-classic-characterization.dom.ts | 仅首次索引155→156 |
| real-module-startup.dom.ts / module-graph.test.ts | 仅模块数量70→72、文件集合登记新增queue-drawer.ts与queue-drawer-view.ts |
| vue-toolchain.test.ts / groups.ts / tsconfig | 精确登记queue-drawer.dom.ts和投影测试；分组反例环境补同名空文件，不改变反例断言 |
| tracks-fixture.ts | 新增显式选择queueCounters，默认旧计数路径不变；为新测试暴露既有core方法，记录removeEventListener和真实组件render；旧断言/预期不改 |

冻结展示fixture新Git/LF SHA256为c7f1a25c7e6d22b4c83ab33a6b04c83ccb61dae8d510b37c8e588aeddfc22475；环境helper新Git/LF SHA256为6d8407bb8b42ae8b8bf97cd77b4a14ed68fbeac00c08e9d03f560158bac6dcc4。完整SHA与结构对照结果保存在仓库外verification.json。

### 实测与验证

隔离Edge headless专用profile、1100×760、真实App根与组件、纯合成数据，未启动Tauri或访问业务服务。安装耗时包括向真实store装入队列并完成同步渲染；打开/展开/滚动耗时包括等待两帧，受调度影响，不是纯CPU耗时，也不设门槛。

| 场景 | 装入队列ms | 打开ms | 展开ms | 滚动ms |
|---|---:|---:|---:|---:|
| 500 parents | 20.7 | 32.2 | — | 26.4 |
| 1000 parents | 18.5 | 45.4 | — | 29.7 |
| 50 collection members | 5.4 | 3.2 | 33.2 | 33.1 |

真实App测试：入口/ARIA/开关阶段/三种关闭/焦点返回/模态Esc隔离；顺序父项、随机remaining与history及上一首、当前项无请求、连续跳转的迟到结果隔离；合集冻结与只读成员/本地展开；搜索分页追加、recent CID提示；reduced-motion及image浮层卸载；1000行下100次纯进度抽屉/行render=0，currentIndex切换仅2行render。

按顺序全量node --test（535通过，0跳过）→npm ci→test:dom（429通过，0跳过）→typecheck（各项目0诊断）→verify:dist（G0、windows/darwin六文件逐字节一致、AST 0/0）均通过。本机仅有Node24.21.0，.nvmrc为22.23.3；Node22结果以分支CI为准。本批未改Rust、IPC合同或mini源码，不跑本地Cargo。

仓库外独立副本执行两处变异：①移除prepare_audio结果的当前请求核验，迟到播放结果测试失败；②移除抽屉close中的Esc解绑，监听配对测试失败。两处均恢复原字节，副本git status干净；未改业务断言以适配变异。原始日志、性能数字、截图和存档随仓库外报告保留。

### 第一期审核修正（Q-3b-fix，2026-11-15）

在已推送的bca8e61上追加提交，保留原提交历史。本批仅修改抽屉控制器、两个抽屉组件及其DOM测试，不改playback-core.ts、队列状态、Rust或迷你窗。

- Esc在沉浸页尚未hidden（包括关闭过渡）或播放栏音质菜单非空时直接返回，不取消默认行为、不阻断传播；原设置/资料库/分P守卫保持。沉浸页和音质菜单沿用各自控制器的Esc与焦点返回，随后一次Esc才关闭抽屉。
- stage.hidden时不挂载行；壳、头部、列表与四个ref继续常驻。关闭动画期间保留行，到自身transform的transitionend后移除；减少动态效果时立即移除。显示模型与投影缓存未改。行组件卸载也会重置其本地展开状态，再打开按原默认值展开当前合集。
- 打开RAF完成时仅用一次block:center；打开期间当前父项或合集成员变化用block:nearest，prefers-reduced-motion的auto/smooth规则保持。
- historyTrack优先按bvid匹配冻结成员；匹配则只高亮已有成员，缺失才追加只读当前行。不改冻结成员与历史业务状态。

| queue-drawer.dom.ts测试登记 | 本批变化 |
|---|---|
| 原开关/焦点/监听配对、随机历史与迟到结果、合集冻结、来源、reduced-motion断言 | 原文与预期全部保留；跳转测试增加nearest断言 |
| 原100次进度零重绘、currentIndex仅两行重绘 | 原断言全部保留；增加隐藏装入1000项零行render/零DOM行、打开1000行、关闭过渡前保留/结束移除、selectIndex后nearest断言 |
| 新增沉浸页Esc测试 | 原控制器收到Esc并返回沉浸入口焦点；关闭过渡仍不拦截；隐藏后Esc关闭抽屉并返回队列入口 |
| 新增音质菜单Esc测试 | 首次仅关菜单并返回音质按钮焦点；再次关抽屉并返回队列入口 |
| 新增两条historyTrack测试 | BV存在时3行且高亮原成员；不存在时4行且只高亮追加行 |

没有修改或移除已有断言；本批只在原Q-3b新增的queue-drawer.dom.ts中增加断言/测试，未改公共helper、冻结fixture与常量登记。新测试在产品修改前已复现隐藏行渲染、Esc冲突和重复历史成员问题，修正后10条抽屉测试全部通过。

实测使用同一台机器的隔离headless Edge、1100×760、真实App根/同步store与组件、合成普通父项；修改前取bca8e61的干净detached worktree，修改后取本批实现。每个规模5次新页面导航取中位数；隐藏替换仅计replaceQueue同步调用，打开计入口点击至两次RAF结束，包含调度等待，不设门槛。

| 父项数 | 隐藏替换：修改前ms | 隐藏替换：修改后ms | 打开：修改前ms | 打开：修改后ms |
|---|---:|---:|---:|---:|
| 500 | 13.6 | 1.2 | 26.5 | 39.2 |
| 1000 | 22.5 | 1.0 | 48.6 | 78.3 |

修改前隐藏DOM中分别有500/1000行；修改后均为0，打开后恢复对应全部行。延后挂载减少隐藏替换开销，同时把行挂载成本移到打开阶段；首次打开变慢属实测取舍，不声明整体速度提升。浏览器profile与干净基线worktree已清理；原始5次数字和测量脚本保留在仓库外F:/学习资料/前后端项目/BIlibili_music-reports/Q-3b/。

本批顺序全量node --test（535通过、0跳过）→npm ci→test:dom（433通过、0跳过）→typecheck（main/mini/node/SFC均0诊断）→verify:dist全部通过。真实产物探针仍为201条/首个trackchange索引156，与原fixture逐条一致；Git/LF SHA256仍为2e998e7063032bddf8fcc4e515889fb1c84b166a918684228c9e8deed46720ab，fixture未改，无新增启动监听。双平台六文件字节一致，AST直接eval/new Function为0/0。本机仍为Node24.21.0，Node22与远程CI结果另见仓库外报告；未启动Tauri，未执行Rust检查。

## 第二期方案：队列编辑（Q-4a，2026-11-15）

调研基线为origin/master `48a1a0b4ba1f76615d2f91315f68756d62a8c988`，本地master相等，写入前再次fetch未漂移。以下“现有”均指该提交的代码/测试；“建议”是待批准的实现选择，不代表已实现或已获得功能授权。第一期审核修正是本节前提：隐藏时不挂载行（`ui/features/playback/components/QueueDrawer.vue:14–17`），Esc让位于沉浸页/音质菜单及原模态（`ui/features/playback/queue-drawer.ts:19–23`），仅打开居中、后续就近滚动（同文件`:40–47`）。前面Q-3a对二期的泛化讨论为历史，本节细化为“下一首播放”和“非当前父项移出”；当前项移除/清空另批。

### A. 索引事务

#### 1. 插入、移除必须同步维护的清单

设编辑位置为p，旧父索引i的映射为：插入时i<p保持、i≥p加1；删除时i=p丢弃、i>p减1，其余保持，未选择的-1保持。**先按旧索引生成一次映射，再同时变换所有引用**，不能边splice边调整历史。建议本期只插入普通父项、移除非当前父项，保证旧当前父条目及实际BV/分P不变。

| 状态 | 同一事务内的处理及边界 | 现有证据 |
|---|---|---|
| queue、currentIndex | 新queue数组；存量entry保持引用，currentIndex按映射指向同一父条目。不得复用replaceQueue，它会把currentIndex置-1并清空history | `ui/features/playback/playback-queue-state.ts:8–19,34–35,60–65`；`tests/playback-queue-actions.test.ts:12–18` |
| randomRemaining | 映射存活父索引、删除被移出项，保持既有栈顺序和已消耗状态；随机插入的新索引放栈尾。不能resetRandom补回旧项；非随机不为新项创建随机候选 | `ui/features/playback/playback-queue-state.ts:98–112,137–138`；`tests/dom/queue-drawer.dom.ts:50–56` |
| history | 对每条记录重排index；删除目标父项的全部记录，包括pageLevel记录。保留存活记录的cid、pageLevel、entryId、bvid及track快照和原顺序，不能只按BV删（独立视频与合集成员可能同BV） | `ui/features/playback/playback-queue-state.ts:63–65,121–131`；`tests/collection-playback-queue.test.ts:66–80` |
| 各合集冻结状态 | 存活父项的data/snapshot、memberIndex、remaining、playedCount、unitCharged、chargedUnits、historyTrack整体随父项保留，**成员索引不按父索引重排**。删除合集即丢弃其完整冻结对象及所属历史；不是删除其中同BV的独立父项 | `ui/features/playback/playback-queue-state.ts:27–40,70–85,158–169`；`tests/collection-playback-queue.test.ts:86–108` |
| 当前分P与展示 | 当前父项身份未变时，currentPageIndex、currentDisplayTrack、randomPageRound、collectionNeedsRefresh均保持；不调用selectIndex/resetPage/freezeCollection。currentDisplayTrack是分P展示快照，不含父索引；不能误清导致播放栏退回父标题 | `ui/features/playback/playback-queue-state.ts:11–13,74,88–96,177`；`ui/features/playback/playback-core.ts:37–61` |
| 来源与策略 | 建议首次结构编辑同时设置queueSource=direct、queueSearchVersion=null、playlistId=null；保留loopMode/shuffle，不改展示搜索、收藏、歌单实体 | `ui/features/playback/playback-queue-state.ts:9–13,60–61,99–102`；来源后果见第4项 |
| 其他切片/副作用 | currentPages、pendingResume、resumeInProgress、播放位置、恢复次数、播放记录/缓存/响度标记、requestVersion/activeAudio身份、playbackDisplay及音频元素均保留。实际曲目不变不发trackchange；根投影自动更新计数/高亮，事务后保存一次。新空队列播放则走既有播放入口，属于另外的启动路径 | `ui/features/playback/playback-session-state.ts:3–20`；`ui/features/playback/playback-request-state.ts:3–15`；`ui/features/playback/playback-core.ts:132–147,178–208,811–857` |

历史身份不是装饰：v2保存会按history.index找父项，再核验entryId及成员BV/历史track；漏改索引可能保存失败，也可能在重复BV时指向错误出现位置。证据：`src-tauri/src/library/playback_state.rs:180–207`。运行时纯视频history允许只有index/cid，后来插入普通视频不应凭空伪造合集身份；已有混合队列则必须保留全部身份字段。

#### 2. 跨await父索引审计与最小防护

检索了ui中的currentIndex、队列读写、playQueueIndex、fillTrackMetadata/fillSearchMetadata及相关异步回调。**直接捕获当前队列父索引再跨await使用的主位置只有loadCurrentTrack中的index**；分P/合集内部索引、展示列表索引与存盘字段不是同一种索引。该函数各等待阶段不能只看最终prepare_audio一次：

| 等待/回填位置 | 结构编辑而requestVersion不变时的后果 | 建议 |
|---|---|---|
| index在505捕获；521读取entry后，525等待合集解析（内部还可能等待资料库快照保存） | 后续freezeCollection按**实时当前项**工作；只要编辑保持当前父项就不会冻结错父项，但末尾旧index仍会失效。解析前捕获的资料库reference还可能在编辑转direct后完成一次已发起的快照更新 | `ui/features/playback/playback-core.ts:505–529`；`ui/features/collections/collection-state.ts:35–46`。保持当前父项不变，版本检查继续保留；明确允许已发起的原资料库快照刷新完成，direct只切断后续新请求的来源关联，不承诺撤销已发出的写入 |
| 534等待loadPagesForCurrentVideo；其内部100网络、112磁盘缓存等待 | 只校验requestVersion，随后写currentPages/currentPageIndex；若未来允许删除当前项，旧分P会落到新曲目。限定为非当前编辑时，当前实际BV不变，分P结果仍属于它 | `ui/features/playback/playback-core.ts:97–129,533–564`；`tests/dom/recent-plays.dom.ts:76`已有迟到缓存隔离用例。保留现有版本守卫，新增编辑中请求测试；不能由队列事务切换当前项 |
| 570等待旧recovery；573等待prepare_audio；602/612使用旧index | 例：原当前B位于1，删除其前A后B变0；解析完成仍fillTrackMetadata(1)，会写到后继C。仅转direct不能修复队列回填；仅有requestVersion检查也不能发现索引移动。搜索回填若保留旧版本，还可能写错展示结果 | `ui/features/playback/playback-core.ts:566–617`；`ui/features/playback/playback-queue-state.ts:178–179`；`ui/features/search/search-state.ts:115–118`。批准后改为“校验当前请求所属父条目/实际成员身份，再取其**现位置**回填”；本期当前父项不变，可用已通过版本检查的实时currentIndex，辅以父身份/BV/分P核对，不能用findIndex(bvid)区分重复出现。direct清空queueSearchVersion后跳过搜索回填；保留来源方案则另按展示BV/来源版本映射 |
| 635等待音频metadata；657等待play；catch/finally | 此时旧index不再回填，但会恢复位置、更新状态、保存实时队列，失败还可能按实时当前项推进。未来删除当前项必须使旧请求失效，不能只修602 | `ui/features/playback/playback-core.ts:634–720`。本期维持当前身份及requestVersion；后续当前项编辑另批覆盖全部等待阶段及失败推进 |

相关异步链也逐项核对：recoverCurrentAudio保存video/page/version/sourceUrl，不保存父index（`ui/features/playback/playback-core.ts:350–398`）；响度查询/分析保存BV/CID/版本，缓存与播放记录提交实际身份（同文件`:441–493,1019–1063`）；restorePlaybackState是await后读取持久化state.currentIndex，且先检查运行队列仍为空（同文件`:223–254`）；resumePendingPlayback保存恢复参数再等待loadCurrentTrack（同文件`:724–740`）。这些不是第二个“捕获旧父索引”的位置，但必须在编辑测试中证明没有被重启、丢恢复参数或误计次数。搜索/合集分页await后按来源版本追加，需由direct原子脱离阻断（`ui/features/search/search-state.ts:87–106`；`ui/features/collections/collection-state.ts:79–90`）。分P模态保存video和展示行onPlay回调，TrackRow会话回读展示index，不把它当队列index（`ui/features/pages/video-pages.ts:215–242`；`ui/features/tracks/track-list-ui.ts:60,87–88`），不因队列结构编辑改其播放语义。

“每次编辑都使在途请求失效”是备选，风险更高：现有beginRequest后activeAudioVersion即不匹配；若只加版本不重新协调音频，ended会被拒绝，若取消重载则会中断当前音频/恢复流程。证据：`ui/features/playback/playback-request-state.ts:9–15`；`ui/features/playback/playback-core.ts:162–169`；`ui/app/main.ts:49–59`。推荐本期修身份回填并保持当前播放，不用全队列编辑触发取消；不能以此绕过未来当前项删除的失效授权。

#### 3. 纯事务与action边界

可行：在`playback-queue-state.ts`内部增加纯编辑函数，输入旧PlaybackQueueSnapshot与明确操作，输出新快照；按一次旧→新索引映射生成queue/currentIndex/randomRemaining/history/来源，其余字段结构共享。随机“下一首”无需在事务中调用Math.random，现有随机顺序保持，新索引确定性压尾；不接DOM、时钟、invoke或任意patch对象。领域action建议`insertNextVideo`、后批`removeNonCurrentEntry`，每个action仅commit完整结果一次；控制器负责空队列启动、身份核对、保存、提示与焦点。现有工厂接入会自动暴露新增action，不需另建store：`ui/store/app-state.ts:212,229`；同步提交/其他切片共享的既有测试为`tests/playback-queue-actions.test.ts:54–58`。

这不是替换next/previous/随机/失败状态机，但**新增结构编辑能力本身触及既有禁止改队列规则**；需单项批准插入/删除事务、randomRemaining和history映射、direct脱离、元数据身份回填及保存触发，不能归为普通UI调整。`AGENTS.md:28–31,64–66`是授权依据。最小实现分两批：第一批只落插入操作及其消费者，第二批扩展同一事务加入移除，避免先交付无入口的删除action。

### B. 来源身份

#### 4. direct的确切含义及脱离后的表现

direct是replaceQueue的默认来源，不是“只能播放粘贴BV”的类型；setQueue和未命中现有队列的playBvId会使用它。命中已有普通BV时playBvId直接跳现队列，**不改原来源**。证据：`ui/features/playback/playback-queue-state.ts:60–61`；`ui/features/playback/playback-core.ts:260–271,743–761`；`tests/playback-queue-characterization.test.ts:75–82`。当前没有结构编辑即转direct的action；下表是新增事务同时设置direct/null/null后的推导。

| 调用方 | 编辑后的表现；是否用户可感知 | 证据 |
|---|---|---|
| 首页榜单/推荐 | 来源不再匹配，当前行高亮消失；播放栏和抽屉仍高亮真实当前父项，可感知 | `ui/features/tracks/track-list-ui.ts:37–47`；`ui/features/playback/queue-drawer-view.ts:10–15` |
| 搜索结果 | 当前实现高亮**只比较queueSearchVersion，不额外判断queueSource**；必须清空版本才可靠脱离。清空后结果列表不再显示当前行，可感知 | `ui/features/tracks/track-list-ui.ts:39–40`；既有来源测试`tests/dom/playback-tree.dom.ts:56–68` |
| 合集详情普通视频列表 | collection来源和版本不匹配，高亮消失；新分页仍扩展示列表，但不再扩播放队列。这里的collection来源列表不同于冻结的合集父条目 | `ui/features/tracks/track-list-ui.ts:37–38`；`ui/features/collections/collection-controller.ts:38–48` |
| 搜索分页与搜索元数据 | 新页继续展示，却不再appendSearchQueue；已经在途的分页回调也会被来源检查拒绝。queueSearchVersion=null使播放器不再把解析元数据回写搜索列表，结果中已有展示数据保留；标题/时长不再随解析修正可感知 | `ui/features/playback/playback-queue-state.ts:99–102`；`ui/features/playback/playback-core.ts:275–287,599–617`；`ui/features/search/search-state.ts:38–52` |
| 最近播放 | 来源门槛使最近页当前行高亮消失，时间/缓存标志仍来自recent切片；后续loadCurrentTrack不再默认套recentPage(lastCid/lastPage)，可能改从默认启用分P开始，**可感知且需明确接受**。当前已在播分P及pendingResume不清；显式历史cid/恢复参数仍走原入口 | `ui/features/tracks/track-list-ui.ts:41,47`；`ui/features/playback/playback-core.ts:501,554–559,724–734,850–856`；`ui/features/recent/recent-state.ts:28–30`；`tests/dom/queue-drawer.dom.ts:140–151` |
| 收藏/歌单entryId高亮 | entryId不从queue/history删除，但来源先被拒绝，资料库高亮消失；不按BV误高亮同BV独立视频。重新点击来源列表会按playListItem重建那个来源队列，放弃临时编辑，可感知。合集未来新入场时不再带资料库reference更新来源快照；已发起的刷新见第2项 | `ui/features/tracks/track-list-ui.ts:42–47`；`ui/features/playback/playback-core.ts:523–524,785–808`；`tests/dom/collection-playback.dom.ts:49–68` |
| 保存与恢复 | 存储没有queueSource/queueSearchVersion/playlistId字段，direct不会作为新格式写盘；恢复统一为restored，原来源关联本就不恢复。当前BV/成员/分P恢复仍依赖现有v1/v2字段及200项限制，可感知边界见第11项 | `src-tauri/src/library/playback_state.rs:83–92`；`ui/features/playback/playback-core.ts:191–205,237–253`；`ui/features/playback/playback-queue-state.ts:87` |

不能调用replaceQueue来“顺便转direct”，否则会丢历史/当前选择；也不能只改queueSource却保留搜索版本，导致错误高亮和元数据回填。当前来源资料库被外部编辑不会反向改播放队列，已有隔离测试保持：`tests/playback-queue-characterization.test.ts:85–90`。

#### 5. 保留来源并按身份映射的替代

| 方案 | 工作量/风险比较 | 建议 |
|---|---|---|
| 首次结构编辑整体direct脱离 | 中等：纯重排事务、当前请求回填修正、来源变更回归；不改来源列表/存储协议。代价是第4项高亮与recent分P行为变化 | 推荐第一批，用户先明确接受这些代价 |
| 保留原来源，队列/展示分开按身份映射 | 高：搜索/首页高亮不能再用父index，资料库需entryId与队列出现位置，重复BV需明确高亮规则；分页还需决定是否继续扩队列、避免手动插入与新页重复；搜索回填按展示BV/版本找位置，recent按条目记录提示 | 若要求编辑后来源体验保持，再独立立项；不是只保留queueSource字段即可 |
| 每个父项携带来源与起播提示 | 最高：混合来源、重复出现和重启后身份需要新的表示；若写进CommandContract/持久化需另审Rust/IPC与版本兼容 | 不在本期引入 |

比较依据是现有高亮位置规则、分页准入和recent单一来源默认值（`ui/features/tracks/track-list-ui.ts:37–47`；`ui/features/playback/playback-queue-state.ts:99–102`；`ui/features/playback/playback-core.ts:501,609–617`），不是已有“混合来源队列”能力。

### C. 下一首播放

#### 6. 建议语义与现有推进顺序

“下一首”建议定义为**下一个父条目**，保留分P与合集推进，不保证下一段音频立刻就是新增视频。正常下一首命令先advance，ended也先advancePageWithinCurrentBv，再进入playNext；playNext自身对合集先advanceCollection([])，相当于先试下一成员、不会在这里遍历当前成员分P。证据：`ui/features/playback/playback-commands.ts:42–48`；`ui/app/main.ts:49–59`；`ui/features/playback/playback-core.ts:862–879,894–918`。不能把“playNext本身先分P”写成现有行为。

| 决策 | 推荐与理由；需要改变的范围 | 证据 |
|---|---|---|
| 插入位置/连续添加 | 每次紧跟当前父项，后加先播：当前A，先加B再加C得到A,C,B；不新增“上次添加尾部”游标。若选先加先播，必须同时维护待播段及随机栈顺序，不能只改插入位置 | 顺序下个父项为currentIndex+1；随机取栈尾：`ui/features/playback/playback-queue-state.ts:105–118` |
| 当前是合集 | 等当前合集本轮推进结束再到新增父项；顺序模式会继续启用分P/成员，随机模式可能达到既有音频配额提前离开，不能承诺所有成员总会播完。仅插父项即可保留此规则。若要求打断合集，须在next/ended选择前新增优先级分支并决定冻结游标/计次/重入，另行授权 | `ui/features/playback/playback-queue-state.ts:158–169`；`tests/collection-playback-queue.test.ts:18–38`；`tests/dom/collection-playback.dom.ts:30–45` |
| 随机模式 | 映射旧栈后，把新父索引压尾即可保证**下次选择父项**时取它；不重洗、不补回消耗项。历史只在实际跳转时由原playQueueIndex记录，加入动作本身不造history；上一首不把已消耗新项补回。若选连续添加FIFO，新索引需插在已有优先待播段之前的栈位置，单纯压尾不成立 | `ui/features/playback/playback-queue-state.ts:104–112,121–138`；`ui/features/playback/playback-core.ts:834–850,922–931`；`tests/dom/queue-drawer.dom.ts:50–56` |
| 单曲/列表循环 | 不切换loopMode。自动单曲继续重播当前分P，新增项等手动推进或退出单曲；手动正常下一首仍先分P/成员。列表循环照常到尾回绕；随机轮次保持原耗尽规则。若要求新增项越过自动单曲，属于新增状态机优先级，不推荐本批做 | `ui/features/playback/playback-core.ts:862–879`；`ui/features/playback/playback-queue-state.ts:105–119`；`tests/playback-queue-actions.test.ts:45–51` |
| 同一BV已在队列 | 允许普通视频重复出现，不移动旧项，不删除/跳过当前项，也不从合集抽成员；新增的是独立父出现位置。比移动少一套删除与历史语义。重排按旧索引/出现位置，元数据核对当前请求，不能按BV查到第一个就回填 | queue为数组且normalizeQueueEntry无去重，抽屉key含index：`ui/features/playback/playback-queue-state.ts:34–35,60–61`；`ui/features/playback/components/QueueDrawer.vue:17`。来源搜索去重只作用于展示追加：`ui/features/search/search-state.ts:38–44` |
| 空队列/无当前 | 推荐立即开始播放，避免“下一首”永不启动；空队列复用playListItem(direct,[video],0)。若存在非空但currentIndex=-1的队列，前插新项后用既有playQueueIndex(0,{recordCurrent:false})，保留其他条目，不以替换整队列丢数据 | 既有空选择无法next：`ui/features/playback/playback-queue-state.ts:116`；播放入口`ui/features/playback/playback-core.ts:775–808,811–857` |
| 合集能否作为父项插入 | 数据上可用libraryQueueEntries形成完整冻结输入，真正入场时再按现有规则刷新/冻结；但第一批只支持普通视频，合集行不出现新按钮，不做无回调占位。整合集插入的quota/重复entryId/离线快照/升级备份另批 | `ui/features/playback/playback-queue-state.ts:27–35,70–74`；`ui/features/playback/playback-core.ts:521–531`；`tests/collection-playback-queue.test.ts:86–108` |

#### 7. 行内入口与列宽影响

现有TrackRow在操作区域有收藏和加入/移出歌单两个原生按钮，回调来自稳定RowSession（`ui/features/tracks/components/TrackRow.vue:34–42`；`ui/features/tracks/track-list-ui.ts:60–88`）。有效模板末轨68px、固定开销188px，操作在第9轨；偏好状态里没有“操作宽度”字段（`ui/styles.css:5481–5490,5509–5510`；`ui/features/tracks/track-column-state.ts:1–5`）。

推荐在共用TrackRow的**普通视频行**增加第三个有真实控制器回调的“下一首播放”图标按钮，原生键盘click，阻止冒泡到播放入口；可复用已有next图形并以aria-label/title区分（`ui/app/components/Icon.vue:8`）。32px命中区、4px间距下三按钮需104px，不能硬塞68px；同一列表合集行仍保留操作列占位宽度，但不造第三个空按钮。需同步有效CSS模板、按钮对齐、固定开销188→224、表头/行共同收缩，并实测重算744/680/616/516的断点。五个用户列宽偏好、容量和localStorage格式可保持，不给操作列新增可拖动分隔线/监听。证据：`docs/design/track-columns.md:3–13`；`ui/styles.css:4996–4999,5478–5510`。`tests/track-column-fit.test.ts:21–28`中的352px标题、188固定加总等预期会受影响（同条件标题将为316），这些是**需明确批准的布局断言变更**，不是改常量就当然获准；`tests/track-column-state.test.ts:5–31`的偏好业务预期应保持。

| 入口方案 | G0、冻结/UI规格影响 | 评价 |
|---|---|---|
| 共用普通视频行第三图标 | 冷启动无数据行时预算+0；实际挂载N个普通行就增加N个click。TrackRow真实结构/展示冻结、104px列/窄窗规格需批准，适用于首页/搜索/资料库/最近/合集详情中的普通视频 | 推荐，一套有回调的完整入口；不新增“更多”菜单 |
| 只在搜索等部分列表提供 | 仍需该列表104px模板、模型能力与回调选择、冻结差异及ui-spec注明入口范围；冷启动预算仍取决于真实行数，不天然比共用入口少。其他列表继续68px会引入两套操作布局 | 可降低第一批来源覆盖，但使用不一致，不推荐长期保留 |
| 分P模态中增加已接线的操作 | 可不改TrackRow列，但单P/未打开模态的行没有直接入口，且需明确选择分P或整个BV；若静态按钮在隐藏模态壳挂载会增加启动监听，须按内容与回调挂载阶段实测 | 不作为完整替代，不为了省列宽增加这条路径 |

ui-spec明确“不新增更多按钮”和保持现有标签/行为，不能借该功能暗改收藏、歌单移除或双击分P：`docs/ui-spec.md:74–90`。冻结需逐项查看`tests/fixtures/vue/tracks-baseline.json`及`library-lists-baseline.json`等实际覆盖，申请只允许新按钮/必要布局；不重录整套原断言掩盖差异。首屏监听预算详见第12项。

#### 8. 添加反馈

推荐由**播放器队列编辑控制器**在成功入队后复用`showPlaybackNotice("已加入下一首播放",{kind:"info"})`，2秒、不排队、不抢焦点、不自动打开抽屉；空队列直接开始播放沿用既有播放状态，不重复成功提示。普通TrackRow只调稳定回调，不直接调用notice；移出后行消失已经解释结果，默认不额外提示。现有info会让位于error，不能清除错误/业务状态来强行显示成功，不能把“内存已入队”说成“已保存到磁盘”（现有保存失败只写日志）。证据：`ui/features/playback/playback-notice.ts:27–39`；`ui/features/playback/playback-core.ts:206–208`。

遵守`docs/notification-guidelines.md:11–18,22–39,61–75`：优先近处反馈；播放器域单一入口；显式info，沿用2秒/错误优先级及polite播报；不弹普通结果确认、不发系统通知；新增反馈文案/语义必须同步规范和测试。该规范`:33,65`仍写旧ui/main.js/.cjs路径，实际入口与测试是`playback-notice.ts`、`tests/playback-notice.test.ts`；本次只指出，不顺带修改其他文档。既有notice会同步mini，见第13项，不能宣称消息内容完全不变。

### D. 移出队列

#### 9. 非当前父项

推荐在抽屉`.queue-parent`内增加与播放按钮/合集展开按钮**并列**的原生32px图标按钮，aria-label/title为“移出队列”，只操作父条目；普通44px、合集36px行高不变。默认visibility:hidden保留位置，父行:hover/:focus-within及按钮:focus-visible时显示；键盘先聚焦父播放按钮即可显露操作，再Tab进入，不能仅鼠标悬停可用。当前父项不提供移出入口；没有有效当前项时也不开放该批删除，避免把“移出非当前项”扩成清空。依据：`docs/ui-spec.md:45,74–82,112`；`ui/styles.css:4996–4999`；`ui/features/playback/components/QueueDrawerRow.vue:15–30`。

删除提交前控制器记录“焦点是否在被删行”和位置；仅该行持有焦点时，提交后优先聚焦同位置的后继行移出按钮，若后继是当前项则聚焦父播放按钮；无后继转前一行，极端无目标转抽屉关闭按钮。用既有list ref定位，必要时scrollIntoView(nearest)，焦点/滚动归控制器，不写组件DOM、不把DOM存进store。保留焦点在其他区域时不抢焦点。当前抽屉滚动identity含父index，删除当前项之前的行也会触发自动滚动（`ui/features/playback/queue-drawer.ts:40–47`）；建议将“同一当前父项仅位置移动”的编辑提交与实际切歌区分，编辑焦点恢复优先，避免先滚到远处当前项再把焦点留在屏外；真实切换仍保持nearest，打开仍仅一次center。新增测试必须覆盖此冲突，而不是仅断言activeElement。

删除合集父项只清其queue对象、randomRemaining索引和所属全部历史，存活合集冻结状态/当前成员不重新冻结；不调用收藏/歌单实体删除。队列仅剩当前项时，仍能播放和打开抽屉，计数1、无移出入口；原单曲/列表循环、分P历史与边界提示照常，不禁用原上一首/下一首来隐藏边界。证据：`ui/features/playback/playback-queue-state.ts:104–134,158–169`；`docs/notification-guidelines.md:57–59`；v2历史清理要求`src-tauri/src/library/playback_state.rs:180–207`。建议临时队列移出不弹确认（不删除资料库内容）；若要求确认/撤销，需另批准规范、显示状态及测试，不预做撤销栈。

#### 10. 当前项移除与清空（独立后批概要）

高风险：涉及停止/更换真实音频、在途请求/恢复失效、后继选择、合集配额/历史、空状态、分P/响度/缓存标记及持久化清除；清空还需决定自定义确认与播放是否同时停止。本期不提供入口，不设计后继细则。需单项批准播放/请求失效状态机、当前项后继及空队列行为、确认/焦点/通知规格、保存失败交互；任何Rust/IPC/存储格式、G0、业务冻结预期变化再分别申请。现有副作用边界见`ui/features/playback/playback-core.ts:154–175,178–208,811–857`和`src-tauri/src/library/playback_state.rs:296–304`，禁止只splice当前项后继续消费旧ended/旧解析。

### E. 持久化、监听、性能

#### 11. playback-state v1/v2及200项边界

格式原则上可沿用：前端按是否含合集选择v1/v2、当前索引/位置/分P及v2 traversal（`ui/features/playback/playback-core.ts:178–208`）；后端再次按实际保留的队列决定版本，v1移除traversal和entryId（`src-tauri/src/library/playback_state.rs:215–228`）。因此移除最后一个合集会回落v1，存活普通父项的运行时随机/history不应清空，但下次恢复v1本就不还原这些轮次而重新resetRandom。v2的冻结成员/历史可恢复，已有测试见`tests/collection-playback-queue.test.ts:86–95`，v1按需写回见`src-tauri/src/library/playback_state.rs:432–446`。编辑控制器需主动触发现有savePlaybackState，不能只等timeupdate周期；复用格式并不等于无需保存接线或无需身份验证。

首次需要v2时在同一storage锁下先backup_before_v2，再原子写；备份失败/无效不写新状态，原文件保持，已有备份不覆盖（`src-tauri/src/library/playback_state.rs:239–242,289–293,451–481`；`src-tauri/src/library/entries.rs:198–235`；`src-tauri/src/storage.rs:188–220`）。本期普通视频添加不会凭空升级；在已有合集队列中仍保持v2。不增新存储字段、不修改备份/原子写路径。保存接口目前fire-and-forget，失败只有console.warn，不应承诺编辑已持久化；若需要可重试错误反馈，另审返回值/调用方与通知策略。

**200限制是后端保存截断，不是运行时队列上限**：先取前200项，再夹current_index到199，过滤越界random/history，最后normalize版本（`src-tauri/src/library/playback_state.rs:271–293`）。0起始插入索引≥200（第201项起）的新增父项只在本次运行有效，重启会丢；插入到前200会挤掉原第200项。若正在播放的父项本来就在截断区外，索引被夹到另一条目，而position/page/cid仍是原曲目字段，存在恢复身份错配风险；若合集只在截断区外，落盘还会降成v1。不能用改前端currentIndex或重排保存队列掩盖。推荐本期保持现有200限制、明确接受长队列尾部不保证恢复；扩大/改为保留当前项窗口需独立Rust/持久化授权。纯视频v1不保存随机栈/历史，故随机“下一父项优先”重启后也不保证延续；如需持久保证，另批审格式，不借普通视频加入强制v2。

#### 12. 启动监听/G0预算

当前G0为201/156，Git/LF SHA256 `2e998e7063032bddf8fcc4e515889fb1c84b166a918684228c9e8deed46720ab`（`AGENTS.md:65–66`）。建议预算：**下一首+0、移出+0、共享事务+0启动监听**；不新增全局keydown、click、resize、observer或轮询。理由：初始store的来源列表为空，TrackList的骨架没有操作按钮（`ui/store/app-state.ts:60–66`；`ui/features/tracks/components/TrackList.vue:10–13`）；新原生行按钮只需一个click，原生键盘激活不再注册keydown；抽屉隐藏时无行，即使恢复了非空队列也不挂移出按钮（`ui/features/playback/components/QueueDrawer.vue:14–17`）。

这不是免测承诺：**如果实测首屏已有N个普通TrackRow，新按钮就会新增N条click**，CSS悬停隐藏不会推迟监听，不能用“入口不可见”声称+0。按部分列表方案也应数实际首屏行；若改列表委托，则每个初始宿主会多一条委托监听，同样须申请，不能偷偷转成全局监听规避记录。实现后用真实探针对比整序列/受保护投影，变化先查原因，按AGENTS格式申请新条数/首trackchange索引/SHA，批准前不改fixture；需重建时仓库外存档旧值。当前Esc配对、四项IPC及媒体监听保持（`ui/features/playback/queue-drawer.ts:15,19–30`；`AGENTS.md:65`）。

#### 13. 重绘、隐藏行与迷你窗

现有投影缓存仅依赖queue引用/currentIndex/开关阶段；每行按原位置比较entry与active，key为index+entryId/BV（`ui/features/playback/queue-drawer-view.ts:5–15`；`ui/features/playback/components/QueueDrawer.vue:17`）。故插/删p时，p之前引用不变的行可跳过；p及后缀因位置/序号/key变化会重绘，通常重挂载，尾部新增仅新行、尾部删除仅卸载目标。结构编辑不能套用“始终只重绘两行”；当前项高亮不变的前缀不应重绘。存活合集的**业务冻结状态**保持，但后缀组件因key变化重挂会按原默认值重置本地展开；若要求结构编辑保留全部展开状态，需要稳定的“队列出现位置身份”（重复BV不可仅用BV做key），另行决定，不在首批预加持久ID。

移出入口是行模型的稳定可用性/回调，不读取进度或临时悬停store；将可移出判断绑定到行active即可，回调由控制器稳定转发。隐藏期queue可变、模型仍可做O(n)纯投影，但`stage.hidden=true`时**不创建QueueDrawerRow、按钮、事件监听或行DOM**；壳/头部/list/ref继续常驻，关闭动画结束才卸载行，不能为方便移出操作把行移回隐藏DOM。可见期间100次纯进度提交仍返回同一模型引用，抽屉/行render=0，普通currentIndex切换仍只换两行；这两项原断言保留，另加结构编辑的前缀复用/后缀重排与焦点测试（`tests/queue-drawer-view.test.ts:7–18`；`tests/dom/queue-drawer.dom.ts:80–95`）。不引入虚拟滚动或改开关阶段，保留Q-3b-fix的Esc、一次center/后续nearest契约。

迷你窗无队列编辑UI、无父索引/计数字段；保持当前实际曲目时其title/播放/收藏等投影不变，不需改迷你窗源码、尺寸、Rust/IPC或启动跨窗序列（`ui/mini/mini-player-projection.ts:5–20`）。但“下一首已加入”的info会通过现有notice-change和notice字段同步到mini，这是正常的**内容变化**，不能声称编辑期间跨窗消息内容/次数完全不变；不新增消息类型/监听，移出操作也不伪造trackchange。证据：`ui/features/playback/playback-notice.ts:35–36`；`ui/mini/mini-player-host.ts:90–96,175–181`。下一首真正播放时仍走原跨窗同步。

### F. 分批与授权

#### 14. 实施清单、测试与变异

下列是未来功能分支的改动清单，本次不改任何产品/测试/脚本。每批1–3个中文Conventional提交，相关文档随对应实现；受影响的原业务断言不改，需改变的展示/布局冻结先逐项授权。依据：`AGENTS.md:39–43,60–68`。

##### Q-4b：普通视频下一首＋共用事务基础

- 产品文件：`ui/features/playback/playback-queue-state.ts`增加纯插入/索引映射及insertNextVideo；`ui/features/playback/playback-core.ts`增加队列编辑入口/保存/空队列起播；`ui/features/tracks/track-list-model.ts`、`ui/features/tracks/track-list-ui.ts`、`ui/features/tracks/components/TrackRow.vue`增加稳定回调与真实按钮；`ui/styles.css`调整104px操作轨与拟合。复用Icon的next，不新增图标库；`ui/store/app-state.ts`沿用同一工厂的类型推导，无需为新增action改写。
- 文档文件：`docs/ui-spec.md`、`docs/design/track-columns.md`、`docs/notification-guidelines.md`、本方案、`docs/where-to-change.md`、`CHANGELOG.md`随实现同步。
- 新增`tests/playback-queue-edit.test.ts`：插入映射、重复出现、栈顺序/消费、history身份、共享引用。新增`tests/dom/queue-edit.dom.ts`：各普通来源按钮、无冒泡播放/分P、空/无当前、LIFO、随机＋上一首、单曲/列表/多P/合集配额、direct高亮/分页/搜索回填/recent后果、pendingResume保持。deferred覆盖合集刷新/分P网络与磁盘/prepare_audio期间插入后仍回填原当前条目；插入总在当前之后，不伪造当前索引已移动的场景。补`tests/playback-notice.test.ts`、`tests/track-column-fit.test.ts`及`tests/dom/playback-tree.dom.ts`列宽检查；原偏好断言保持。
- 变异1处：让插入事务错误地把currentIndex选到新项，当前播放身份保持测试必须失败；针对新入队身份边界，在仓库外副本执行并恢复。
- 单项授权：插入/随机历史索引映射/来源脱离；空队列起播与通知文案；104px及断点ui-spec；第三按钮展示快照/受影响布局预期（如352→316）逐条批准；G0预算0，真实差异另申请。保留来源/FIFO/打断合集不包含在推荐范围内。

##### Q-4c：非当前父项移出＋在途回填修正

- 产品文件：同一`ui/features/playback/playback-queue-state.ts`事务扩展removeNonCurrentEntry；`ui/features/playback/playback-core.ts`落地第2项当前请求身份回填与保存；`ui/features/playback/queue-drawer-view.ts`仅按需增加稳定操作字段，`ui/features/playback/queue-drawer.ts`增加稳定回调/编辑焦点与滚动协调；`ui/features/playback/components/QueueDrawer.vue`、`ui/features/playback/components/QueueDrawerRow.vue`仅按需传回调/并列按钮，保留hidden行条件；`ui/styles.css`增加显隐/焦点样式。不改迷你窗/媒体契约。
- 文档文件：本方案、`docs/ui-spec.md`、`docs/where-to-change.md`、`CHANGELOG.md`随实现同步。
- 扩展`tests/playback-queue-edit.test.ts`：删前/后/尾、所有被删父项历史清理、随机不补回、同BV不同父项、合集整个移出与剩余冻结引用、剩一当前项、最后合集降v1保存参数。扩展`tests/dom/queue-edit.dom.ts`和`tests/dom/queue-drawer.dom.ts`：悬停/键盘入口、当前项不能移出、各焦点后继、保持当前音频/分P/恢复、无错滚、隐藏1000项零行render/零行监听、打开及关闭过渡；100次进度零重绘/切换两行的原断言保持。在所有等待阶段删除当前项之前的父项并断言正确身份回填，含重复BV。
- 变异2处：①退回捕获旧index回填；②移除非当前项保护，尝试移除当前项必须失败。针对新竞态/身份边界，每处1个，在仓库外副本执行并恢复。
- 单项授权：删除重排/历史过滤/来源脱离；当前请求元数据身份回填（不是重写取流）及保存；临时队列移出不确认、焦点/滚动ui-spec；仅新行内控件展示差异，原业务/冻结断言不改；G0预算0，变化另审。若要求保留展开状态/稳定出现ID，另列范围。

##### 后批：当前项移除/清空、整合集插入、持久恢复增强

当前/清空只按第10项重新立方案；整合集插入及第200项之后恢复分别审队列/存储边界，不与普通行按钮打包。届时补当前/末项/空状态、在途恢复/解析/媒体事件、后继和保存失败测试；若改Rust测试/生产格式再列具体文件与Cargo检查。播放/请求/恢复/失败状态机、后继策略、确认/通知、冻结预期、G0及Rust/IPC/持久化分别授权，本节不视为批准。

新增DOM文件须精确登记`scripts/tests/groups.ts`及`scripts/typecheck/tsconfig.node.json`，纯模块测试位于tests/*.test.ts；按新增入口仅补必要的冻结helper环境接线，默认行为保持。真实App/真实store测试可复用`tests/dom/tracks-fixture.ts:15–38`的deferred、显式queueCounters与控制器入口；事件遵守`tests/dom/event-turn.ts`。Rust格式/200截断/备份生产逻辑不在上述两批改动清单；若必须新增`src-tauri/src/library/playback_state.rs`测试或改存储，先单项授权并加Cargo验收，不能以测试为名越界。每批按AGENTS全量顺序验收，G0与受保护投影实测，变异只覆盖新竞态/身份边界；原有200恢复限制应列手测与产品取舍，未实施的场景不写“通过”。

### 待决定项（推荐）

1. 来源：接受首次结构编辑direct脱离，并清空版本/playlistId；理由是避免把编辑后父索引误用为来源列表位置。代价是来源高亮与recent默认分P提示不再跟随，恢复上限/随机轮次限制保持。
2. 下一首：普通视频、紧跟当前父项、后加先播、允许重复；当前合集/多P按原轮次先推进、自动单曲不被打断；空队列立即开始。理由是不新增优先播放分支和待播尾游标。若产品必须“下一段音频立刻播放”或连续FIFO，应另选更大方案。
3. 入口：共用普通TrackRow第三图标、104px操作轨；理由是各来源一致且有真实回调。需明确批准布局与冻结变化，不能塞回68px或加占位/更多按钮。
4. 移出：先仅非当前父项、无确认/无撤销、焦点就近恢复；理由是保留正在播放的成员/分P与请求身份，避免混入当前项后继/清空状态机。
5. 持久化与显示：首批保持200项及v1/v2格式，接受长队列尾部/纯视频随机优先不保证重启恢复、结构重排后缀合集展开可能重置；理由是不为队列编辑顺带升级存储和出现ID体系。如不接受，应先拆出恢复/稳定身份专项。

## Q-4b 实现记录（2026-11-18）

六类列表共用普通视频行的“下一首播放”按钮。与 Q-4a 提案相比，按钮使用专用列表播放图标，并对紧邻当前父项的同 BV 普通视频去重。去重命中仍按当前合集、多分P视频或普通视频显示对应的 2 秒提示，保留当前错误。合集锚点相同、队列其他位置已有同 BV 均允许插入。

每次结构编辑把新视频放到当前父项之后，同步重排历史父索引、随机候选索引和来源三字段。随机栈保留原消费顺序，新项压在栈尾。当前音频、冻结成员和分P继续原轮次。空队列直接起播；有队列但无当前项时在首位插入并起播。结构编辑后沿用现有保存入口和 200 项恢复边界。

### 冻结及布局核对

| 位置 | 旧值 → 新值 |
|---|---|
| tracks-baseline.dom 的操作按钮数（榜单、推荐、搜索） | 2 → 3 |
| tracks-baseline.json 的普通视频 HTML | 21 个场景的 24 行在收藏前各增加一个原生按钮，失效行禁用 |
| library-lists-baseline.json 的普通视频 HTML | 12 个场景各增加同一个按钮 |
| track-column-fit 的 1200px 标题宽度 | 352 → 316px |
| track-column-fit 的 900px 布局加总固定项 | 188 → 224px |
| vue-toolchain 的 DOM 分组清单与临时清单样本 | 各新增 queue-edit.dom.ts 一项 |

两份 HTML 矩阵剔除新按钮后与旧矩阵完全相同。新 Git/LF SHA256 分别为 tracks 的 `6e32c4836b5b898f0a9520899ba58b69c304fdd3ba57a4ffa665b108cccd6f71` 和 library-lists 的 `115a902b969ba6a9738fccb12b530eb4887bfe4bd2f430d1235e6edffe41692a`。启动探针为 201 条，首次 trackchange 索引 156，G0 Git/LF SHA256 为 `2e998e7063032bddf8fcc4e515889fb1c84b166a918684228c9e8deed46720ab`。

### 浏览器实测

隔离 Edge、真实 App、合成数据，1080×760 窗口和 320px 侧栏。1000 个父项，在索引 0 后通过控制器插入一项，每种状态独立导航 5 次，计时含同步渲染及保存命令发起，不含磁盘写入。隐藏时中位数 **6.7ms**，打开时 **230.5ms**。打开时插入点之后的父项因索引变化重新渲染；纯进度提交仍跳过抽屉和行。

六类列表的可滚动宽度均等于容器宽度，三个 32px 按钮之间各留 4px，时长列右缘与首按钮之间至少 16px。在四个新断点及各自上方 1px 读取真实组件的计算样式，播放量、日期、UP 主、时长分别于 780、716、652、552px 收起。截图、原始计时、逐场景快照差异及几何数据随仓库外 Q-4b 报告保存。
