# 前端架构

两个窗口的界面全部由 Vue 渲染。主窗口为单一 Vue 组件树，Rust 保持取流、代理、持久化与系统窗口职责。迷你窗由独立的 `ui/mini.ts` 模块入口与 `ui/mini/components/MiniApp.vue` 根组件同步渲染，主窗侧宿主发布契约保持。长期约束见 [AGENTS](../AGENTS.md)，功能定位见 [改功能指南](where-to-change.md)，过程记录见 [迁移历史](frontend-migration-history.md)。

## 目录约定

HTML直接引用的 `index.html`、`mini.html`、`app.ts`、`mini.ts`、`styles.css`、`mini.css` 留在 `ui/` 根目录，不改变HTML及构建产物路径。启动/外壳与跨页接线在 `ui/app/`，组合store在 `ui/store/`，平台和DOM/草稿端口在 `ui/platform/`，迷你窗宿主在 `ui/mini/`。新功能放 `ui/features/<功能>/`，同域state、控制器、投影与组件相邻；跨功能共用放 `ui/shared/` 或独立功能目录（曲目行在 `ui/features/tracks/`）。功能内部默认平铺，文件较多再设 `components/`；不引入路径别名。`store/app-state.ts`仍是原有组合工厂，`app/root-controls.ts`与`app/root-modals.ts`因跨功能接线留在app，不为目录拆实现。

## 启动与同步边界

`index.html` 中的 audio 在 `#app` 外。`app.ts` 第一个静态导入是 `app/root-mount.ts`：启动适配先应用平台与侧栏宽度，组合模块创建唯一 store、立即安装根订阅、读取快照，用公开 `render(h(App, props), host)` 完成首屏；之后其他控制器才求值；原 main-window-dom.ts 已删除，读取/事件节点由组件类型化ref回传到 platform/main-window-refs.ts。业务订阅不能抢在根订阅之前，尤其不能在嵌套提交后让外层旧快照成为最后一帧。

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
- 页面文案、导航与外壳由 app/shell-projection.ts 根据现有快照投影。app/shell-stages.ts 只保留动画阶段、侧栏几何和系统最大化的显示值，不建立第二个业务store。控制器保留原RAF/transitionend/焦点时序，通过 presentation-refresh.ts 请求公开render同步投影本地阶段。
- 动态背景由 features/settings/components/DynamicBackground.vue 生成双层颜色/交叉淡化/暂停class；dynamic-background.ts只负责Image/canvas取色、任务身份、计时与显示模型。
- appearance-status只有SettingsPanel写入；shell投影按原settings文本实际变化与后续purgeStatus写入的先后保留可见值。重复相同外观文案不覆盖后来出现的清理结果，这与旧实现一致。
- 分P请求忙态与观察器data标记由pages-ui-state.ts保存节点关联的本地显示值，再进入稳定行props；每次仅受影响行变化。bindTrackActivation仍保留原生事件接线兼容接口，旧badge原生增删路径与注册表已删除；相关测试挂载真实TrackRow。

### 原生端口与精确例外

原44项静态查询中，24项静态查询退出（homeModeTabs只保留零项常量接口），19项改为组件ref回传，audio保留。main-window-dom.ts已删除。main-window-refs.ts中的19项均只读/事件用途，没有显示写入；生产homeModeTabs保持空集合，不新增按钮。

| ref端口 | 保留理由 |
|---|---|
| `searchResults` | 分页滚动几何与原生scroll监听 |
| `homeRankingError` | 重试事件接线 |
| `homeRankingList` | 列表存在性、observer和行会话目标 |
| `refreshRankingButton` | 显式刷新监听 |
| `homeHintInput` | 非受控草稿存在性降级；值经组件读写端口 |
| `homeHintApply` | Enter转发原生click，保留事件顺序 |
| `playbackBarNode` | ResizeObserver目标；已改名playbackBarNode |
| `playerPagesButton` | 打开分P的opener与返回焦点 |
| `resumePlayPauseButton` | capture恢复拦截、提示中心几何 |
| `favoritesList` | 收藏列表宿主身份与拖拽会话 |
| `playlistsList` | 目录宿主身份与拖拽会话 |
| `playlistTracks` | 歌单曲目宿主身份与拖拽会话 |
| `libraryModal` | 外壳事件、contains与焦点边界 |
| `closeLibraryModalButton` | 关闭事件接线 |
| `libraryModalBody` | 输入/primary焦点与select目标查询 |
| `pagesModal` | 外壳事件、contains与焦点边界 |
| `pagesModalRestoreAll` | 恢复全部事件与重绘焦点判定 |
| `pagesModalList` | 当前/首行焦点及滚动目标 |
| `pagesModalClose` | 关闭事件与重绘后焦点 |

