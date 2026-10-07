# state-3 搜索状态迁移与验收报告

日期：2026-10-07。基线为 master/origin/master 的 a685649（state-1/2 已合并），在已有 refactor/state-3 分支工作。采用既定方案：一个极简应用 store、首页与搜索分片，无新增依赖。

## 提交与范围

1. b8fc085 `test(search): 补充旧实现搜索特征测试`。只增加旧实现特征测试及类型项目登记；提交前九项全通过，Node 346/346。
2. 本报告随 `refactor(search): 搜索状态迁入 store 并收口播放核心写入` 提交。用户已明确允许原计划的迁移提交 2、3 合并，避免中间兼容层。

未改 playerState 结构、HTML、CSS、Rust、依赖、取流链路、迷你窗同步。没有重录 G0，没有调整事件和原位初始化。旧 VM 测试更新模块接线或切片边界，原有测试名称及业务断言保留。state-3 特征测试文件完全未改，SHA256 为 A29331E3628CCEFF0C8D11884C930778DF706B21280DA0E5AE9E25AD57791831。

## API 与状态边界

沿用 `getState()`、`subscribe(listener)` 和 `actions`；订阅不立即回调，搜索挂载显式读取首屏快照。`getApplicationStore()` 复用首页原位创建的唯一应用实例，控制器只订阅一次。

`getState().search` 为深度只读快照，`actions.search` 提供 runSearch、loadMoreSearchResults、chooseDivision、chooseSort、appendResults、resetForBv、updateMetadata、setPlaybackBusy，以及显式显示投影动作。没有通用写入接口。状态模块只依赖纯工具与类型，invoke、报告、草稿读取、关键词保存通过适配器或动作参数注入。异步开始、成功、失败分别提交；成功包含结果、分页及按钮状态的完整同步阶段。订阅者异常由现有 store 报告并隔离。

搜索 renderer 只读快照，交互通过注入回调接回现有播放与分P入口。`view` 保存显示意图和修订号，避免普通状态提交改变原有重绘时机。搜索与播放忙态分别记录，但按钮仍按最后一次写入生效；搜索完成时，即使解析仍忙也会恢复按钮，与旧实现一致。

## 字段迁移对照

| 原 player-state.searchState 字段 | 新 getState().search 字段 | 写入动作 |
| --- | --- | --- |
| results | results | runSearch、appendResults、resetForBv、updateMetadata |
| userKeyword | userKeyword | runSearch、resetForBv |
| requestKeyword | requestKeyword | runSearch、resetForBv |
| tids | tids | chooseDivision |
| order | order | runSearch、resetForBv |
| rerank | rerank | runSearch、resetForBv |
| sortMode | sortMode | chooseSort（再次点击切回 all） |
| page | page | runSearch、appendResults、resetForBv |
| isLoadingMore | isLoadingMore | loadMoreSearchResults、appendResults、runSearch、resetForBv |
| hasMore | hasMore | runSearch、appendResults、resetForBv |
| requestVersion | requestVersion | runSearch、resetForBv |
| 搜索执行期间直接禁用按钮 | searchBusy | runSearch、resetForBv |
| 播放核心直接禁用/恢复按钮 | playbackBusy | setPlaybackBusy |
| 搜索提示、结果区可见、按钮及 tab 的 DOM 状态 | view.status/resultVisible/buttonDisabled/buttonSource/musicVersion/sortVersion/rowsVersion | 对应领域动作及显示投影动作 |

输入草稿仍是现有 input 的值；用户关键词与实际请求关键词属于搜索分片。上次关键词仍由控制器按原 localStorage 策略读写。队列、来源版本、随机剩余索引仍属于原播放核心，未迁移。

## DOM 写入迁移对照

