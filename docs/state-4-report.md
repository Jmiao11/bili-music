# state-4 资料库状态迁移与验收报告

日期：2026-10-08。master/origin/master 基线 b59e976；使用已有 refactor/state-4 分支。采用既定的单应用 store、领域分片方案，无新增依赖。

## 提交与边界

1. 5523139 `test(library): 补充旧实现资料库特征测试`。旧实现上先写测试，提交前九项全通过，Node 368/368。
2. b78a18b `refactor(library): 收藏、歌单与共用弹窗迁入 store`。提交前九项全通过，Node 378/378；独立完成数据、弹窗、播放核心写入收口。
3. 本报告随 `refactor(library): 拖拽排序状态迁入 store` 提交。三套拖拽纯状态进入分片，并完成同一同步阶段的会话状态提交合并；最终 Node 386/386。

未改 Rust、HTML、CSS、依赖、取流逻辑、playerState 结构、video-pages 或迷你窗同步。保留设置导入的原确认方式、清空历史的原行为、收藏/分 P 借用播放状态条的现状。没有重录 G0 或移动原位初始化。

## API 与字段迁移

应用继续使用 getState()、subscribe(listener) 和 actions；subscribe 不立即回调。library-ui 在原 loadLibrary/交互入口挂载一次订阅，显式读取首屏快照。领域动作位于 library-state，invoke/report 由 app-state 传入；状态模块不引用 DOM 类型、window、document 或 Tauri API。快照深度只读，动作仅复制改变路径，Map/Set 使用新集合；无 DOM 动作测试开启冻结。

| 原字段或局部状态 | 新字段 | 写入归属 |
| --- | --- | --- |
| libraryState.favorites | library.favorites | loadLibrary / toggleFavorite / reorderFavorites |
| libraryState.favoriteBvids | library.favoriteBvids | 和收藏数组在同一提交重建 BV 索引 |
| libraryState.playlists | library.playlists | 加载、CRUD、加入/移除、导入及两种歌单排序动作 |
| libraryState.selectedPlaylistId | library.selectedPlaylistId | choosePlaylist、CRUD/导入动作；提交时校验有效 ID |
| libraryState.unavailableBvids | library.unavailableBvids | loadLibrary / markUnavailable / clearUnavailable |
| libraryState.loadError | library.loadError | 读取成功清空；读取失败发布错误空状态 |
| favoriteImportVersion | library.session.version | 打开/关闭递增；导入响应按版本隔离 |
| 弹窗类型、标题、副标题、打开状态 | library.session.kind/title/subtitle/open | openModal / showName / showDelete / showChoose / showImport / showPurge / closeModal |
| 名称、曲目、歌单、导入预览及清理数据 | library.session.data | 具名弹窗动作、setModalName / setModalLink |
| 弹窗忙态和提示 | library.session.busy/status | 开始、成功、失败分别提交完整阶段 |
| favoriteDragState 非 DOM 字段 | library.drags.favorites | startDrag / finishDrag / 排序保存动作 |
| playlistDragState 非 DOM 字段 | library.drags.playlistItems | 同上，drag 额外存 playlistId |
| playlistListDragState 非 DOM 字段 | library.drags.playlists | 同上 |
| 列表刷新、借用状态条、清理按钮等投影 | library.view | 具名动作维护渲染版本、提示及忙态 |
| disabledPages / disabledPagePending | 原 libraryState，未迁移 | 沿用 library-ui 的加载回调和 video-pages |

选择器 isLibraryDragClickSuppressed(snapshot, kind, now) 是纯函数。时间由控制器读取后作为参数传入；状态层不读 performance。拖拽结束清空 drag 并设置 now + 400。落下并开始保存属于同一次同步提交；保存中拒绝再次拖动/提交，成功才替换排序数据，失败保留旧数组并解除保存中。

弹窗节点、输入/按钮引用、焦点操作、RAF 和关闭动画留在 library-view；三个拖拽 DOM 容器留在 library-ui，只存 row/target。状态仅保存 index/playlistId/saving/suppressClickUntil，不保存事件、DOM、dataTransfer 或节点别名。旧实现没有显式「关闭后主动恢复到打开按钮」逻辑，本批保留其焦点行为，没有增补这一行为。

## DOM 写入迁移对照