搜索、首页提示、歌词与Key草稿由组件安装read/write闭包，恢复/清空是组件自己的非受控字段写入，不发input、不经过store或props传值。SettingsPanel的字段directive仅在显式版本变化时写value/checked；普通根提交保持草稿。控制器没有input.value写入。

| 允许保留的原生副作用 | 范围与理由 |
|---|---|
| 宿主外唯一audio、MediaSession | 原播放器及系统媒体接口；不得复制audio或监听 |
| html/body的dataset、属性与CSS变量 | 平台、主题、强调色、背景、侧栏宽度、窗口最大化、启动标记；不写应用树节点 |
| 原生窗口拖动/缩放、指针捕获 | 系统窗口行为，不属于组件界面投影 |
| focus/select、几何读取、scrollTop/scrollTo/scrollIntoView、observer | 保留原焦点与歌词居中算法；节点由ref或ref容器的当前子节点查询取得，controller执行 |
| 未挂载的Image/canvas | 封面采样与请求取消；不会进入Vue宿主，不是界面节点 |
| 组件内部的非受控输入directive/ref闭包 | 组件是唯一写入方；不绑定Key到快照/props，不在控制器写DOM |

控制器中剩余选择器只用于原有事件、焦点、测量和缺节点降级；不承担显示写入。守卫 scripts/vue/native-writes.ts 用TypeScript符号识别DOM/CSS写入，排除组件与两个根挂载适配器，例外按文件+完整表达式精确登记并拒绝失效登记。DOM写入别名同样被检查。

## 测试结构与守卫

安装前用 Node 自带runner，依赖限内置/本地模块；安装后用精确登记的 `.dom.ts`，Vite编译实际App/SFC并由jsdom执行。`.test.ts`不能重复登记到DOM组。类型项目为主窗vue-tsc、mini vue-tsc / node tsc及SFC fixture，均零诊断；依赖精确锁定。

旧useAppState/createSyncRegion及其专用fixture/守卫、冷编译替身、vueRendererImports、classic全局变量冲突/allowedLets、空sourceSlice例外表已经退出。标准ESM由TypeScript/Vue/Vite检查；局部函数单测仍用行号保持的类型/模块擦除helper，它不是产品模块语法白名单。共享注释/字符串扫描器直接定义在helper，不再从已删除守卫文件动态提取。

controller-context 用真实冻结store/actions与显式场景准备；保留的断言别名只读当前快照，没有业务调用/事件/Promise的进入退出回填，也不包装事件监听器或Promise。真实DOM测试直接挂App；控制器单元测试的原生输出端口复用实际纯投影，不能复制产品业务实现。

C1 的 `library-entry.ts` 登记为无 DOM 的纯资料库转换模块。`collection` 切片承载当前完整快照、引用 entryId、刷新版本与快照回退标志；同 id 的在途请求由 actions 私有 Promise Map 合并。CollectionToolbar 只接只读切片与稳定回调；合集行复用 TrackRow，不登记 BV/分P观察端口。资料库控制器在调用现有 playListItem 前过滤合集并换算索引，队列状态机与取流链路不变。新增 DOM 用例与纯模块已同步登记到测试组、类型项目和原有守卫；未新增原生写入例外，G0 保持 193/140。

| 保留的保护 | 覆盖/反例 |
|---|---|
| 组件隔离、runtime-only与零eval | scripts/vue/check.ts内置反例；javascript-guard.ts内置AST反例 |
| 类型、命令、DOM id、ESM源文件与测试分组 | typecheck、command-contract、dom-assertions、typescript-source及vue-toolchain测试 |
| 不可变/纯状态/写入归属 | state-architecture及各领域architecture，含别名/集合/平台访问/时钟反例；真实store冻结测试 |
| 同步渲染、最先订阅、audio宿主外 | application-store、root-shell.dom、playback-tree.dom及真实列表/浮层行为测试 |
| G0、HTML精确比较、平台产物一致、开发入口 | verify:dist及其内置错误脚本/标签反例，real-module-startup来源与覆盖探针 |
| 安全隐私与固化边界 | settings-privacy、备份/Rust日志隐私、media-volume-ownership、播放控制/请求/会话/mini宿主守卫 |

