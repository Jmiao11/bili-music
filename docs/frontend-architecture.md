# 前端架构

主窗口为单一 Vue 组件树，Rust 保持取流、代理、持久化与系统窗口职责。迷你窗由独立的 `ui/mini.ts` 模块入口与 `ui/mini/components/MiniApp.vue` 根组件同步渲染，主窗侧宿主发布契约保持。长期约束见 [AGENTS](../AGENTS.md)，功能定位见 [改功能指南](where-to-change.md)，过程记录见 [迁移历史](frontend-migration-history.md)。

## 目录约定

HTML直接引用的 `index.html`、`mini.html`、`app.ts`、`mini.ts`、`styles.css`、`mini.css` 留在 `ui/` 根目录，不改变HTML及构建产物路径。启动/外壳与跨页接线在 `ui/app/`，组合store在 `ui/store/`，平台和DOM/草稿端口在 `ui/platform/`，迷你窗宿主在 `ui/mini/`。新功能放 `ui/features/<功能>/`，同域state、控制器、投影与组件相邻；跨功能共用放 `ui/shared/` 或独立功能目录（曲目行在 `ui/features/tracks/`）。功能内部默认平铺，文件较多再设 `components/`；不引入路径别名。`store/app-state.ts`仍是原有组合工厂，`app/root-controls.ts`与`app/root-modals.ts`因跨功能接线留在app，不为目录拆实现。

## 启动与同步边界

`index.html` 中的 audio 在 `#app` 外。`app.ts` 第一个静态导入是 `app/root-mount.ts`：启动适配先应用平台与侧栏宽度，组合模块创建唯一 store、立即安装根订阅、读取快照，用公开 `render(h(App, props), host)` 完成首屏；之后其他控制器与 main-window-dom 才求值。业务订阅不能抢在根订阅之前，尤其不能在嵌套提交后让外层旧快照成为最后一帧。

每次提交都同步走根投影，组件收到完整只读快照中的切片、稳定显示模型与稳定转交回调。业务回调在原控制器阶段安装，提前存在的组件事件不会提前开展业务。首页 getter 的首次订阅与首投影时机保持。主路径无 nextTick/watch/RAF 合批；RAF 只用于原有动画、焦点阶段、主题同步及音量过渡等平台行为。

根渲染按引用缓存列表、播放控件、页面/设置及浮层模型。TrackRow 复用行模型和回调；纯进度不触及列表/行，高亮只改旧、新行，收藏只改对应行。数据/来源替换允许全量更新。root-shell、application-store 与真实 DOM 测试保护同步性、最先订阅、节点身份和未绑定草稿。

## 各层职责

| 层 | 所有权 |
|---|---|
| application-store / app-state / 各领域 state | 一个应用store、不可变提交、只读快照与领域actions；无DOM/IPC/平台时钟 |
| root-mount、root-controls/settings/playback/lists/modals | 同步纯显示投影、稳定回调转交及既有显示版本缓存；不新建业务状态机 |
| App→AppShell→子组件 | 外壳、列表、播放/歌词、页面控件、设置、分P与资料库内容；仅props/回调，独占动态绑定 |
| home/search/library-ui/video-pages/appearance/lyrics 等控制器 | 事件、请求/版本协调、输入端口、focus/几何/scroll/RAF/transitionend、系统及媒体副作用 |
| media-adapter、settings-adapter、runtime-api、mini host | 媒体、偏好与平台/IPC边界；audio写入只经已有适配器/命令 |
| Rust / 核心库 | 既有游客/WBI/yt-dlp、取消与代理、持久化、快捷键/窗口、watchdog；没有被前端收口重写 |

组件不自行访问 store/actions/invoke/window。非受控字段只在显式版本写值时更新，普通根提交不覆盖草稿。API Key 不进入模型、快照或props；输入值仅由控制器临时读取/清空。LibraryModalBody 的输入ref/同步名称更新保留，焦点仍由控制器执行。

## 浮层及原生部分