| DOM 区域 | 迁移前 | 迁移后 | 只读情况 |
| --- | --- | --- | --- |
| 搜索结果列表及封面、文字、操作入口 | search.renderSearchResults | search-view.renderSearchRows | 只读取快照；绑定注入交互回调 |
| 分区 tab class/aria-selected | search.updateMusicTabs，由 main 调用 | search-view.renderMusicTabs，由订阅触发 | 只读 tids |
| 排序 tab class/aria-selected | search.updateSortModeTabs，由 main 调用 | search-view.renderSortTabs，由订阅触发 | 只读 sortMode |
| 搜索状态提示 | search 加载/错误与 core BV 识别 | search-view.renderSearchSnapshot | 只读 view.status |
| 搜索提交按钮 disabled | search 与 core 共同直接写 | search-view.renderSearchSnapshot 独占 | 只读最后写入投影，忙态由动作提供 |
| 搜索成功时结果区 visible | search | search-view | 只读 view.resultVisible；core 原有播放区显示写入保留 |
| 队列计数、当前位置、搜索播放高亮 | core.updateQueueUi | core.updateQueueUi | 读取搜索快照和原 playerState，归属不变 |

只迁移搜索 DOM 职责；共用曲目操作构造、播放高亮、播放栏仍走原入口。renderer 不调用 actions/invoke，不写状态。

## 写入方收口

- search：搜索开始/成功/失败、分页状态、结果替换与显示全部进入搜索动作。版本隔离、草稿变化丢弃、BVID 去重、原 hasMore 判据和提示保持。
- main：分区与排序赋值分别改为 chooseDivision/chooseSort；恢复搜索只读快照，记录历史仍关闭。
- playback-core BV 提交：原多字段赋值与清空展示合为 resetForBv；取消等待之后仍核验同一搜索版本。
- playback-core 分页追加：去重由 appendResults 完成；提交前回调保留原来源版本条件、队列扩展、随机索引及保存，然后发布搜索快照。旧播放队列结构未变。
- playback-core 元数据回填：原局部引用加 Object.assign(searchState.results[index], ...) 改为 updateMetadata(index, version, metadata)，只复制目标结果路径。旧快照与其它结果项不变；队列自身的 Object.assign 保留，原刷新入口保证两边显示一致。
- playback-core 按钮写入：取消、解析开始和有效请求 finally 的原位置改为 setPlaybackBusy；renderer 成为唯一按钮写入者。

状态模块、模块清单、导入顺序、类型项目、写入归属守卫同步登记。新增守卫反例覆盖直接赋值、push、跨多层局部别名的 Object.assign/Reflect.set；类型只读和冻结动作测试补充词法守卫的局限。

## 特征测试及旧实现证据

7 个场景在旧实现提交 b8fc085 上全部通过，提交前完整 Node 346/346；迁移后文件字节与上述 SHA256 完全相同，仍全部通过。

| 场景 | 覆盖 |
| --- | --- |
| 旧搜索迟到 | 旧成功与失败丢弃，最新按钮状态保留 |
| 旧分页及编辑草稿 | 分页版本隔离，草稿变化后不追加 |
| 去重及队列来源 | 页内/页间去重，来源版本匹配才扩展队列 |
| 分区、排序、重排 | 热门与关键词参数、排序再次点击、输入草稿保持 |
| 历史及恢复 | history fire-and-forget、不阻塞结果；恢复不写历史，成功才保存关键词 |
| BV 竞态和按钮 | 取消等待逆序完成时旧提交丢弃；搜索/解析交错时最后写入语义 |
| 元数据回填 | 展示列表与真实队列一致，不回写搜索关键词 |

证据日志在系统临时目录 `bili-music-verify/state3/`，baseline、commit1 及最终验证分别保存；日志中的 URL 已统一隐藏。

## 验收结果

| 项目 | 基线/旧实现 | 迁移后结果 |
| --- | --- | --- |
| cargo fmt --all -- --check | 通过 | 通过 |
| cargo build --workspace | 通过 | 通过 |
| cargo build --release --workspace | 通过 | 通过 |
| cargo test --workspace | 386（316+63+7） | 386（316+63+7），全通过 |
| cargo test --workspace --release | 391（322+63+6） | 391（322+63+6），全通过 |
| node --test | 基线 339；旧特征提交 346 | 355/355，无失败/跳过 |
| npm ci | 通过 | 通过；使用已有离线缓存，不访问外网 |
| npm run typecheck | main/mini/node 均 0 | 均 0；diagnostics.json 仍为 {} |
| npm run verify:dist | 通过 | 通过：G0 156/70 逐项相同，Windows/darwin 12 个文件逐字节相同，两个产物反例按预期失败 |