| 区域 | 迁移前 | 迁移后 | 只读边界 |
| --- | --- | --- | --- |
| 收藏列表、计数、空/错误状态 | library-ui.renderFavorites | library-view.renderFavorites | 只读资料库快照 |
| 歌单列表、标题、内容、操作区、空状态 | library-ui.renderPlaylists，同时修正选中 ID | library-view.renderPlaylists；ID 修正在动作提交中 | renderer 不写状态 |
| 收藏/歌单高亮 | library-ui.updateLibraryHighlights | library-view.renderLibraryHighlights | 只读资料库与注入的 player 投影 |
| 弹窗外壳、body、状态、按钮、输入显示与焦点 | library-ui 各弹窗函数 | library-view.renderLibrarySnapshot/renderModalContent | 事件只调用控制器注入回调，不直接调用 actions/invoke |
| 响度说明正文、确认按钮与焦点 | playback-core.showLoudnessNormalizationDialog | library-view.renderLoudness；core 调用 openLoudnessModal | core 不再借用 body 写 DOM |
| 清理失效曲目预览、按钮与结果提示 | library-ui.openPurgeUnavailableTracksModal | library-view.renderPurge 及快照投影 | API 请求属于动作 |
| 关闭动画结束的 hidden | main 的原位 transitionend 监听内写入 | 原监听委托 finishLibraryModalTransition | 监听位置不变，DOM 写入归 renderer |
| 收藏/加入操作借用播放状态条 | library-ui 直接写 status | library-view 按 view.playbackVersion 写入 | 保留与 core 共用该区域的现状 |
| 三套拖拽行的 class、draggable、dataTransfer | library-ui 拖拽控制器 | 仍为 library-ui 控制器 | 只操作 DOM 容器，领域状态通过动作 |
| 曲目行内容、曲目操作按钮及播放栏收藏按钮 | playback-core 共享曲目行/按钮工厂 | 仍为 playback-core，读取 getLibrarySnapshot | 未扩展本批为播放栏重构 |

## 写入方收口与错误安全

- library-ui 的收藏/歌单读取与增删、选中项、导入、弹窗、排序状态全部调用资料库动作；没有对快照的直接赋值、push、Set/Map 写入或 Object.assign 别名写入。
- core 的失效 set/delete 改为 markLibraryUnavailable / clearLibraryUnavailable。原 mark_track_unavailable / clear_track_unavailable invoke、错误 warn 和 renderLibraryViews 调用仍在原位置；取流和跳过逻辑未改。
- renderPlaylists 的选中项修正移至领域 update，renderer 只读。main 保留原监听，只委托关闭动作/动画 renderer。
- 收藏事件仍由控制器在持久化结果与同步渲染之后发出：bilibili-music-favorite-change 保留成功/失败 payload，bilibili-music-favorite 只在新增成功时发出；迷你窗和桌宠订阅不动。
- mandatory 读取失败只形成错误空状态；没有任何自动写回。toggle/CRUD 的失败保留数据；导入分页失败不创建部分歌单，关闭后重开的迟到响应不影响新会话。清理预览读取失败不发起 purge；只有用户确认后才发起清理。

## 旧实现特征测试证据

5523139 只新增特征测试及类型登记，其父提交是 b59e976；迁移运行时代码在下一提交才出现。commit1/nine 的九项退出码均为 0，node.log 为 368 个测试通过，其中下面 13 项在旧实现通过。此文件此后 git diff 为空，工作区 CRLF 字节 SHA256：164C2978457C051272142152ED4E27C5EC126594CD929D6C032C7148720B5050。

- `library reads favorites playlists and indexes without writing back after read failures`
- `library favorite add remove and failure publish existing mini and mascot events only after results`
- `library playlist create rename delete validate names and repair selected playlist`
- `library add chooser prevents duplicates and creates then adds a new playlist`
- `library modal preserves animation and existing focus behavior including loudness explanation`
- `library playback failure marks unavailable and successful retry clears through existing playback`
- `library favorite import closes and reopens with request isolation and no partial saves`
- `library favorites drag success preserves ordering duplicate save guard and 400ms click suppression`
- `library favorites drag failure preserves ordering duplicate save guard and 400ms click suppression`
- `library playlistItems drag success preserves ordering duplicate save guard and 400ms click suppression`
- `library playlistItems drag failure preserves ordering duplicate save guard and 400ms click suppression`
- `library playlists drag success preserves ordering duplicate save guard and 400ms click suppression`
- `library playlists drag failure preserves ordering duplicate save guard and 400ms click suppression`

这些测试覆盖收藏读取与错误保护、添加/取消/事件、歌单 CRUD/校验/选中修正、加入及新建并加入、弹窗动画与既有焦点/响度说明、失效标记/恢复、导入请求隔离，以及三种排序的成功/失败/重复提交/400ms 抑制。最终仍为 13/13，一行不改。

## 现有测试断言审计