- PagesList 与 LibraryModalBody 已由 AppShell 的 VNode 子树生成，不再创建独立 renderer 或同步区域。外壳始终存在；内容由实际 modal/session 决定。generic 资料库内容序列化为空；关闭保留既有内容，重新打开才按 session.version 替换。同session输入与primary复用，忙态同步。
- 分P的 modal 投影变化生成新key，整批行替换。根在patch前记录焦点是否落在旧行或恢复按钮上，patch后同步转移到关闭按钮；首次打开的RAF仍由原控制器选择当前行/首行/关闭按钮。
- 设置、沉浸页和歌词隐藏时继续投影。打开/关闭的hidden、is-open、aria-hidden、RAF、transitionend、焦点与返回焦点保持，未用Vue Transition改变阶段。
- audio唯一且在宿主外；原生播放恢复capture监听、媒体身份保护、系统命令仍走commands/adapter。bindTrackActivation保留给现有特征测试，真实行使用生命周期会话，保证计时器、observer、拖拽与ref释放。
- AppShell仍有静态模板部分：常量标记、桌宠宿主、原生导航/窗口/动画外壳，以及少量首页/搜索/资料库状态文字端口。这些由控制器承担语义/平台I/O，Vue不为其受控属性建立动态绑定；不是第二套列表或浮层内容renderer。home-view/search-view/library-view/settings-view仍有实际的文字/外壳/平台职责，不能按文件名整删。

### main-window-dom 原生端口登记

只保留产品控制器实际导入的44项；原来仅冻结fixture需要的13项已移到测试选择器。测试选择器只在真实挂载后查询节点，不参与产品初始化。下表逐项登记，新增端口须说明用途并检查Vue写权。