G0 当前193条、首个trackchange索引149，Git/LF SHA256 `4f2c9796640952257040919b72fde9400b9099f56f7c59226965b8aec9d22c7e`。每批verify，重建审批保留；播放/请求/trackchange/媒体监听/四项IPC listen/跨窗同步投影必须相同。UI-0 获批仅删除原独立角色控制器的9条监听，其余事件序列与完整启动 IPC/跨窗同步逐条相同；旧 fixture 已仓库外归档。

UI-2b补充的列宽文档根写入端口、设置初始化与9条授权监听变更，见 [列宽与G0登记](design/track-columns.md)。该端口只更新三项CSS变量；表头ARIA由Vue显示模型管理，列表不重绘。

## 验证与交付

常规合并验收：全量Node→npm ci→DOM→typecheck→verify:dist；改Rust才加fmt/build/test。只对新竞态、启动可靠性、安全边界做定向变异。守卫改动跑对应canary，阶段完整回归跑全部保留项：错误JS/CJS、any/类型/id/命令契约、缺窗口初始化、纯状态/时钟/快照写入、越界媒体写入/模拟click/宿主DOM读取/旧桥接、命令端口类型、提示写权、启动求值、副作用/IPC、Vue平台/props/readonly/SFC导入、测试分组、eval/new Function；已删除设施的canary随之退役。

F8最终回归及发布前做Node22.18.0/22.23.3、CRLF、全部保留canary、双平台CI及Windows/Mac全应用手测。相同机器构建darwin配置仅证明产物一致，不能当Mac手测。真实窗口性能记录20秒根渲染平均/P95及纯进度列表/行重绘，不设数值门槛；策略拦截则交付可运行脚本，不绕过。

报告在仓库外一页内，列删除规模、接线短表、适用的分支CI链接/GitHub操作次数与待手测项。涉及产品代码或测试时，Codex负责本地提交、推送功能分支和只读查看该分支CI；CI和用户手测通过后只报告“可合并”。由用户本地执行 `git merge --squash`，每批在master上只留一条提交。仅改文档、配置或规则且不改产品代码和测试的小改动，可直接在本地master提交，Codex不推送，由用户检查后推送。推送master、删除分支和PR操作均由用户执行；具体分支命名及Git权限以AGENTS.md为准。

## 迷你窗同步根与产物隔离

`ui/mini.ts` 调用 `mini/window-controller.ts`；控制器先通过 `mini/root-mount.ts` 清理body静态占位并公开render首帧，再读取五个测量/焦点端口。每次mini-player-state到达及全文展开/关闭等本地变化都同步render，不依赖nextTick/watch/RAF合批。RAF仍只用于标题实际溢出测量与原有动画重启；命令处理函数在原先绑定阶段才生效。两个就绪通道都在首次渲染之后，位置恢复/移动持久化/卸载刷新和失败恢复沿用原控制器流程。

迷你窗组件独占标题、封面、控制按钮、提示、滚动class/style的显示写权；documentElement上的主题和强调色变量仍由窗口控制器同步应用，保证原来的:root CSS与跨平台透明窗口不变。原生拖动、焦点、测量、IPC和存储不进入组件。`scripts/typecheck/check.ts` 对mini也使用官方vue-tsc，覆盖真实SFC。

`vite.config.ts` 的主构建只处理index；`scripts/vite/mini-bundle.ts` 独立构建mini模块并将产物合入同一目录，Vue各自内联，两个入口都不允许静态/动态公共chunk。mini.js退役，mini.html只将原脚本改为module入口，其余源结构及CSS保持；verify:dist继续精确比HTML、双平台字节、G0与AST，缺文件反例改为迷你窗模块。F7主窗产物与G1逐字节核对，不重建193/140的G0。F8完成了主窗剩余写入交接，主窗与迷你窗均由各自Vue根独占界面写权。

### UI-4：迷你窗主题参数同步

`mini-player-projection.ts` 仅在背景图主题追加背景路径/暗化值，在动态主题追加由host调用 `readDynamicPalette()` 后传入纯投影的三色；无Key或业务播放地址。`subscribeMiniPlayerTheme` 复用原store订阅和原RAF发布合并，并在窗口就绪后订阅动态背景的本地展示通知；关闭/卸载同时取消。动态取色完成只通知展示消费者，不改store提交与FIX-1根渲染。没有新增DOM或IPC监听，G0保持193/149。

mini窗口控制器使用已有 `load_background_image` command读图，不需要asset协议权限；路径或背景版本变化清空旧图并用请求版本号丢弃迟到结果。SFC独占背景CSS变量与装饰层，documentElement主题仍是原生登记端口，完整表达式白名单仅把原深/浅映射扩展为四主题，不增加写入面。新增测试覆盖图片乱序完成、暗化/配色变量与原通道合并。