CRLF 临时克隆位于 TEMP/bili-music-verify/state3/crlf-final2；覆盖候选后 UI 清单 32 个与工作区一致，全部 CRLF。未安装依赖先 node --test，然后 npm ci、typecheck、verify:dist，四项退出码均 0。

CI 的 10 个 run 步骤逐条执行，其中 9 项通过；Linux 系统依赖安装因当前 Windows 环境跳过。bash 步骤使用指定 Git bash --noprofile --norc -c 执行。

Node 22.18.0 与 22.23.3 均为 355/355；原有 339 个名字及重复次数全部保留，新增 16 项，两版本完整有序清单一致。8 个 canary 在仓库外克隆逐项注入并恢复：额外 .js、额外 .cjs、any、新诊断、无效 DOM id、AudioResponse 类型破坏、缺 window-controls 脚本、状态引用 document；指定命令共 11 次均退出 1。新增搜索别名/按钮守卫的反例也全部通过。

自动验证证明当前覆盖范围内未发现行为变化；真实 WebView 的媒体、布局和 IPC 仍需以下手测。

## 新增测试名（16 项）

特征测试 7 项：

- search ignores late old search success and failure while retaining the latest button state
- search discards late pagination and edited draft results without changing the current list
- search deduplicates pagination and extends only the queue with its matching source version
- search division and sort clicks preserve hot versus keyword reranking parameters and draft
- search history is fire and forget and restored search skips history while persisting only success
- search BV submit races discard the cancelled paste and preserve last-writer busy button semantics
- search playback metadata fills the display and queue consistently without rewriting the keyword

无 DOM 动作测试 7 项：

- search actions run without DOM and publish complete immutable phases with home isolation
- search actions discard obsolete success failure and pagination after a new version
- search actions discard edited drafts and deduplicate pages before queue coordination
- search actions preserve division sorting reranking and hot query pagination parameters
- search actions record history without waiting and restore without recording or saving failures
- search metadata actions copy only the matching result and ignore stale source versions
- search busy actions preserve last writer button behavior across search and BV preparation

守卫测试 2 项：

- search snapshot guard rejects direct and aliased metadata writes
- search renderer is readonly and exclusively owns the search submit button

## 搜索手测清单

本环境未执行真实 WebView2 手测；以下是交付核验清单，不把自动测试冒充手测。

- 输入关键词提交：提示、按钮、列表数量、封面、时长与发布时间正常；当前歌曲继续播放。
- 连续提交不同关键词，交错切分区/排序：只显示最后一次结果；再点同一排序恢复 all，热门不写输入框。
- 滚动分页：加载提示、去重、没有更多了正常；加载时修改草稿、再次提交不会混入旧页。
- 点击某搜索结果：列表变为播放来源；随后分页扩展队列与随机剩余项；换新搜索仅改展示。
- 解析元数据返回：列表、播放队列与播放栏显示一致，关键词保持。
- 连续 BV 提交及搜索/解析交错：取消等待不使旧 BV 重新起播，按钮与旧版相同；多分P入口仍可用。
- 重启恢复上次关键词、进入搜索页：只触发一次自动恢复，不计搜索历史；手动搜索历史失败不阻塞。
- 搜索无结果、搜索失败、分页失败后可重新提交；首页切换与搜索互不污染。
- 播放、暂停、上一首/下一首、随机、失败跳过、收藏入口、迷你窗同步做回归观察。

## 后续工作量

本批运行时代码集中在两个新模块及既有接线模块，旧搜索模块主要删除迁移代码；复杂度来自队列协调、竞态特征测试与多套验收，而非 store。后续领域建议仍按“旧特征测试提交 → 单领域动作/renderer 迁移提交”拆分。资料库约 3–5 个工作日，分P约 3–5 日，设置/外观约 2–3 日，播放/队列约 5–8 日，迷你窗状态接入约 2–3 日（每批包含完整自动验收，真实手测另计）；这是工程估算，不是已验证的排期。