完整证据在 [state-4-assertions.md](state-4-assertions.md)：10 个被修改的现有测试文件，347 个原有断言调用逐条列出前后完整调用及参数、原文哈希、配对编号、每个测试的执行次数和保留调用次数变化。审计比较 5523139（旧实现）与最终候选；已核对这 10 个文件在 5523139 与 master 基线 b59e976 逐字节相同。计数包装只用于仓库外副本，保留调用 owner、参数、返回值及异常。

结果：344 个原文相同；3 个登记类改变；新增/删除均为 0。业务断言改变/删除为 0；源码写法检查删除/替换为 0，没有需要列出的替代行为测试。99 个原有测试全部执行；有显式断言的测试执行到原来的保留断言，没有正次数变为 0 的调用。没有显式 assert 的 VM 编译测试仍以实际编译成功/异常作为判据。

三处登记类断言更新逐条为：module-graph 的期望模块集合增加两个模块；real-module-startup 的模块数 21 → 23；state-architecture 的纯导入白名单增加 library-state。其它登记项改动是清单、局部绑定和写入白名单数据，断言调用原文不变。详见附录中的各文件说明与原文。

| 现有文件 | 测试数前/后 | 断言执行总次数前/后（含顶层） |
| --- | ---: | ---: |
| tests/architecture-guards.test.ts | 7/7 | 702/734 |
| tests/favorite-import.test.ts | 5/5 | 20/20 |
| tests/loudness-normalization.test.ts | 23/23 | 1680/1680 |
| tests/module-graph.test.ts | 2/2 | 4/4 |
| tests/module-imports.test.ts | 1/1 | 1482/1527 |
| tests/playback-core-characterization.test.ts | 36/36 | 330/330 |
| tests/real-module-startup.test.ts | 1/1 | 11/11 |
| tests/search-characterization.test.ts | 7/7 | 87/87 |
| tests/state-architecture.test.ts | 5/5 | 102/110 |
| tests/strict-null-runtime.test.ts | 12/12 | 101/101 |

业务测试文件的逐测试次数完全相同。架构/模块登记测试的次数随新增模块、函数及绑定改变，仍逐项执行；每处变化在附录中记录。未触发的 assert.fail 等禁止分支前后均为 0，没有把这些零次数分支算成已覆盖。

## 验收结果

| 项目 | 结果 |
| --- | --- |
| cargo fmt --all -- --check | 三个提交候选均通过 |
| cargo build --workspace | 均通过 |
| cargo build --release --workspace | 均通过 |
| cargo test --workspace | 均为 386（316+63+7），0 失败 |
| cargo test --workspace --release | 均为 391（322+63+6），0 失败 |
| node --test | 基线 355；旧特征提交 368；资料库/弹窗提交 378；最终 386，0 失败 |
| npm ci | 通过；使用既有离线缓存，未改依赖或锁文件 |
| npm run typecheck | main/mini/node 均为 0，diagnostics.json 为 {} |
| npm run verify:dist | 通过；windows/darwin 的 12 个 JS/HTML/CSS 文件逐字节一致，两个产物反例按预期失败 |
| G0 | 156 条逐项相同；首个 trackchange 索引 70；夹具未改 |
| CRLF | core.autocrlf=true 单分支临时克隆，覆盖候选；34 个 UI 文件清单一致且全为 CRLF |
| CRLF 四项 | node --test 在 npm ci 前通过（node_modules 不存在），随后 npm ci、typecheck、verify:dist 均通过 |
| Node 22.18.0 / 22.23.3 | 各 386/386；原 355 名称及多重集次数全部保留；新增 31；两版本完整清单一致 |
| 全部 canary | 8 个场景、11 条指定命令全部非零失败；每个场景结束恢复原文件并删除新增文件 |
| 新守卫反例 | DOM 引用/类型/平台依赖、资料库直接/集合/嵌套别名写入均被拦截 |

CI 逐条执行的 run 步骤：

| # | 原 run | 结果 |
| --- | --- | --- |
| 1 | npm ci | 0 |
| 2 | npm run verify:dist | 0 |
| 3 | Linux apt-get 系统依赖安装 | 跳过：当前为 Windows，该步骤仅 runner.os == Linux |
| 4 | cargo fmt --all -- --check | 0 |
| 5 | cargo build --workspace | 0 |
| 6 | cargo test --workspace | 0 |
| 7 | npm run check:ui-syntax | 0；使用 Git Bash --noprofile --norc -c |
| 8 | node --test | 0 |
| 9 | npm run typecheck | 0 |
| 10 | node scripts/check-tauri-window-config.ts | 0；当前满足 Windows 条件 |