| 端口 | 控制器/适配器 | 保留原因 |
|---|---|---|
| `audio` | `app/main.ts`、`features/playback/playback-core.ts`、`features/playback/playback-diagnostics.ts` | 唯一媒体节点；适配器、诊断与音频身份监听必须持有同一节点 |
| `closeLibraryModalButton` | `app/main.ts` | 资料库外壳关闭监听与焦点边界 |
| `favoritesCount` | `features/library/library-view.ts` | 收藏数量的原生文字投影 |
| `favoritesList` | `features/library/library-ui.ts`、`features/library/library-view.ts` | 收藏列表宿主身份、拖拽与行会话接线 |
| `favoritesStatus` | `features/library/library-view.ts` | 收藏加载/空态文字投影 |
| `homeCacheNote` | `features/home/home-view.ts` | 首页缓存说明及可见性投影 |
| `homeHintApply` | `app/main.ts` | 提示输入与Enter处理时的按钮状态读取 |
| `homeHintInput` | `platform/draft-ports.ts`、`features/home/home.ts` | 非受控首页提示草稿端口及缺节点降级 |
| `homeListLabel` | `features/home/home-view.ts` | 首页榜单/推荐列表说明文字 |
| `homeModeTabs` | `features/home/home-view.ts`、`app/main.ts` | 原模式投影接口；生产集合为0，不新增按钮 |
| `homePanel` | `features/home/home-view.ts` | 首页模式dataset、布局/引导class原生投影 |
| `homeRankingError` | `features/home/home-view.ts`、`app/main.ts` | 榜单错误文字及原生重试监听 |
| `homeRankingList` | `features/home/home-view.ts`、`features/tracks/track-list-ui.ts` | 首页列表宿主、observer与稳定行会话 |
| `homeRankingStatus` | `features/home/home-view.ts` | 首页加载/状态aria-live文字 |
| `homeSourceLabel` | `features/home/home-view.ts` | 首页来源标签文字与隐藏状态 |
| `homeSubtitle` | `features/home/home-view.ts` | 首页模式说明文字 |
| `homeTitle` | `features/home/home-view.ts` | 首页模式标题文字 |
| `libraryModal` | `features/library/library-view.ts`、`app/main.ts` | 资料库外壳hidden/class/aria、焦点约束和transitionend |
| `libraryModalBody` | `features/library/library-view.ts` | 仅作输入/primary查询和焦点目标，不写入其内容树 |
| `libraryModalStatus` | `features/library/library-view.ts` | 资料库状态文字与aria-live输出 |
| `libraryModalSubtitle` | `features/library/library-view.ts` | 资料库外壳说明文字和hidden |
| `libraryModalTitle` | `features/library/library-view.ts` | 资料库外壳标题与无障碍名称 |
| `pagesModal` | `app/main.ts`、`features/pages/pages-view.ts` | 分P外壳hidden/class/aria与键盘焦点约束 |
| `pagesModalClose` | `app/main.ts`、`features/pages/pages-view.ts` | 分P关闭监听及重绘后的焦点目标 |
| `pagesModalList` | `features/pages/pages-view.ts` | 分P行查询、首次打开滚动/焦点；内容由Vue独占 |
| `pagesModalRestoreAll` | `app/main.ts`、`features/pages/pages-view.ts` | 恢复全部监听、忙态与焦点；不创建内容节点 |
| `pagesModalStatus` | `features/pages/pages-view.ts` | 分P错误aria-live文字 |
| `pagesModalSub` | `features/pages/pages-view.ts` | 分P视频说明与数量文字 |
| `pagesModalTitle` | `features/pages/pages-view.ts` | 分P外壳无障碍标题 |
| `playerPagesButton` | `features/pages/video-pages.ts` | 打开当前分P的触发器、请求aria-busy与返回焦点 |
| `playlistMeta` | `features/library/library-view.ts` | 当前歌单曲目数量或未选择提示文字 |
| `playlistTitle` | `features/library/library-view.ts` | 当前歌单标题文字 |
| `playlistTracks` | `features/library/library-ui.ts` | 歌单曲目宿主身份、拖拽和行会话接线 |
| `playlistsList` | `features/library/library-ui.ts`、`features/library/library-view.ts` | 目录宿主身份、拖拽与目录会话接线 |
| `playlistsStatus` | `features/library/library-view.ts` | 歌单目录加载/数量/错误文字 |
| `purgeAppearanceStatus` | `features/library/library-view.ts` | 设置中的失效曲目清理结果文字（与外观提示共用端口） |
| `purgeUnavailableTracksButton` | `features/library/library-view.ts` | 失效曲目清理请求的原生禁用状态 |
| `queueCount` | `features/playback/playback-core.ts` | 搜索结果计数文字，与真实播放队列隔离 |
| `refreshRankingButton` | `features/home/home-view.ts`、`app/main.ts` | 首页显式刷新监听及原生禁用状态 |
| `result` | `features/playback/playback-core.ts`、`features/playback/playback-notice.ts`、`features/search/search-view.ts` | 搜索/播放结果容器可见性与提示几何定位 |
| `resumePlayPauseButton` | `features/playback/playback-core.ts`、`features/playback/playback-notice.ts` | capture阶段恢复拦截、失败提示中心定位；click仍由组件接收 |
| `searchKeyword` | `platform/draft-ports.ts` | 非受控搜索草稿的统一读写端口 |
| `searchResults` | `app/main.ts` | 分页滚动几何、搜索列表宿主及稳定行会话 |
| `searchStatus` | `features/search/search-view.ts` | 搜索加载/错误/分页状态文字 |

appearance 中 settingsDom 已缩为导航、页面容器、设置外壳及根CSS端口；删除18个失去用途的输出句柄。未删的输入读取、桌宠存在性检查、窗口/媒体节点与归一化实际checked读取仍有控制器用途。

## 测试结构与守卫

安装前用 Node 自带runner，依赖限内置/本地模块；安装后用精确登记的 `.dom.ts`，Vite编译实际App/SFC并由jsdom执行。`.test.ts`不能重复登记到DOM组。类型项目为主窗vue-tsc、mini/node tsc及SFC fixture，均零诊断；依赖精确锁定。

旧useAppState/createSyncRegion及其专用fixture/守卫、冷编译替身、vueRendererImports、classic全局变量冲突/allowedLets、空sourceSlice例外表已经退出。标准ESM由TypeScript/Vue/Vite检查；局部函数单测仍用行号保持的类型/模块擦除helper，它不是产品模块语法白名单。共享注释/字符串扫描器直接定义在helper，不再从已删除守卫文件动态提取。

controller-context 用真实冻结store/actions与显式场景准备；保留的断言别名只读当前快照，没有业务调用/事件/Promise的进入退出回填，也不包装事件监听器或Promise。真实DOM测试直接挂App；控制器单元测试的原生输出端口复用实际纯投影，不能复制产品业务实现。

| 保留的保护 | 覆盖/反例 |
|---|---|
| 组件隔离、runtime-only与零eval | scripts/vue/check.ts内置反例；javascript-guard.ts内置AST反例 |
| 类型、命令、DOM id、ESM源文件与测试分组 | typecheck、command-contract、dom-assertions、typescript-source及vue-toolchain测试 |
| 不可变/纯状态/写入归属 | state-architecture及各领域architecture，含别名/集合/平台访问/时钟反例；真实store冻结测试 |
| 同步渲染、最先订阅、audio宿主外 | application-store、root-shell.dom、playback-tree.dom及真实列表/浮层行为测试 |
| G0、HTML精确比较、平台产物一致、开发入口 | verify:dist及其内置错误脚本/标签反例，real-module-startup来源与覆盖探针 |
| 安全隐私与固化边界 | settings-privacy、备份/Rust日志隐私、media-volume-ownership、播放控制/请求/会话/mini宿主守卫 |

G0 当前193条、首个trackchange索引140，Git/LF SHA256 `c9858fc2d6c2d3b21764127c07cb1c3462e5e6738f91c1468c5340871cd24948`。每批verify，重建审批保留；播放/请求/trackchange/媒体监听/四项IPC listen/跨窗同步投影必须相同。F6当前产物仍匹配该基线，未因删测试设施重建fixture。

## 验证与交付

常规合并验收：全量Node→npm ci→DOM→typecheck→verify:dist；改Rust才加fmt/build/test。只对新竞态、启动可靠性、安全边界做定向变异。守卫改动跑对应canary，阶段完整回归跑全部保留项：错误JS/CJS、any/类型/id/命令契约、缺窗口初始化、纯状态/时钟/快照写入、越界媒体写入/模拟click/宿主DOM读取/旧桥接、命令端口类型、提示写权、启动求值、副作用/IPC、Vue平台/props/readonly/SFC导入、测试分组、eval/new Function；已删除设施的canary随之退役。

F6与发布前做Node22.18.0/22.23.3、CRLF、全部保留canary、双平台CI及Windows/Mac全应用手测。相同机器构建darwin配置仅证明产物一致，不能当Mac手测。真实窗口性能记录20秒根渲染平均/P95及纯进度列表/行重绘，不设数值门槛；策略拦截则交付可运行脚本，不绕过。

报告在仓库外一页内，列删除规模、接线短表、CI链接/GitHub操作次数与待手测项。只在分支CI双平台通过、用户明确授权后本地ff-only合并并推送master，PR始终由用户管理。

## 迷你窗同步根与产物隔离

`ui/mini.ts` 调用 `mini/window-controller.ts`；控制器先通过 `mini/root-mount.ts` 清理body静态占位并公开render首帧，再读取五个测量/焦点端口。每次mini-player-state到达及全文展开/关闭等本地变化都同步render，不依赖nextTick/watch/RAF合批。RAF仍只用于标题实际溢出测量与原有动画重启；命令处理函数在原先绑定阶段才生效。两个就绪通道都在首次渲染之后，位置恢复/移动持久化/卸载刷新和失败恢复沿用原控制器流程。

迷你窗组件独占标题、封面、控制按钮、提示、滚动class/style的显示写权；documentElement上的主题和强调色变量仍由窗口控制器同步应用，保证原来的:root CSS与跨平台透明窗口不变。原生拖动、焦点、测量、IPC和存储不进入组件。`scripts/typecheck/check.ts` 对mini也使用官方vue-tsc，覆盖真实SFC。

`vite.config.ts` 的主构建只处理index；`scripts/vite/mini-bundle.ts` 独立构建mini模块并将产物合入同一目录，Vue各自内联，两个入口都不允许静态/动态公共chunk。mini.js退役，mini.html只将原脚本改为module入口，其余源结构及CSS保持；verify:dist继续精确比HTML、双平台字节、G0与AST，缺文件反例改为迷你窗模块。F7主窗产物与G1逐字节核对，不重建193/140的G0。F8只盘点主窗剩余原生写入，不在F7迁移。