canary 1：新增 ui/.js；2：新增 tests/.cjs；3：显式 any；4：新 TS2322；5：不存在 id 的 DOM 顶层断言；6：AudioResponse.audioUrl 改 number；7：删 window-controls 普通脚本标签；8：状态模块引用 document。1/2/6 各要求 Node 与 typecheck 失败，3/4/5 要求 typecheck 失败，7 要求 verify:dist 失败，8 要求状态守卫失败。

原始脱敏日志、脚本、两版本完整名称清单及计数 JSON 位于 C:/Users/Jmiao/AppData/Local/Temp/bili-music-verify/state4/ 和 state4-assert-audit-final/。验证只使用临时目录和回环桩，不读取真实资料库。日志与报告不输出完整播放 URL、cookie 或游客标识值。

## 新增测试名（31 项）

- `library actions copy unavailable maps and repair selected playlist outside rendering`
- `library actions load without DOM in one immutable phase and isolate other domains`
- `library actions never persist empty fallback after read errors`
- `library add chooser prevents duplicates and creates then adds a new playlist`
- `library favorite actions retain previous snapshots and failures do not change data`
- `library favorite add remove and failure publish existing mini and mascot events only after results`
- `library favorite import closes and reopens with request isolation and no partial saves`
- `library favorites drag actions failure isolate DOM and preserve save guards and 400ms deadline`
- `library favorites drag actions success isolate DOM and preserve save guards and 400ms deadline`
- `library favorites drag failure preserves ordering duplicate save guard and 400ms click suppression`
- `library favorites drag success preserves ordering duplicate save guard and 400ms click suppression`
- `library import page failure never saves partial tracks and permits retry`
- `library modal actions publish complete CRUD preview and failure phases`
- `library modal import versions discard closed and reopened responses and duplicate submissions`
- `library modal preserves animation and existing focus behavior including loudness explanation`
- `library name validation create rename add and duplicate actions preserve command contracts`
- `library playback failure marks unavailable and successful retry clears through existing playback`
- `library playlist create rename delete validate names and repair selected playlist`
- `library playlistItems drag actions failure isolate DOM and preserve save guards and 400ms deadline`
- `library playlistItems drag actions success isolate DOM and preserve save guards and 400ms deadline`
- `library playlistItems drag failure preserves ordering duplicate save guard and 400ms click suppression`
- `library playlistItems drag success preserves ordering duplicate save guard and 400ms click suppression`
- `library playlists drag actions failure isolate DOM and preserve save guards and 400ms deadline`
- `library playlists drag actions success isolate DOM and preserve save guards and 400ms deadline`
- `library playlists drag failure preserves ordering duplicate save guard and 400ms click suppression`
- `library playlists drag success preserves ordering duplicate save guard and 400ms click suppression`
- `library purge read failure never writes and explicit success reloads through immutable phases`
- `library reads favorites playlists and indexes without writing back after read failures`
- `library renderer reads snapshots without actions platform imports or snapshot writes`
- `library reorder actions preserve old order on failure and publish success after persistence`
- `library snapshot guard rejects collection and nested alias mutations`

## 资料库手测清单

下列是真实 WebView 手测待执行清单，不把 DOM 桩自动测试写成手测已通过。执行时使用临时资料库与回环接口桩，避免真实数据目录及外网。

- [ ] 收藏首次加载、空列表、读取错误；错误状态下没有空数据自动写回；添加/取消后计数和三个入口按钮一致。
- [ ] 收藏变更分别观察迷你窗和桌宠事件的名字、顺序及 payload；失败仅走既有失败提示。
- [ ] 歌单新建/改名的空名、重名和合法名称；加入已有歌单、重复加入、新建并加入；移除与删除后选中项及播放高亮。
- [ ] 公开收藏夹预览、改名、分页、上限与跳过提示；请求中关闭再打开、迟到响应、失败重试，确认无部分歌单保存。
- [ ] 收藏、歌单内曲目、歌单列表三套原生拖拽：上/下移、同位置、离开行、结束清样式；保存成功/失败/重复拖动；400ms 内点击拦截，截止后恢复。
- [ ] 播放失败时标记失效、成功后清除；后端持久化错误不阻断播放；显式清理预览失败与确认成功。
- [ ] 名称、删除、加入、导入、清理及响度弹窗的 Enter/取消/遮罩/关闭、busy 状态、文本、打开焦点和动画；关闭后焦点行为与旧版逐项比对。
- [ ] 切换首页/搜索/收藏/歌单、切歌时的列表高亮及共享播放状态条；禁止借本批调整原有行为。

已验证范围覆盖状态、命令参数、事件、列表/弹窗 DOM 桩输出、启动记录和构建产物；真实浏览器媒体、焦点和拖拽交互仍需上述手测。未发现需要触发停止条件的最终差异。
