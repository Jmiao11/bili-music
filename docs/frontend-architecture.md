# 前端结构

## 入口与文件边界

主窗口入口是 `ui/app.ts`，由 `index.html` 中唯一的模块标签加载。入口先导入 startup-before-main 初始化窗口控制与动态背景，再求值 main，最后按顺序调用 startAppearance、initializeLyrics、initializeMascot、startMiniPlayerHost。启动调度先初始化窗口控制，再初始化动态背景；两者都在 main 顶层代码之前。

F2a 在上述同步启动完成后调用 initializeMainWindowReady，追加 window 的一次性 DOMContentLoaded 回调；该回调在 sidebar 的 document 接线及原 main 的恢复监听之后发 main_window_ready，不等待网络/图片/歌词/AI 异步结果。head 原平台 inline 和 sidebar 标签保留；inline 最先记录未完成启动期间的未捕获同步 error，发生过错误就不发 ready，交给 Rust watchdog。主窗仅由 Rust 显示，不新增前端 show capability。

| 文件 | 形式 | 职责 |
| --- | --- | --- |
| sidebar.ts | head 普通脚本 | 侧栏及宽度持久化。 |
| window-controls.ts | ES Module | 导出显式初始化函数，窗口按钮、拖动与缩放。 |
| dynamic-background.ts | ES Module | 导出显式初始化函数，封面配色与曲目事件响应。 |
| startup-before-main.ts | ES Module 启动调度 | 在 main 顶层执行前初始化动态背景。 |
| app.ts | ES Module 入口 | 固定的 main → startAppearance 启动顺序。 |
| main-window-ready.ts | ES Module 启动握手 | 同步启动后登记一次 ready；发生启动 error 时不发，Rust 超时兜底。 |
| page-selection.ts | ES Module | 分 P 可用性、随机轮次、合集偏好计算。 |
| track-utils.ts | ES Module | 曲目规范化、格式化、播放错误分类。 |
| runtime-api.ts | ES Module | 共享 Tauri invoke 引用。 |
| player-dom.ts | ES Module | 77 个共享 DOM 引用，保持原查询写法。 |
| player-state.ts | ES Module | 播放请求身份、当前播放分P列表、曲目事件身份，以及共享 Map / Set / 常量的声明；队列字段已迁出。 |
| playback-queue-state.ts | ES Module | 播放队列、来源、索引、循环随机、历史、当前曲目投影与随机分P轮次，以及纯导航动作。 |
| playback-commands.ts | ES Module 控制器 | 统一播放/暂停、上一首/下一首与进度跳转；复现恢复拦截和原提示，经媒体适配器执行操作。 |
| playback-policy.ts | ES Module | 随机、合集偏好、音频恢复判定与 LUFS 公式。 |
| playback-notice.ts | ES Module | 播放通知、定位、私有计时器及 initPlaybackNotice。 |
| playback-diagnostics.ts | ES Module | initPlaybackDiagnostics 建立 window 诊断桥。 |
| playback-core.ts | ES Module | 加载、恢复、取消、队列与导航、持久化、播放记录 / 缓存 / 响度触发、曲目行与私有标量。 |
| home.ts | ES Module | 榜单和 AI 推荐的加载、渲染。 |
| library-state.ts | ES Module | 资料库、共用弹窗会话及三套拖拽纯状态与动作；仅依赖纯类型与曲目工具。 |
| library-view.ts | ES Module | 收藏、歌单、共用弹窗的只读 DOM 渲染；节点与动画留在此处。 |
| library-ui.ts | ES Module | 资料库动作适配、订阅挂载、收藏事件与拖拽 DOM 控制器。 |
| video-pages.ts | ES Module | 分 P 查询调度、角标与弹窗。 |
| search.ts | ES Module | 搜索、结果渲染、分区与分页。 |
| main.ts | ES Module | 组合根：显式导入、原位调用 init、页面级监听和启动尾部，不再导出业务名字。 |
| settings-state.ts | ES Module | 设置、外观与页面会话的纯状态和动作，不保存 API Key。 |
| settings-adapter.ts | ES Module | 存储读写、合集偏好规范化读取及缓存提示计时器。 |
| settings-view.ts | ES Module | 设置、外观与页面会话的只读 DOM/CSS 渲染、焦点及动画。 |
| playback-display-state.ts | ES Module | 媒体观测、进度预览、按钮和 Media Session 投影的纯状态及动作。 |
| playback-display-view.ts | ES Module | 主栏与沉浸页进度、时间、按钮的只读 renderer，以及 Media Session 写入委托。 |
| playback-settings-state.ts | ES Module | 音量、归一化开关、增益与过渡目标的纯状态及动作。 |
| media-adapter.ts | ES Module | 媒体操作和事件订阅适配；目前仅音量写入接入业务。 |
| playback-settings-view.ts | ES Module | 播放设置的只读投影，委托媒体与控件写入。 |
| appearance.ts | ES Module | 设置控制器及原位监听；保留增益过渡调度、存储与沉浸页逻辑。 |
| lyrics.ts | ES Module | startAppearance 之后显式初始化，歌词显示及事件交互。 |
| mascot.ts | ES Module | startAppearance 后显式初始化，模块 API 供外观设置使用。 |
| mini-player-host.ts | ES Module | startAppearance、歌词、吉祥物之后显式初始化；直接调用命令、快照投影、主题订阅与提示动作。 |

head 的平台内联脚本和 sidebar 保持原位；独立窗口的 mini.html、mini.ts 不属于主窗口模块图。

## 构建与开发流水线

前端源码仍是 ui/ 下的原生 HTML、TypeScript、CSS。根目录 vite.config.ts 使用精确锁定的 Vite 8.3.2，以 ui 为 root、./ 为 base，index.html 与 mini.html 为两个入口，输出到 dist。build.target 固定为 esnext，不按平台设置浏览器语法降级目标；modulePreload、minify、sourcemap 均固定关闭，不受 TAURI_ENV_PLATFORM / TAURI_ENV_DEBUG 影响。不启用额外的语法转换插件。Tauri 接入参考 [Tauri v2 的 Vite 指南](https://v2.tauri.app/start/frontend/vite/)。

开发流程为 `cargo tauri dev` → beforeDevCommand (`npm run dev`) → localhost:1420 → WebView；构建流程为 `cargo tauri build` → beforeBuildCommand (`npm run build`) → dist → Rust 编译与前端嵌入。Node/npm 和前端依赖必须先准备好。withGlobalTauri 保持 true，CSP 保持 null，不引入 @tauri-apps/api。

scripts/vite/preserve-html.ts 在开发时映射普通脚本，在 build 阶段：收集两份源 HTML 引用的普通脚本（HTML URL 含 mini.js，对应源码 mini.ts），通过 Node 原生类型擦除后输出到 dist 的原 .js 路径；从 Vite 输出取得模块入口 src 与 CSS href，再从源 HTML 重建页面。这样 head 的内联平台脚本、sidebar、全部 defer 标签及 mini 标签原样保留（普通脚本 URL 保持 .js，插件映射到同名 .ts 源码），动态背景由模块入口内部先于 main 初始化，body 仅保留一个 app ESM 标签。没有 public/ 源码副本。当前页面静态资源只有这些脚本与样式；增加图片等构建资源时需扩展映射并审查产物。

开发服务器保留 HTML 中普通脚本的 .js URL，插件将请求映射到同名 .ts 源码并做类型擦除，不改写这些业务标签。实际 HTTP 请求中，两个页面的 head 都增加一个 `/@vite/client` 模块标签及其缩进/换行。请求 /index.html 时，Vite 8.3.2 还会把以下 URL 规范化为根路径：`./styles.css` → `/styles.css`、`./sidebar.js` → `/sidebar.js`、`app.ts` → `/app.ts`。/mini.html 的业务 URL 不变。这些差异逐项检查、逐项输出；业务标签位置、类型、defer、其他属性与内联内容保持原样。

`npm run verify:dist` 是独立的产物检查，不属于 node --test。scripts/vite/verify-dist.ts 通过 Vite API 在系统临时目录分别设置 TAURI_ENV_PLATFORM=windows / darwin 构建，严格比较两份产物全部 JS、HTML、CSS 的文件清单和逐字节内容，再核对 HTML 引用存在、普通脚本类型擦除后的字节、完整 HTML（只允许模块 src 与 CSS href 的产物替换）及源 CSS 内容（仅忽略换行形式和首尾空白）。正式 HTML 禁止包含 `/@vite/client`。平台环境变量在构建后恢复，两个临时输出目录在结束时删除。

检查复用既有 native-module-loader，按产物 index.html 中外部脚本的顺序执行普通脚本和原生模块，对比 G0 的 154 条启动记录及首个 trackchange 索引 70；内联平台脚本由 HTML 内容比较保护，与现有 G0 口径一致。每次检查还在临时产物中构造缺失普通脚本、模块位置错误两个反例，要求检查失败。随后以临时端口启动开发服务器，实际请求两个页面，严格对比上述开发差异，finally 关闭服务并删除临时产物。它不会创建或清理仓库 dist。

源模块图、VM 切片与既有守卫继续针对 ui/，node --test 仍只用 Node 内置模块，不依赖 node_modules。产物顺序检查补充源码守卫，不能代替 Windows WebView2 / macOS WKWebView 的媒体、网络、布局与 IPC 手测。CI 的 Windows/macOS 均先 setup-node、npm ci、verify:dist，再执行原 Cargo 步骤；发布构建也先 npm ci，以供 beforeBuildCommand 使用。

## 模块依赖图

箭头方向为“使用方 → 提供方”，下表列出全部直接导入边。runtime-api、player-dom、player-state、page-selection、track-utils 没有导入边。

| 使用方 | 提供方 |
| --- | --- |
| app | main、appearance |
| main | search-state、runtime-api、player-dom、player-state、playback-notice、playback-diagnostics、home、library-view、library-ui、video-pages、search、playback-core、appearance |
| playback-notice | player-dom |
| playback-diagnostics | player-dom |
| state-store | 无平台依赖 |
| app-state | playback-queue-state、state-store、track-utils、search-state、library-state、pages-state、settings-state、playback-settings-state、playback-display-state（含类型导入） |
| search-state | state-store（类型）、track-utils；通过注入适配器调用搜索与历史命令 |
| search-view | search-state（类型）、track-utils、player-dom；只读渲染及注入的交互回调 |
| home-view | app-state、player-dom（含类型导入） |
| home | settings-adapter、app-state、runtime-api、player-dom、home-view、playback-core |
| playback-core | page-selection、track-utils、search-state（类型）、runtime-api、player-dom、player-state、playback-policy、playback-notice、home、library-ui、video-pages、search、appearance |
| playback-policy | settings-adapter、page-selection、player-state |
| library-state | state-store（类型）、track-utils；通过注入适配器调用资料库命令 |
| library-view | track-utils、library-state（类型）、player-dom；只读渲染及注入交互回调 |
| library-ui | library-state（含类型导入）、home、library-view（含类型导入）、playback-core |
| video-pages | page-selection、track-utils、runtime-api、player-dom、player-state、playback-core |
| search | search-state（类型）、player-dom、player-state、home、video-pages、search-view、playback-core |
| settings-state | state-store（类型）、page-selection；通过注入适配器读取存储和调用命令 |
| settings-adapter | page-selection、settings-state（类型） |
| settings-view | settings-state、appearance（仅 DOM 类型，不形成运行时依赖） |
| playback-display-state | state-store（仅类型） |
| playback-queue-state | page-selection、state-store（仅类型）、track-utils |
| playback-display-view | playback-display-state（仅类型） |
| playback-settings-state | state-store（仅类型） |
| media-adapter | 无导入边 |
| playback-settings-view | playback-settings-state（仅类型） |
| appearance | playback-settings-state、media-adapter、settings-state、settings-adapter、playback-policy、home、library-ui、playback-core、settings-view、playback-settings-view、playback-display-view |

core 与 library-ui、video-pages、search、appearance 保留原 main 与页面模块之间的循环；home 与 core 通过运行时入口互相依赖，顶层不读取循环绑定。页面模块直接从 core 导入业务入口，不经 main 转手，也不导入 main。诊断模块只依赖 player-dom。曲目行留在 core，因为它们使用 core 辅助函数和页面模块，不满足独立叶子模块条件。

循环中的领域函数只在运行时读取绑定，声明求值阶段不能读取尚未初始化的循环绑定。新模块顶层只放声明、import/export；DOM 引用沿用 player-dom 的顶层查询，invoke 引用沿用 runtime-api。监听安装、Observer 和 window 赋值通过 init 执行。

## 初始化入口与原位调用

main 依次调用 initPlaybackDiagnostics、initPlaybackNotice、initPlaybackSearch、initPastedBvPages、initPlaybackResume、initPlaybackPersistenceAndCache、initPlaybackRecord、initPlaybackAudioIdentity、initPlaybackModes，穿插保留的原监听，不能把这些调用集中到一起。前两项分别来自 diagnostics / notice，其余七项来自 core。

一段原来连续的立即执行语句对应一个 init；main 在原段的位置调用。不连续段不得合并。写入 core 私有标量的函数与监听归 core，声明和写入不能跨文件拆开。只调用导出函数、不需要随私有标量移动的监听留在 main，包括 ended 自动前进、阈值分析调用、保存、音频诊断和页面级监听。pendingSearchRestore 仅由页面搜索恢复写入，留在 main。

## 执行顺序与事件

1. head 平台内联脚本、sidebar。
2. window-controls、dynamic-background。
3. app 模块图：依赖模块完成声明初始化；main 执行事件绑定和启动，最后一条可执行语句派发首个 bilibili-music-trackchange。
4. app 调用一次 startAppearance，安装外观监听并执行原有初始化。
5. lyrics、mascot、mini-player-host；随后 DOMContentLoaded。

首个 bilibili-music-trackchange 派发时，dynamic-background 与 core 的监听已安装；appearance、mascot、mini-player-host 的监听尚未安装。appearance 的监听安装阶段与转换前一致。

core 在加载曲目时仍派发 `bili-track-changed` 供歌词使用；收藏变动使用 `bilibili-music-favorite-change`；appearance 派发 `bilibili-music-viewchange` 和 `ai-config-updated`，由 main 响应。事件名、派发位置和业务函数体未因转换改变。

普通脚本看不到模块顶层名字。跨边界只使用 window 上的显式接口或事件，例如 `window.recordPlaybackDiag`、`window.BiliLyrics`、`window.BiliMascot`；不把模块状态隐式挂到 window。

## 导入与导出规则

- 文件头只使用命名导入与带 .ts 后缀的相对路径：`import { a, b } from "./x.ts";`。
- 导入语句按 module-imports.test.ts 中的 moduleOrder 排列：settings-state、settings-adapter、pages-state、state-store、app-state、page-selection、track-utils、search-state、library-state、runtime-api、player-dom、player-state、playback-policy、playback-notice、playback-diagnostics、home-view、home、pages-view、library-view、library-ui、video-pages、search-view、search、playback-core、main、settings-view、appearance；花括号内名字按字母序。
- 文件尾只有一条 `export { a, b };`，按字母序，只导出被其它模块实际导入的名字。main 无业务导出，使用唯一的空列表 `export {};`；这不允许空 import 或其它模块语法。
- 不使用 default export、内联 export function/const、namespace import、动态 import 或别名 as。
- app 是固定入口例外：先副作用导入 main，再命名导入 startAppearance，然后调用；不增加其它入口逻辑。
- 拆分文件只放声明及注释、允许的归属标量和模块语法；appearance 顶层只放声明，启动语句留在 startAppearance；main 保留组合与启动。

## 新增模块的步骤

1. 确认职责和绑定归属；播放核心、状态写入白名单、命令接口遵守既有约束，不顺手改动。
2. 使用方添加显式静态导入，提供方尾部列表只导出实际使用项；app 启动顺序保持固定。
3. 检查普通脚本边界、循环依赖和声明初始化：不依赖隐式全局，不在求值阶段读取未初始化绑定，不移动会改变取值的初始化。
4. 同步核对拆分文件规则与状态写入白名单；playerState 的写入只允许 core；搜索分片只允许 search-state 动作提交，首页分片只允许 app-state 动作提交；资料库分片只允许 library-state 动作提交；旧 libraryState 只保留 disabledPages / disabledPagePending，写入允许 library-ui/video-pages。search-view 独占搜索提交按钮；main/core/search 通过搜索动作写入，禁止快照直接或别名写入。局部同名冲突必须逐处检查并显式记录，不能静默忽略。
5. 调整测试加载方式而非业务断言；运行下述九项验证、CRLF 四项、CI 步骤、两个 Node 22 版本清单比对及 canary，再做真实 WebView 手测。

## 测试与守卫

| 文件或 helper | 保护范围 |
| --- | --- |
| helpers/module-syntax.ts、module-syntax.test.ts | 允许语法的剥离、行号保持；类型擦除和模块语法剥离保持行号；禁止生成运行时代码的 TS 语法；禁止形式抛错。 |
| helpers/module-graph.ts、module-graph.test.ts | HTML 普通脚本与静态模块图的并集；递归、循环、缺失文件。 |
| architecture-guards.test.ts | 标签顺序、全项目词法与函数重名、拆分文件声明规则、状态写入白名单。 |
| scalar-ownership.test.ts | 顶层 let 的裸赋值归属；排除声明初始化及属性访问。 |
| module-imports.test.ts、helpers/module-bindings.ts | 缺失与无用导入、提供方、导入顺序、排序、只导出实际使用项；显式局部同名清单。 |
| appearance-startup.test.ts | appearance 只有声明，app 固定三条语句。 |
| startup-order.test.ts | 首个事件接收阶段、main 最后可执行语句、生命周期清单、内联脚本与 defer。 |
| native-module-loader.test.ts | 原生链接错误、TDZ、事件记录、调用次数及临时环境清理。 |
| playback-notice-init.test.ts | main 恰好一次调用通知与诊断 init；通知在诊断之后、搜索监听安装之前。 |
| playback-startup-installation.test.ts、fixtures/playback-startup-installation.json | G0 启动安装序列快照：监听目标/事件/选项、window 属性赋值、Observer 构造与 observe、首个 trackchange 位置；逐项有序相等。 |
| real-module-startup.test.ts | 真实 21 个模块（含 app）的链接和求值；首个 trackchange 一次、由 main 调用 core 函数派发；appearance 随后安装监听且只启动一次。 |

守卫是针对当前源码的棘轮，不是完整 AST 分析。局部同名清单须人工核对；scalar 守卫不检测解构赋值或 for…of/in 写入，只读 import 另由引擎约束。

按标记切片仍使用 helpers/source-slice.ts，标记缺失或终点反向会报错。TypeScript 先通过 Node 原生类型擦除，再剥离模块语法并保持行号；转换的逐字核验只允许排除头尾连续空行、尾部保留一个换行，内部切片必须完全相同。appearance 删除的启动调用仅属于本次迁移的核验例外，既有业务执行测试未整文件执行 appearance。

原生加载工具只在系统临时目录写入 type=module 的 package.json 和源码副本。通用 DOM、存储、定时器和 Tauri 桩不代表真实 WebView；IPC 返回永不 settle 的 Promise。工具验证链接、同步求值、TDZ 和启动事件顺序，不能验证真实网络、布局、媒体、IPC 完成回调或平台协议加载细节。Windows WebView2 与 macOS WKWebView 的这些行为仍需手测。

## 类型检查

vue-1a 统一使用 TypeScript 6.0.3，原因是 vue-tsc 3.3.12 暂不支持 TS 7；待 Vue 官方工具支持后全项目统一升级。main 使用根目录官方 vue-tsc CLI，mini/node 使用根目录 tsc，不设独立工具目录。本批切换前后的实际检查清单按 main/mini/node 分别为 154/67/353 个文件，归一编译器标准库安装目录后，内容与顺序均相同；不修改 include/exclude 或任何编译选项。

TypeScript 6.0.3 与 Vite 8.3.2 均为开发依赖，精确版本写入 package.json 与 package-lock.json；package 的 type 固定为 module，Node 脚本和测试使用 ESM，UI 源码的普通脚本与模块边界保持不变。类型检查使用 noEmit，配置和声明都在 ui/ 之外；Tauri 的 frontendDist 为 dist，不包含测试、类型声明或构建配置。scripts/typecheck/tsconfig.node.json 独立检查 Node 脚本和 ESM 测试。

UI 检查有两个独立项目：scripts/typecheck/tsconfig.main.json 的 files 对应 index.html 普通脚本与 app.ts 静态模块图的并集，以及精确登记但不接入入口的 vue/use-app-state.ts、vue/sync-region.ts；tsconfig.mini.json 只检查 mini.ts。两者继承 tsconfig.base.json，不让主窗口普通脚本的全局绑定污染迷你窗。主窗口外部接口位于 types/main-window.d.ts，两项目共用 types/tauri.d.ts。新增主窗口脚本后需同步 files；Node 测试会核对 files 与 HTML/模块图。

基础配置为 noEmit、strict:true、allowImportingTsExtensions:true、erasableSyntaxOnly:true、isolatedModules:true，target ES2022、module ESNext、moduleResolution Bundler、moduleDetection legacy，lib 为 ES2023、DOM、DOM.Iterable，types 为空且 skipLibCheck。它保留普通脚本与 ES Module 的现有可见性边界，不把所有文件强制变成模块。

```bash
npm ci
npm run typecheck
```

typecheck 的成功要求全部项目零诊断，并且诊断清单仍与已审查的空基线一致。scripts/typecheck/diagnostics.json 的键是仓库相对路径（使用 /）、错误码、空白规范化后的消息，值是出现次数，不含行号。新增键或次数增加均失败；修复使键消失或次数下降也先失败，要求显式缩减清单，以免以后重新引入已修复的问题。编译器异常退出、缺配置及无法解析的输出均失败。

修复诊断后运行：

```bash
npm run typecheck -- --update
```

--update 只能删除键或降低次数，发现增长不会写文件。审查 diagnostics.json 的 diff 后再提交。--rebaseline 保留历史 CLI 接口，但零诊断门槛优先，不能增加诊断或绕过错误。默认 npm run typecheck 和 CI 都不调用它，不能用它绕过新增错误。

声明只描述 UI 实际使用的接口；禁止 any、宽泛的 Window/Element 扩展或任意 __TAURI__。无法确定的值用 unknown。invoke 使用共享 CommandMap 推导参数与返回类型，状态工厂仅接收注入适配器；不能为减少诊断而编造个别命令的返回类型。声明新增或修改时必须核对 UI 使用点和事件派发点，不能为压掉错误虚构类型。

现有 Node 守卫继续保留：

| 守卫 | 与类型检查的关系 |
| --- | --- |
| 缺失导入检查 | 与未定义名字诊断重叠，但还固定提供方与显式局部同名清单，继续保留。 |
| 导入/导出语法、排序、无用导入与只导出实际使用项 | 类型检查配置不强制这些项目约定。 |
| 全项目顶层名字唯一、拆分文件声明规则 | ES Module 允许不同模块重名；tsc 不保护本项目的职责边界。 |
| 状态写入白名单、scalar-ownership | 类型正确不代表写入方有权修改该状态。 |
| HTML 脚本清单、启动顺序与 appearance 启动一次 | 类型检查不验证标签顺序、求值时机或事件先后。 |
| 原生模块加载、TDZ 与真实模块启动测试 | 检查运行时链接、求值与调用次数，不能由类型检查替代。 |
| 播放错误契约与业务切片测试 | 保护字符串契约和实际行为，类型检查不覆盖这些断言。 |

安装前 Node 测试只使用内置模块和构造的编译器输出，不依赖已安装 TypeScript 或 Vite。安装后 DOM 组使用 Vue、Vite 与 jsdom。CI 在 Windows、macOS 的 npm ci 后新增 npm run test:dom，其余 run 步骤保持原样。TypeScript 6 使用官方 JavaScript CLI；本地 Windows 验证不代替 macOS 安装验证，也不代替真实 WebView 手测。

## 每批验收口径

- 开发自检：自行反复运行相关测试、typecheck、npm run build，不要求逐次报告。
- 合并验收：每批默认依次运行 node --test（npm ci 之前）、npm ci、npm run test:dom、npm run typecheck、npm run verify:dist。verify:dist 包含当前获批 G0（历史 154/70）、同机 windows/darwin 配置逐字节一致及 eval/new Function AST 计数均为 0；类型检查零诊断；G0 仅按固定格式申请获批后重建。
- Rust：只有本批改动 src-tauri/、src/、Cargo.toml、Cargo.lock 或 Rust 测试时，合并验收运行 cargo fmt --all -- --check、cargo build --workspace、cargo test --workspace（debug）；否则报告“未改 Rust,跳过”。src-tauri/Cargo.toml 的既有纯换行差异不算本批修改，永不提交。
- 测试审计：用 git diff 证明已有测试哪些未改，冻结文件用 SHA256 证明未改；只对本批改过的已有测试文件列旧/新断言原文和逐测试执行次数，包含共享 helper。原测试名和重复次数保留；新增测试单列，数量重新实测。
- 合并变异：选 3～5 个覆盖本批新接线及关键契约，在仓库外副本用全量 node --test 与 test:dom 判定；抓不到须说明是否等价，不改业务断言以通过验证。只运行与本批守卫、登记、helper 直接相关的 canary，每项恢复文件，不跑无关 canary。
- 用户手测：Windows 清单不超过 8 项，写成可照做的步骤；Mac 运行 npm ci && node --test && npm run test:dom && npm run typecheck && npm run verify:dist，改了 Rust 时加 cargo test --workspace。只有改变键盘、焦点、输入法、滚动行为才要求 Mac 界面手测。手测与自动检查分开报告，未执行不得写通过；合并仍须用户明确授权。
- 阶段验收：每个区域迁移完成（资料库在 vue-5c 后；之后四个曲目列表、播放栏）、GitHub 账号恢复后以及任何正式发布前，运行完整十项（fmt、debug/release build、debug/release cargo test、node --test、npm ci、test:dom、typecheck、verify:dist）、CRLF 四项加 DOM、本地 CI 步骤对等、Node 22.18.0 与 22.23.3 两组、全部 canary、相对上一阶段基线的全量断言审计，以及 Windows/Mac 完整手测。
- 阶段 CRLF：core.autocrlf=true 本地克隆，只覆盖跟踪的候选并处理删除/改名；ui 清单与候选相同、全部 CRLF，lockfile 等文本也检查；依次 node --test、npm ci、test:dom、typecheck、verify:dist。阶段 CI 逐条跑 workflow run，Git Bash 用 --noprofile --norc -c，只说明并跳过 Windows 不适用的 Linux 系统依赖安装。
- 严格模式：播放核心（取流、队列、请求版本、失败跳过、播放状态机）、Rust 后端、数据持久化（资料库文件、设置、备份导入导出）、安全隐私（cookie、API Key、诊断）、G0、依赖版本，以及基础设施逻辑改动，每批按阶段验收。
- 常规登记不触发严格模式：新增测试文件；groups.ts、tsconfig.*.json、scripts/vue/check.ts 导入登记表、vueRendererImports、模块清单、架构守卫白名单追加条目，以及对应登记断言更新。仅运行直接相关 canary（新增编译边界跑冷入口 canary）。非冻结 helper 只新增能力、旧调用默认行为不变算常规。
- 基础设施逻辑改动触发严格模式：测试发现/分组算法、helper 默认行为、守卫判定规则、verify-dist 构建验证逻辑、G0 采集/比较逻辑改变。冻结共享 helper 的纯环境接线改动按全面 Vue 化规则预先授权；业务断言原文、预期值与次数必须不变。其他变化按单项停止条件处理。
- 环境接线改动预先授权（含冻结 helper）：挂载真实 App、挂载后的 SFC 扫描等，只要业务断言原文、预期值、次数全部不变即可直接实施并登记。需要改变业务断言原文/含义、G0、未单项授权的 Tauri/Rust，或任何断言次数变0时停下申请。
- 报告正文约一页：改动、验收结果表、偏差例外、手测清单。断言原文、日志、哈希放仓库外附录，正文给路径；远程 Windows/macOS CI 一律“待账号恢复后补验”。
- 区域迁移批次：基线与迁移同批，按需 test（旧实现通过）→ feat（行为不变）→ fix（行为改变需断言授权），默认 1 个、最多 3 个提交，一轮手测。
- 用户 2026-10-12 批准以上规则从 vue-5b 第二提交生效；本批测试改动为常规登记与纯环境迁移，按合并验收，新增 library-view 编译边界跑冷入口及对应守卫条目的 canary，其余 canary 不跑。业务断言授权、冻结文件、G0、安全隐私、Git/合并闸门、临时副本规则均保持。
- 当前实测安装前 578、安装后 271（B2 迁入原特征 10、新增真实 DOM 基线 25），以后重新实测；完整命令和 canary 判据见架构文档。

阶段验收全部 canary 的完整清单如下；合并验收只挑直接相关项。

反向验证仅在仓库外临时副本进行；每项恢复文件并删除新增文件，命令必须非零退出：

| canary | 违规 | 必须失败 |
| --- | --- | --- |
| 1 | ui/ 新增 .js | node --test；npm run typecheck |
| 2 | tests/ 新增 .cjs | node --test；npm run typecheck |
| 3 | UI .ts 加显式 any | npm run typecheck |
| 4 | UI 加新类型错误，如 number 接收字符串 | npm run typecheck |
| 5 | UI 顶层加入不存在 id 的 DOM 声明断言 | npm run typecheck |
| 6 | AudioResponse.audioUrl 从 string 改为 number | node --test；npm run typecheck |
| 7 | 删除 HTML 中 window-controls 普通脚本标签 | npm run verify:dist |
| 8 | 状态模块引用 document（状态守卫上线后启用） | 对应状态架构守卫测试 |
| 9 | 媒体适配器之外直接写入 audio.volume | node --test tests/media-volume-ownership.test.ts |
| 10 | 播放核心直接或通过别名修改队列快照 | node --test tests/playback-queue-architecture.test.ts |
| 11 | 队列状态模块直接调用 Math.random 或读取时钟 | node --test tests/playback-queue-architecture.test.ts |
| 12 | 任一模块改回读写 playerState 的旧请求字段 | node --test tests/playback-request-architecture.test.ts |
| 13 | 请求状态动作读取平台时钟 | node --test tests/playback-request-architecture.test.ts |
| 14 | 播放模块改回读写旧会话字段或 playerState | node --test tests/playback-session-architecture.test.ts |
| 15 | 会话状态动作读取平台时钟 | node --test tests/playback-session-architecture.test.ts |
| 16 | UI 出现未登记的模拟播放控制 .click() | node --test tests/playback-control-architecture.test.ts |
| 17 | 宿主把同步字段改回 DOM 读取 | node --test tests/mini-host-architecture.test.ts |
| 18 | 宿主以外的 classic 脚本（主窗或迷你窗）读取桥接 | node --test tests/mini-host-architecture.test.ts |
| 19 | 桥接声明的 togglePlayPause 签名改为 () => number | npm run typecheck（main 必须失败，恢复后三个项目均零诊断） |
| 20 | 桥接 subscribeTheme 的返回类型改为 number | npm run typecheck（main 必须失败，恢复后三个项目均零诊断） |

测试只使用临时目录与回环地址，不访问外网、不接触真实数据目录。日志、诊断及报告不得输出完整播放 URL、游客身份或 cookie 值；.local-data/ 永不提交。禁止 push、amend、rebase、reset、checkout、switch、stash；提交只用具体文件路径。src-tauri/Cargo.toml 的纯换行差异不提交。

## 应用状态与首页试点

state-store.ts 提供 getState()、subscribe(listener) 与领域 actions；subscribe 不立即回调，返回取消订阅函数。没有通用公开写入口。同步阶段提交后按订阅顺序同步通知，订阅者或异常报告器失败均不能中断其他订阅者和动作。快照类型深度只读；动作复制变化路径，Map/Set 更新必须创建新集合。freeze 选项仅供测试启用，递归冻结对象与数组，并阻断 Map/Set 的变更及原型/回调绕过；正式运行不冻结。

app-state.ts 是应用 store 工厂，本批只有 home 分片。原 homeState 的全部字段迁入 getState().home，另把原 DOM 上的状态文案和按钮状态收进 home.view。content 描述本次阶段需要刷新的内容区域，使用引用变化触发渲染，保留隐藏请求完成时只更新状态条的现有行为。isHomePopular 是纯选择器。状态模块与纯依赖不得出现平台全局、DOM 类型或 Tauri 导入，state-architecture.test.ts 使用正例与反例保护。

home.ts 在原 updateHomeModeUi 调用位置挂载一次 store，注入 invoke、计时器与日志适配器；先 subscribe，再显式读取 getState() 完成首屏。既有首页函数作为动作桥接保留，main 的推荐要求写入改走 setHomeHint。home-view.ts 只读取快照并写首页 DOM，不调用 actions/invoke；曲目行由 track-list-ui.ts 投影到 TrackList.vue/TrackRow.vue，点击通过既有 playListItem 进入队列，高亮由控制器计算并通过只读 props 投影。renderer 只读与旧状态写入归属均有守卫。

初始化事件、迷你窗同步时机、播放/搜索/资料库的状态结构保持原样。home-characterization.test.ts 先在旧首页上提交并通过，迁移期间保持逐字节相同；home-actions.test.ts 直接导入纯模块，不安装 window/document，不使用 DOM 模拟。批次报告和断言附录保存到仓库外的验证目录，不再提交；PR 描述只保留摘要。

## 搜索状态边界（state-3）

应用 store 由 home 的 getApplicationStore 按原位初始化首次创建，搜索控制器复用同一实例。search-state 定义搜索领域动作与只读快照；没有 DOM 或 Tauri 依赖。search 控制器注入输入草稿读取、上次关键词保存、分页队列协调和曲目交互。search-view 订阅投影只读状态，调用注入交互回调；播放来源高亮和队列计数仍在 core。

首页与搜索分别复制改变的分片。搜索开始、成功、失败和分页开始、完成各提交一次；BV 重置、元数据回填、分区或排序操作分别为同步动作。view 中的修订号保持原有列表重绘时机；状态提交不代表每次都重建列表。搜索与解析忙态分别记录，buttonDisabled/buttonSource 保存原有最后写入者的结果，不采用忙态逻辑或，否则会改变现有按钮行为。

state-architecture 守卫覆盖平台引用、renderer 依赖、搜索提交按钮归属及简单快照别名写入，配直接写入、集合写入和 Object.assign 反例；它是词法守卫，深度只读类型与冻结动作测试补充保护。旧 VM 测试仅更新接线与切片，业务断言和名称保留；state-3 搜索特征测试保持提交时的全部字节。

## 资料库状态边界（state-4）

library-state 负责收藏、BV 索引、歌单、选中项、失效标记、读取错误及共用弹窗 session。selectedPlaylistId 的有效性在动作提交时修正；renderer 不修正状态。loadLibrary 的读失败只发布错误空状态，不发起持久化写回。播放核心通过 markLibraryUnavailable / clearLibraryUnavailable 改变内存标记，原后端命令及错误记录仍在原位置；响度说明通过 openLoudnessModal 动作打开共用弹窗。

三套拖拽位于 library.drags.favorites / playlistItems / playlists：只存 index、playlistId、saving、suppressClickUntil；library-ui 的三个私有拖拽容器只存源/目标业务 key 与方向，不跨投影持有行节点。拖拽结束传入控制器读取的单调时钟值，纯状态层计算 400ms 截止时间；选择器 isLibraryDragClickSuppressed 只读快照。保存成功才替换排序结果；失败保留列表，解除忙态并重新渲染。

library-view 不导入动作、store 工厂、invoke 或 Tauri API，交互只调用控制器注入的回调。节点、弹窗内容引用与动画由 renderer 管理；vue-5c 起内容由 Vue 同步投影，关闭返回仍连接文档的触发元素，Tab 使用共享焦点循环，关闭取消待执行 RAF。library-ui 只挂载一次订阅，首屏显式 getState；收藏变更的两种窗口事件仍在持久化结果和渲染之后发出，名称与 payload 不变。禁用分 P / 分 P 保存中已在 state-5 迁入 library 分片，由 changeDisabledPages 动作处理乐观更新与回滚。

library-characterization.test.ts 在旧实现上先提交，通过后保持逐字节不变；library-actions.test.ts 直接导入纯模块并开启冻结；library-architecture.test.ts 保护只读 renderer 与快照别名，state-architecture 同时覆盖新状态模块的平台依赖。修改现有测试需附全部断言原文和逐测试计数：登记类更新单列，源码写法断言替换需行为测试映射，业务断言不可改变或删除；保留断言由正次数变成 0 时立即停止。

## 分P状态边界（state-5）

pages-state 保存分P数量与元信息缓存、每个 BV 的查询阶段和传入的时间、弹窗目标/列表/错误，以及查询版本和开始时保存的状态条文字。缓存数据与输入目标复制后提交，快照深度只读。缓存查询结束后仍恢复第一次查询保存的状态条文字，即使其间被其他模块改写；迟到的旧查询只解除自己的触发按钮忙态，不更新缓存或弹窗。

video-pages 保留 IntersectionObserver、观察/可见节点、缓存查询节点集合、并发计数、队列、300ms 调度时钟、定时器、Promise 和打开按钮回调注册表。查询规则仍为并发 2、可见性优先、缓存优先、失败去重；250ms 单击延迟与双击打开规则不变。pages-view 只读取快照与注入回调，负责角标、弹窗列表、状态条、焦点节点、焦点循环和动画；main 的关闭、Escape 和 transitionend 监听位置不变。

禁用分P属于资料库偏好，存放在 library.disabledPages / disabledPagePending。资料库读取仍只读，不写回空降级；保存开始与完成各发布一次根快照，分P弹窗错误通过根提交同步协调。资料库重新加载不额外刷新已打开的分P弹窗。播放核心只改为读取资料库快照，播放领域结构与导航算法保持原样。pages-characterization.test.ts 在旧实现提交后保持全部字节；pages-actions.test.ts 不安装 DOM，测试中开启冻结。
## 设置、外观与页面会话边界（state-6）

应用 store 的 settings 分片保存主题、强调色、背景元信息及 data URL、三个滑块、取流来源与可用性、缓存设置、合集随机偏好、五项快捷键及录制目标。ai 只保存接口格式、地址、模型、hasKey 与请求阶段；API Key 仅作为动作参数短暂传给命令，不进入快照或 view，命令返回或异常中的参数密钥会被隐去。保存操作在连接测试成功后仍再次读取输入，保留原来的读取时机；ai-config-updated 仍在清空输入、更新提示之后和解除保存忙态之前派发。

settings.session 保存导航页面、占位文案和设置面板开关。renderer 只读快照，版本或对象引用表示原代码需要重写 DOM 的时机；取流选择值使用独立版本，保证用户改动输入草稿后仍能恢复相同的状态值。首屏由控制器显式读取，初始投影不提前写 DOM。主题在原启动调用处应用，三个滑块按原顺序读取并应用，动态主题只清除三个内联属性。背景、缓存、取流、快捷键和 AI 命令通过注入适配器调用，存储键和值格式保持原样。

appearance 保留事件安装位置、MutationObserver、键盘事件解析、背景与设置输入读取、导航事件派发；settings-view 保留 DOM/CSS、焦点和动画。缓存提示计时器留在 settings-adapter，state 仅接收清除回调。playback-policy 每次仍读取存储中的合集偏好，经 settings-adapter 规范化后使用，不改为复用旧快照。迷你窗继续观察原根节点属性，未改变同步时机；音量、响度和沉浸页仍留在原控制器中。

settings-characterization 在旧实现上独立提交，迁移后保持字节不变；settings-actions 直接导入纯模块并冻结快照，逐次序列化 AI 保存与测试的每个应用快照；settings-architecture 保护只读 renderer、DOM 归属及快照别名写入。现有测试的全部断言原文、逐测试与嵌套子测试执行次数保存到仓库外。

## 媒体适配器（state-7a）

media-adapter.ts 封装 src、load、play、pause、currentTime、volume 和媒体事件订阅；工厂只接收媒体对象，不查找 DOM，不在构造时安装监听或操作媒体。取消订阅只移除本次订阅者，保留 play Promise 和媒体异常。契约测试使用普通对象，无真实 DOM。独立适配器提交阶段尚无业务使用，类型通过 Node 契约项目登记；接入时再进入主窗口模块图。

### 音量与响度状态边界（state-7a）

playback-settings-state.ts 保存用户音量、归一化开关、当前增益、过渡目标音量及当前生效音量；不持有媒体节点、RAF 或存储。playback-settings-view.ts 只读投影，先委托媒体写入，再更新滑块；增益变化不会改变用户滑块。三个版本标记保留重复操作的写入时机，初始版本零不抢写首屏。

appearance 保留启动、监听、存储键和值格式及写入位置；RAF 帧号、首帧时钟与取消仍在控制器，250ms 插值不变。拖动先取消过渡，再同步提交用户音量；媒体音量只经 media-adapter 写入。响度查询身份、迟到结果检查、阈值/结束/缓存等待分析触发留在 playback-core 原位，已有增益入口转交动作；说明仍调用已有资料库弹窗动作。其他媒体加载、播放、暂停、跳转和事件安装暂不迁移。

新模块登记：playback-settings-state / media-adapter / playback-settings-view 进入主窗口模块图、类型项目、导入顺序与架构清单；纯状态守卫覆盖播放设置，媒体音量归属和只读投影守卫带反例。

冻结 VM 测试使用 source-slice.ts 的两项精确登记例外（源文件、起止标记、真实模块列表及理由）；未登记调用返回原字节。模块按现有原生类型擦除和模块语法工具读取 ui/ 源码，控制器辅助函数也来自原源码；不复制业务实现。登记表由专门单元测试固定。此例外为过渡措施：播放领域迁移完成、两个测试可更新接线时，改用显式模块接线并删除登记项。逐调用哈希、逐测试断言次数及三项冻结测试破坏反例证据保存仓库外。

## 播放显示与控制边界（state-7b）

playbackDisplay 保存媒体观测的 currentTime、duration、paused、ended、playbackRate 和 isPlaying，用户拖动的 isSeeking，以及进度预览、Media Session 元数据、播放状态和位置信息。未知时长保留原媒体观测，进度投影仍显示零；格式化函数和边界计算与旧实现相同。各类投影使用独立版本，timeupdate 只更新进度控件与系统位置信息，不重建任何列表，也不重绘播放按钮。

appearance 在原监听登记位置调用媒体适配器 subscribe，首次动作时订阅 store 并显式读取首屏。RAF、媒体对象和平台 API 不进入状态。拖动时 timeupdate 继续记录媒体观测但不覆盖预览、不写系统位置；durationchange 和 loadedmetadata 保留原先覆盖预览的行为。change 仅在时长有限时通过适配器跳转，再解除拖动；emptied 在原顺序复位拖动、进度、按钮和系统播放状态。

Media Session 的元数据、播放状态和位置由只读 renderer 委托 media-adapter 的平台适配器写入；原 withMediaSession 保留静默兼容边界。系统操作仍在每次操作时重新观测媒体并读取快照，保留原播放/暂停幂等判断、跳转边界与默认十秒规则。上一首、下一首及播放/暂停继续复用既有按钮 click，恢复捕获监听和所有外部 click 复用位置不变；按钮业务处理仅把实际 play/pause 调用换成媒体适配器。

加载、请求、取消、恢复、队列、失败跳过、记录、缓存、响度分析及任务栏上报仍留在原模块。playback-display-characterization 在旧实现上独立提交后逐字节冻结，显式装载真实状态/view/媒体模块，不新增公共切片 helper 例外。新状态模块进入纯状态守卫、模块图、导入顺序与类型项目；只读 renderer、DOM 写入归属和进度局部重绘另有守卫及行为测试。批次报告、完整断言原文和逐测试计数继续保存在仓库外。


## 播放队列与导航边界（state-7c）

应用 store 的 playbackQueue 保存 queue、queueSource、queueSearchVersion、playlistId（原 queuePlaylistId）、currentIndex、loopMode、shuffle、randomRemaining、history、currentPageIndex、currentDisplayTrack，以及原播放核心私有的 randomPageRound。所有写入经 playback-queue-state 动作；曲目元数据回填复制对应行，禁止修改快照别名。搜索分页回调直接调用 appendSearchQueue，由来源版本决定是否扩展队列及随机剩余项。

纯导航动作处理上一首、下一首、循环、随机和历史回退；分P动作接收当前播放页列表和资料库禁用偏好快照。Fisher–Yates、分P抽取使用控制器传入的随机函数，合集偏好由控制器回调按原时机读取；状态模块不直接访问时钟或平台。playback-core 保留实际媒体操作、提示、请求身份、取消、失败跳过、恢复及记录/缓存/分析触发的原顺序。save_playback_state 仍在原位置组装相同字段，仅把队列读取改为快照。

队列计数、循环/随机按钮和来源高亮仍由原位 updateQueueUi 只读渲染快照；不订阅 timeupdate，不重建列表。main 读取队列快照，资料库通过只读投影保持原高亮字段名称。playerState 只剩 requestVersion、activeAudioVersion、activeAudioUrl、audioActivatedAt、consecutiveResolveFailures、currentPages、lastEmittedTrackIdentity；当前播放页列表是请求上下文，分P元信息缓存仍由 pages 分片持有。

本批旧实现队列特征测试独立提交并冻结。经明确授权，两个历史响度测试改为显式接线，原业务断言保留；其他 VM 测试也显式接入真实冻结队列 store/actions。新增 playback-queue-fixture 仅把旧测试的可变输入与真实 store 接起来，不替代导航实现，不修改 source-slice 或历史自动登记表。旧测试全部断言原文、逐测试次数、接线说明及破坏反例保存到仓库外验证目录。

## 播放请求边界（state-7d）

app-state.ts 的 playbackRequest 分片保存 requestVersion、activeAudioVersion、activeAudioUrl、audioActivatedAt、consecutiveResolveFailures。动作处理版本递增、音频身份失效/激活/替换、失败累加与清零，isCurrent 接收显式版本判断当前请求。时间仍在控制器原调用处读取后传入动作；Promise、取消命令、媒体操作、失败跳过方向、阈值与提示留在原控制器，调用顺序不变。playerState 只保留 currentPages 和 lastEmittedTrackIdentity；恢复、缓存、记录、响度触发和跨窗同步不迁移。

activeAudioUrl 是私有运行时请求数据，不进入 renderer 投影、诊断或跨窗 payload；测试与仓库外日志只输出相等/为空的判断或脱敏结果。应用工厂支持请求分片的正式初始数据，供冻结测试 fixture 构造；没有运行期任意写入接口。请求代码复用已登记的 app-state 模块及纯状态/类型守卫，未增加业务模块和初始化调用。

经本批明确授权，10 个历史 VM 文件仅替换首行导入。新增 playback-request-fixture 在业务函数、事件和命令完成的明确边界接入真实冻结 store/actions，原 source-slice、例外登记表、playback-queue-fixture 不改。每个请求字段的输入/输出同步均有反例；产品代码改回旧字段由请求归属守卫拒绝。该 helper 是过渡件，playerState 整体移除时（state-9 或 Vue 阶段）删除；完整原文断言、逐测试计数、字段同步说明和变异证据保存在仓库外。

### state-8b 迷你窗宿主

mini-player-host.ts 已迁入唯一 app ESM 入口；window-controls 与 dynamic-background 由最先导入的 startup-before-main 调度，确保 main 顶层执行前完成初始化。lyrics、mascot、mini-player-host 在 startAppearance 后按旧顺序显式初始化。删除 bilibiliMusicMiniHost、BiliLyrics、BiliMascot 三个 window 桥接；保留播放诊断全局。宿主直接使用播放命令、收藏命令、快照投影与主题订阅；原发布事件、主题每帧合并、未 ready/关闭时不发送的规则保持。status/notice 已由 playbackMessages 快照提供。G0 只删除三条 window-set 登记，其余 154 条保持原相对顺序，首个 trackchange 索引 70。

playbackDisplay.renderedTrack 记录主栏原写入点的数据，currentTrack 记录沉浸页原 trackchange 的合并数据；buttonPlaying 保留最近一次播放按钮更新值，媒体时间观察不会改变宿主原按钮读值。播放、队列、请求及发送时机不变。mini.ts 保持不变。

桥接暴露七个宿主必需函数（含只发通知的 subscribeTheme，以及提交播放状态文字的 setStatus），Object.freeze 冻结并以 satisfies 校验声明；不暴露 store、actions 或 getState。用户批准在原 G0 的索引 131 新增一条 window-set，其余 156 条逐项相同，首个 trackchange 仍为 70。

新增 canary 17：在 mini-player-host.ts 加入从 #title.textContent 读取同步标题，node --test tests/mini-host-architecture.test.ts 必须失败。原四条宿主点击临时例外移除，五条非播放用途长期例外保留。

## 状态归属收尾（state-9a）

playback-request-state.ts 与 playback-session-state.ts 分别持有请求、会话的类型、初始状态和动作工厂；app-state.ts 仅导入并组装，不提供兼容 re-export。字段、初值、动作与提交时机原样保留，时钟仍由控制器传入；activeAudioUrl 的隐私边界不变。两模块登记到主窗口类型项目、模块清单、导入顺序和纯状态守卫。

搜索待恢复关键词 pendingSearchRestore 属于 search 分片。localStorage 的原读取位置保持不变；setPendingRestore 登记待恢复值，takePendingRestore 同步取出并清空，首次搜索页导航再检查结果与输入草稿，自动恢复不写搜索历史。

canary 13（请求内读取时钟）和 15（会话内读取时钟）的目标分别改为 playback-request-state.ts 与 playback-session-state.ts；判据仍是各自守卫测试失败。新增两项纯状态反例：分别向这两个模块加入 document.title，node --test tests/state-architecture.test.ts 必须失败。既有 canary 保留。
## 播放状态栏与提示（state-9b）

playback-messages-state.ts 持有 status、递增写入序号和 notice 的文字、kind、可见状态与提交序号。playback-messages-view.ts 是两区域文字和显示状态的唯一 DOM 写入方，只读取快照；定位与 ResizeObserver、2000/3200ms 计时器仍在 playback-notice.ts。控制器先提交、同步渲染，再派发 bilibili-music-notice-change；清空空提示仍派发一次。

library/pages 的原提示投影在 app-state.ts 组装层与 playbackMessages 一次提交。分P查询恢复捕获的旧文字，包含查询期间其他模块覆盖后的恢复；原有文案与借用播放状态栏的语义保持。

mini 宿主 status/notice 从 selectMiniPlayerMessages 投影读取，移除两项 DOM 读取例外；发布仍只由原事件与主题通知触发。setStatus 通过冻结且 satisfies 校验的既有桥接提交，state-9c 移除桥接。该历史批次 G0 为 157 条；state-9c 后当前基线为 154 条、首个 trackchange 索引 70。

新增 canary：在 playback-messages-state.ts 引用 document，state-architecture 测试必须失败；其他 ui 模块写 status.textContent 或 renderer 调用 action，playback-messages-architecture 测试必须失败；setStatus 声明改为不匹配返回类型，main 类型检查必须失败。原有 canary 全部保留。

state-9c 登记：startup-before-main.ts → window-controls.ts、dynamic-background.ts；app.ts → startup-before-main.ts、mascot.ts、main.ts、appearance.ts、lyrics.ts、mini-player-host.ts；appearance.ts → mascot.ts；mini-player-host.ts → home.ts、library-ui.ts、appearance.ts、playback-mini-view.ts、playback-messages.ts。主窗口产物不再单独输出五个 defer 脚本，平台字节比较仍覆盖全部实际产物。
新增启动守卫 canary：ESM 控制器顶层执行初始化；重新注册已删除的 window 桥接。旧桥接类型 canary 改为宿主注入端口的签名不匹配检查；缺少 window-controls 标签的 canary 改为缺少其显式初始化调用，仍由 verify:dist 的 G0 拦截。

## vue-1a 工具链登记

根目录精确运行时依赖 vue 3.5.43；精确开发依赖 @vitejs/plugin-vue 6.0.10、@vue/test-utils 2.5.1、jsdom 26.1.0、typescript 6.0.3、vue-tsc 3.3.12。原有其他包版本不变；不引入 Vitest、Pinia 或其他状态库。Vite 8.3.2 的 rolldownOptions、preserve-html、HTML 中 sidebar/inline 与单一 ESM 入口保持原样，只增加 vue() 插件。本批 ui/ 没有 Vue 导入或 SFC，没有产品挂载；运行时继续选用 Vue 默认 runtime-only 入口，模板由插件预编译。

产物比较条件：master 与候选各自使用对应 lockfile 执行 npm ci，在同一操作系统、Node 版本与构建命令下，比较所有文件路径、数量与 SHA256。本批 Windows / Node 22.23.3 / npm run build 的 7 个产物逐字节相同。发生差异必须报告完整清单并停止，不能更新 golden fixture 或放宽守卫。

测试分组由 scripts/tests/groups.ts 约定：tests/ 下、tests/dom/ 外的 *.test.ts 为安装前组；安装后组精确登记 tests/dom/pages-characterization.dom.ts、tests/dom/pages-real-dom.dom.ts、tests/dom/vue-smoke.dom.ts。*.spec.ts、未登记的 *.dom.ts、DOM 目录中的 *.test.ts 均拒绝。守卫遍历仓库测试文件并追踪安装前测试的本地 TS 导入，禁止第三方导入；默认 node --test 不收集 *.dom.ts；登记守卫禁止安装后使用会被默认发现的 *.test.ts。test:dom 先核对登记，再显式运行安装后清单。CI 仅在 npm ci 后增加 test:dom，其他步骤不变。

唯一 SFC fixture 为 tests/fixtures/vue/ToolchainSmoke.vue；tests/fixtures/vue/tsconfig.json 继承现有 strict 配置，由 typecheck 调用官方 vue-tsc 检查。测试经 Vite API 编译到系统临时目录，以 @vue/test-utils 在 jsdom 中验证渲染、点击回调与卸载。Vue 插件和 test-utils 在 document 初始化后动态导入，避免 runtime 提前绑定空 document；结束恢复 globals、关闭 jsdom、删除临时产物。types/jsdom.d.ts 仅声明所用 JSDOM 构造、document、DOM 构造器与 close，依据 jsdom 26.1.0 lib/api.js，无 any 或 Window 全局扩展；不生成 SFC 声明，不使用 declare module '*.vue'。

scripts/vue/check.ts 使用 TypeScript AST 检查导入；Vue 包、产品和测试位置以该脚本当前的精确登记清单为准，包含现有 Vue 基础设施、组件和编译测试。产品 SFC 默认导入仍限 ui/components/；现有分P、资料库及曲目列表岛的边界不得放宽。产品 SFC 默认导入目标限 ui/components/；测试默认导入例外仅限 tests/dom/vue-smoke.dom.ts → tests/fixtures/vue/ToolchainSmoke.vue。现有 UI 模块守卫不变，后续试点若改变模块登记须另行审计，不放宽其他模块规则。

SFC 内容守卫扫描原始脚本 AST 与官方编译后的模板 AST，禁止 window、__TAURI__、invoke、actions 的直接引用或对应字符串属性访问；组件只通过 props 和回调交互。禁止外部 script src。生产产物守卫 scripts/vite/javascript-guard.ts 扫描 JS 文件与 HTML 内联脚本 AST，直接 eval 与 new Function 必须均为 0；不会把注释、字符串或 object.eval() 计为直接 eval。

以下新增 canary 全在仓库外候选副本修改，每项执行后恢复；命令必须非零退出且出现对应诊断或守卫消息。原有全部 canary 继续执行。两类 AST 守卫还含运行时自检，涵盖注释/字符串误报、模板内违规与括号调用的解析路径。

| canary | 外部副本中的修改 | 必须失败的命令与判据 |
| --- | --- | --- |
| Vue 模板字段 | fixture 模板引用 props.missingField | npm run typecheck；TS2339 |
| Vue props | fixture 自引用传入数字 snapshot | npm run typecheck；TS2322 |
| Vue 只读 | fixture 写 props.snapshot.count | npm run typecheck；TS2540 |
| Vue strict | fixture 函数参数无类型 | npm run typecheck；TS7006 |
| Vue 平台调用 | fixture 添加 window.location、window.__TAURI__、invoke 或 actions 调用 | npm run typecheck；类型错误或内容守卫拒绝 |
| SFC 内容独立验证 | fixture 声明类型合法的局部 window/invoke/actions 并使用 | npm run typecheck；必须由内容守卫拒绝 |
| Vue 导入 | ui/app.ts 导入 vue | npm run typecheck；未登记 Vue 导入 |
| SFC 导入 | ui/app.ts 导入测试 fixture | npm run typecheck；未登记 SFC 导入 |
| 产物 eval | sidebar.ts 加入 eval("1") | npm run verify:dist；动态代码生成守卫拒绝 |
| 产物 Function | sidebar.ts 加入 new Function("return 1") | npm run verify:dist；动态代码生成守卫拒绝 |
| 安装前依赖 | 安装前守卫测试导入 vue | node --test tests/vue-toolchain.test.ts；第三方导入拒绝 |
| 测试归属 | tests/dom/ 添加未登记 *.dom.ts | node --test tests/vue-toolchain.test.ts；未分组测试拒绝 |

推进顺序固定为 vue-1a → vue-2a（分P真实 DOM 基线）→ vue-2b（store 读取工具与同步渲染）→ vue-3（分P列表试点）。vue-2b 使用 Vue 公开 render()，分别以真实 DOM 测试刻画显式 render 与响应式订阅的更新边界，记录 keyed 复用与替换时的实际焦点；vue-3 再由显式同步投影与原控制器保证 action 返回前保持旧 DOM、disabled 和焦点契约，不得以普通 Vue 响应式更新默认同步代替验证。Vue 只替代 renderer，读深只读快照、经控制器回调调用 actions；不改 store、命令与控制器逻辑。vue-1b 音量切片例外、vue-1c 播放过渡 fixture 等播放栏迁移时再处理，迷你窗暂不迁移。

## vue-2a 分P真实 DOM 基线

产品 ui/、依赖与 lockfile、G0 和全部 golden fixture 不改。先在旧 renderer 上独立提交 tests/dom/pages-real-dom.dom.ts 的八组特征测试，文件 SHA256（CRLF）为 f786175c81a116c08a434500b1feae3c0ece3216b674fa68c7ab5af8ad31fbab，后续 renderer 迁移时逐字节保留。

经本批用户明确授权，原 tests/pages-characterization.test.ts 的十个测试仅迁移环境与接线，改名为 tests/dom/pages-characterization.dom.ts 以移入安装后组。62 条业务断言调用及参数原文、测试名、逐测试实际断言次数（含共享 helper）全部不变；旧 SHA256（CRLF）3e2da6a8c4654545703418b507665bd61501e615246687efe87ea3ed6361ae68 → 新 8c71baa2e14854474639e517f1b17eec540549afe276cf66b8eb6b26f93c1c8d。完整 diff、逐断言审计及原分P变异复验记录放仓库外报告。

两份分P测试共用 pages-fixture.ts：以真实 ui/index.html 和 player-dom 接线，模块副本按 git ls-files 核对后建立。保留真实 store、actions、pages-state、pages-view、video-pages 与 main 事件监听；IPC 和播放出口沿用记录式端口。可控时钟驱动 250ms 单击和查询调度，RAF 明确推进，transitionend 明确派发；IntersectionObserver、scrollIntoView 和媒体接口只记录平台调用。每次 fixture 独立 window，结束移除监听、清空调度、关闭 window、恢复 globals 并清理临时文件。

真实 DOM 基线覆盖 RAF 前后与焦点优先级、各关闭入口与 transitionend、重绘焦点、原生可聚焦按钮清单、单击/双击/键盘点击、迟到查询与忙态清理、禁用分P先关闭再播放、保存期间 DOM/disabled/焦点同步变化。jsdom 没有布局、真实键盘默认动作或 CSS 动画；隐藏按钮焦点、原生 Tab 顺序、IntersectionObserver 可见性、滚动定位、双击事件时序与 transitionend 必须另行在真实 WebView 手测，不将自动结果当作浏览器验证。

本地验收测试数量为安装前 615、安装后 19；原十个分P从前组移到后组，新增八个真实 DOM 特征单列。两组完整文件清单及 Node 实际 worker 文件发现结果保存在仓库外，确保每个测试恰好属于一组、执行范围不重叠。新增归属反例：把安装后登记路径改成 *.test.ts，node --test tests/vue-toolchain.test.ts 必须非零并出现 DOM test registration must use，原有全部 canary 继续执行。

GitHub 账号暂停期间按 AGENTS.md 的纯本地流程执行，远程 CI 为“待账号恢复后补验”。vue-2b 分别验证响应式订阅与显式 render 的同步边界及焦点实际行为；vue-3 通过同步投影和原控制器保持 action 返回前的旧 DOM、disabled 与焦点契约，按用户 2026-10-11 补充决定，vue-3 及后续批次按纯本地流程开展，远程 CI 待账号恢复后补验。


## vue-2b 读取与同步渲染基础设施

本批从本地 master 872a8a4 建立 feat/vue-render-infra；不访问 GitHub，不接入产品入口。新增 ui/vue/use-app-state.ts、ui/vue/sync-region.ts，由 scripts/vue/check.ts 精确允许 vue 导入，scripts/vue/infra-guard.ts 核对模块清单、只读依赖与求值规则。原模块图、其他模块的语法与导入守卫保持原规则；main 类型项目只增加这两个明确文件，Node 项目登记新增脚本与测试。两个基础设施模块只声明函数及内部 WeakSet，不创建渲染器；冷导入和创建区域时 __VUE__ 均无写入，第一次 update 才出现 Vue 的渲染器信号。

useAppState(reader, selector) 的 reader 类型为应用 store 的 getState/subscribe Pick；调用方实际传入仅含这两个方法的对象，不将完整 store 或 actions 作为 props。首屏显式 getState，选择器使用应用的深只读快照。shallowRef 与 shallowReadonly 保留原快照引用，不做 deep reactive、复制或序列化；稳定选择器结果由 Object.is 比较，onScopeDispose 取消订阅。生产不冻结快照，shallowReadonly 仅保护 ref.value 的写入，深层保护依靠原 DeepReadonly 类型及归属纪律，不能声称阻止强转后的所有运行时写入。

同步边界分别实测：useAppState 订阅在 action 内更新 ref，但 action 返回时 DOM 文本和 disabled 仍是旧值，nextTick 后仅渲染一次；无关领域提交不重绘。相同的测试展示组件经显式 store.subscribe 投影入口调用 region.update(props) 时，文本与 disabled 在 action 内、返回前已更新。vue-3 必须使用这条显式投影路径保持分P行为；时间显示等经单独确认不依赖即时 DOM 的区域才可用普通响应式异步更新，不能把整个分P状态改为异步。

createSyncRegion(host, Component) 使用 Vue 公开 render(h(Component, props), host)。按用户 2026-10-11 补充批准，创建时校验宿主没有子节点；公开 render 不接管非 Vue 子节点，vue-3 由原控制器先清理旧区域，再创建区域。第一次 update 才渲染，重复 update 复用组件，活动区域独占宿主；首次 update 前 unmount 不创建渲染器，已渲染区域 unmount 清空宿主并释放所有权，旧区域再 update 报错，新区域可以重用已释放宿主。keyed 列表移动并保留同一节点时焦点仍在原节点；替换该节点时 jsdom 的焦点落到 body，nextTick 后也不恢复。这两种行为都不同于旧分P重绘回关闭按钮的主动策略，vue-3 仍须在原控制器/投影入口显式恢复关闭按钮焦点并通过 vue-2a 冻结测试；不授权本批调整产品焦点逻辑。

用户在 2026-10-11 明确批准卸载边界：组件 onUnmounted/onScopeDispose 清理 store 订阅和外部监听，宿主清空；外部保留的已移除 Vue DOM 节点仍保留 Vue 事件 invoker，向它派发事件仍会回调，此行为单独刻画。控制器卸载后应释放节点引用，不能把 host 清空等同移除脱离节点的所有监听。开发构建的组件 render 异常向调用者抛出并产生 Vue 告警，经 store 订阅入口则由既有 onSubscriberError 报告；生产构建默认返回并 console.error，未被静默吞掉，但不是可依赖的抛错契约。

构建期三个开关统一由 scripts/vue/features.ts 定义为 false：__VUE_OPTIONS_API__、__VUE_PROD_DEVTOOLS__、__VUE_PROD_HYDRATION_MISMATCH_DETAILS__。Vite 产品配置、原 SFC 冒烟与新基础设施测试共用定义；测试用 Vite 编译并分别刻画开发/生产错误行为，每例建立独立 jsdom window 和冷模块实例，卸载、关闭 window、恢复 globals/console，并删除临时编译产物。测试 fixture 不进入生产包。

新增 tests/fixtures/vue/StoreReader.vue 由官方 vue-tsc 单独验证 useAppState 深只读推导，保持全部 strict/erasableSyntaxOnly/isolatedModules 选项。它只作为精确登记的类型 fixture，不扩大产品或测试默认 SFC 导入例外。新增测试仍属 tests/dom/*.dom.ts，安装前新增两个内置模块架构测试；当前完整数量为安装前 617、安装后 27。原测试名和重复次数保留，两份分P冻结测试及 G0 fixture 逐字节不变，既有业务断言改变 0、删除 0。只更新 main.files 与安装后文件清单两个登记类断言，扫描循环从 102→103 个安装前文件、744→756 个本地导入边；完整原文与逐测试执行计数在仓库外报告附录。

新增反例与变异均在仅含 Git 跟踪文件的仓库外副本执行，结束恢复：

| 反例/变异 | 判据 |
| --- | --- |
| 删除显式 Object.is | test:dom 与全量 node --test 的基础设施守卫失败；Vue shallowRef 自身也按 Object.is 去重，单删判断不产生额外 DOM 渲染 |
| 强制每次 triggerRef 更新 | test:dom 的无关切片渲染次数断言失败，安装前精确导入/比较守卫失败 |
| 遗漏 onScopeDispose | test:dom 的取消订阅与卸载后更新断言失败；安装前组仍通过，不能承担 Vue 运行时验证 |
| update 延迟到 nextTick | test:dom 的 action 内文本/disabled/焦点断言失败；安装前组仍通过 |
| 删除宿主重复创建检查 | test:dom 的独占生命周期断言失败；安装前组仍通过 |
| 顶层 render 创建渲染器 | test:dom 的冷导入 __VUE__ 信号断言失败，安装前求值守卫失败 |
| 写 selected.value.requestVersion / selected.value | npm run typecheck 的 vue-tsc 产生 TS2540 |
| 修改只读 Map / reader.actions | npm run typecheck 的 vue-tsc 产生 TS2339 |

本地十项、CRLF 与双 Node 两组、CI workflow 的适用 run 步骤、原全部 canary、G0 和 7 产物同环境逐字节比较均需完成；远程 CI 为“待账号恢复后补验”。jsdom 的焦点、布局及脱离节点事件行为不能替代 WebView 手测；本批手测确认启动和播放，vue-3 前还需在真实 WebView 核对同步焦点策略。本批等待用户手测与本地合并授权，历史批次的推进上限由用户 2026-10-11 补充决定取消，后续批次按纯本地流程开展。

## vue-3 分P列表渲染

用户 2026-10-11 明确授权本批按纯本地流程执行，覆盖此前停在 vue-2b 的推进上限；不访问 GitHub。本批一个提交，等待新的手测与本地 fast-forward 授权。远程 Windows/macOS CI 待账号恢复后补验；真实 macOS 环境由用户运行测试及 WebView 手测，不能用同机平台配置构建代替。

仅 ui/pages-view.ts 的列表循环替换为 ui/components/PagesList.vue。首个打开投影先清空旧列表，再建立独占同步区域并公开 render；后续投影显式 update，使用递增 key 保留旧整批替换行为，随后在同一流程恢复关闭按钮焦点。打开 RAF、关闭/transitionend、Tab、查询、版本丢弃与偏好保存仍在旧模块。组件只接深只读 modal/集合、当前播放标识和两个控制器回调；复用 styles.css，无 scoped 样式。禁用页播放按钮仍可点击，控制器先关闭再播放。

安装前模块语法只增加 pages-view.ts 的两个精确编译边界登记。业务模块图保持无依赖解释，rendererFiles 单列真实组件与同步基础设施；类型检查显式登记组件。安装前临时冷入口的边界替身只提供模块连接，创建区域立刻抛错，不制造 DOM 或业务成功。安装后 pages-fixture 用 Vite/Vue 插件编译真实 store、控制器、renderer、SFC，使用三个相同的 false 特性开关及 runtime-only；真实生产包 G0 继续核对 154/70。原安装前其他领域测试不得被误写成 Vue 运行时验证。

两个分P冻结测试 SHA256 保持 vue-2a 的值。用户单项批准原 strict-null-runtime 空上下文测试迁入安装后组：第一条 assert.deepEqual(list.children, ["unchanged"]) 适配为 assert.deepEqual(Array.from(list.childNodes, node => node.textContent), ["unchanged"])，其余四条原文、原测试名及五条各一次保持。授权来自 2026-10-11 本任务的用户回复；本批业务断言等价适配 1，删除 0，不能写成改变 0。

新增九个旧 renderer 状态矩阵覆盖空、单页、多页、当前页、禁用页、两种保存项、全部恢复、BV 大小写不同。基线由本地 master 3c21c42 的真实 renderer 配合 jsdom 生成，innerHTML 原文保留；Vue 仅在列表首尾各增加一个不可见空文本 Fragment 锚点，无注释或其他差异。当前安装前 618，安装后 48（包含矩阵父测试及九个子测试、惰性同步投影、完整流程 Vue 警告、禁用按钮接线及冒泡测试、六个 Tab 可见性测试）；两组文件清单、默认 Node 实际发现文件与逐断言计数保存到仓库外。

验证仍按十项、CRLF、两种 Node 两组、CI run 步骤对等、全部 canary 与本批八项变异执行。首次引入 Vue 导致主 ESM 包变化，与 master 的七产物字节一致口径不适用；体积增量报告在外部验证目录。同机 windows/darwin 两种配置分别构建，七产物路径、数量与内容哈希仍须完全一致；AST eval/new Function 均为零。真实 Windows/macOS 手测另核对主题、Tab、焦点、scrollIntoView、RAF、transitionend、单/双击与禁用偏好同步状态，不把 jsdom 结果写成真实 WebView 通过。

vue-3 补充验收：tests/dom/pages-toggle.dom.ts 以原生 click 验证第 1P 禁用/恢复的精确 command、cid=11、单次调用、保存中禁止点击、弹窗保持打开及全部恢复；列表矩阵另直接计数 onToggle 回调，避免控制器的 pending 守卫掩盖重复回调。冒泡观察器区分 @click.stop 的效果；完整打开→禁用→恢复→播放关闭流程不得收集 Vue 警告。

安装前冷入口使用精确登记的编译器边界，不提供业务 renderer 替身；跨越边界先增加全局尝试计数再抛错。node:test afterEach 在真正解析过冷边界的测试结束时断言尝试次数为 0，恢复计数全局属性并注销加载钩子，防止 store 隔离订阅异常使测试空过。边界自身的反例测试显式消费并验证预期的 1 次尝试；真实 DOM 组编译真实源码，不触发此冷边界，冻结测试断言次数保持不变。

补充变异均在仓库外副本运行全量 node --test 和 test:dom：禁用布尔取反错误、cid 改为 page.page、双重 onToggle、删除 @click、删除组件 key 递增、焦点来源读取移到 render 后、清理宿主移到 createSyncRegion 后、删除 .stop；所有要求的非等价变异必须被业务行为测试抓到。冷入口 canary 让现有安装前测试打开弹窗，必须使 node --test 非零退出；恢复后全部通过。

用户 2026-10-11 已取消等待远程 CI 才能推进下一批的阻塞。GitHub 暂停期间后续批次均走本地流程，验收标准不降低；每批合并前的用户手测和 Mac 验证按每批验收口径执行。远程 Windows/macOS CI 待账号恢复后补验；此决定不自动授予手测、合并或发布权限。隐藏的“全部恢复”按钮 Tab 行为另开批次处理，本批保留 keepFocusInPagesModal 及冻结真实 DOM 测试第 69、74 行。

## fix(pages) Tab 隐藏按钮边界

Tab 循环保持原 disabled 排除规则，并排除按钮自身或祖先带 hidden 属性的元素；不读取布局。恢复按钮隐藏、可用、保存中、空列表、关闭及隐藏祖先均由独立 jsdom fixture 验证。用户本批批准两个冻结文件各一条焦点期望和一处起点索引适配；原始 DOM 查询、按钮清单、其他断言、名称与执行次数保留，新 Git/LF 与检出/CRLF 冻结 SHA 及逐断言审计记录在仓库外报告。jsdom 不执行默认 Tab 导航，中间按钮仅验证未拦截且 activeElement 不变；真实 Windows/macOS WebView 手测另行验证前进顺序。远程 Windows/macOS CI 待账号恢复后补验。

## vue-5a/5b 资料库浮层基线

- vue-4 保留给可选的分P弹窗外壳迁移；vue-5a 先在旧 renderer 上建立真实 DOM 基线，vue-5b 再逐区域迁移资料库浮层。vue-5a 不修改 ui/、依赖、lockfile、既有业务断言、分P冻结文件或 G0。
- 安装后新增 49 个资料库测试（结构和时序 19、输入 6、命令路径 24），使用 Vite 编译真实 main、appearance、资料库控制器、renderer 和 store，jsdom 平台桩只记录调用。没有 Tab 陷阱、关闭不返回焦点、组字中间 input 写入、同一 session 输入节点复用均按现状冻结，不据此宣称真实 WebView 验证。
- 下列三个特征测试以及两个专用 helper 作为 vue-5b 冻结基线，迁移时逐字节不改；不改 pages-fixture.ts。若需改变冻结断言或共享接线，先附完整 diff 申请。
- `tests/dom/library-modal-actions.dom.ts`：Git/LF `3accaca75ec841c2effc094ed8decdc80147740e2832a4e15797b63ae561e004`；检出/CRLF `aa14e3c8e72ac62f22759c49524e69985dffe1e183c4b43a65ace3c3f2cf9f67`。
- `tests/dom/library-modal-input.dom.ts`：Git/LF `34c47569c0e23c653adbd9ad9b6cd0c3da4c2d7fc8486409384c32bad6a5b3e7`；检出/CRLF `792b53713f7cb971a7c8b76ad33fbd84e5949fc8bd8079228e1e4ff58392d580`。
- `tests/dom/library-modal-render.dom.ts`：Git/LF `8c81f687d922de920d177a0a66dbe9c8a989018a90ad2f94597b1e107c02bdd2`；检出/CRLF `06a0496abb56d210bd3709e5c944e874a9c70c6c2cf7e9714ec214ee338de979`。
- `tests/dom/library-modal-fixture.ts`：Git/LF `f7c49fbc15c48a3c85050903cd9765d6b3a7fd79662c8028078db91733e8a443`；检出/CRLF `bdd2e3a04a41a784f16e71d973f607d89344fb2a291023df7ab6492ae79754c8`。
- `tests/dom/library-modal-open.ts`：Git/LF `663de181a0261fa96c5aa96defacb2217b3abe96eb1e3f8b576023dfef712a97`；检出/CRLF `8ac3a5772847151a0b4ca772e477f4f75be8bcefb7fd99fa6af96a23b8a0b547`。

## vue-5b 旧资料库特征测试环境迁移授权

- 用户 2026-10-11 授权本批两个提交：先纯测试环境迁移并在旧实现通过，再迁移无输入框内容。原 13 项中 4 项打开 name/delete、choose、name/loudness、favoriteImport，移到 tests/dom/library-characterization.dom.ts；其余 9 项原测试块逐字节保留。此次纯环境迁移覆盖原 library-characterization.test.ts 整文件冻结约束；测试名、assert 调用原文与执行次数不变，不授权等价断言适配。
- 新 helper 复用冻结的 library-modal-fixture.ts，给真实 jsdom 节点提供事件派发与命令完成等待的接线；不制造 DOM/业务结果。旧 core 响度说明两行转发的接线复用真实 library.openLoudnessModal。新旧两组均以真实资料库模块执行业务，编译选项不变。
- 第一提交之后，下列文件作为新的冻结基线，第二提交与 vue-5c 中逐字节不改；vue-5a 五个冻结文件及两个分P文件继续不变。
- `tests/library-characterization.test.ts`：Git/LF `523502093c731e9d50043b878b07d6e2ce54af726196e35c39fa2371932b6e50`；检出/CRLF `68d57d90daaae987469c37cb2b9f29a7678d03df0cca31293581e0e642c1ed35`。
- `tests/dom/library-characterization.dom.ts`：Git/LF `173be8b5cd3b6abbab0437d7ee46e611c8b72956cd33a318e24ef7ef116ae294`；检出/CRLF `c46e72013937d44872e839a29f378e891e47ddcb28d1f1ee097b3d21bc706c5b`。
- `tests/dom/library-characterization-fixture.ts`：Git/LF `64080f496d9ff497474e9c0d1887809a1e13db8962c872f731cac87db2327feb`；检出/CRLF `29ecf6b47276364caa5aacab5225902f3b5cf0df365159c1f9d6b4895767f511`。

## vue-5b 响度与收藏导入测试迁移授权

- 用户 2026-10-12 授权将响度说明单项迁入 tests/dom/library-loudness.dom.ts；仅将 acknowledgeButton.focused 的假节点断言等价适配为 h.doc.activeElement，其他六条断言原文保持，各执行一次。独占 fakeElement/FakeElement 和 loudnessDialogCode 删除，共享 import/helper 保留。
- 一次性扫描另将 tests/favorite-import.test.ts 五项整体迁到 tests/dom/favorite-import.dom.ts，真实 jsdom/Vite/store 替代假的 renderModalContent；测试名、业务断言原文和执行次数保持。移除旧 renderer 两项切片接线，不添加 source-slice 历史例外；library-ui 导入入口的原源码断言继续保留。
- 此次迁移纳入第一提交并在旧 renderer 验证；下列文件及原资料库迁移的三个文件从第一提交起冻结，第二提交逐字节不改。
- `tests/loudness-normalization.test.ts`：Git/LF `cf0218577f0e3b0b62201b4c242a6be13c3fd1aaa9285e09bf72ed09291cfc75`；检出/CRLF `16aca8ad6fdbdb6c81a8a5034dbb38bd440befbe6610b23d6caab26fb6ebcc43`。
- `tests/dom/library-loudness.dom.ts`：Git/LF `6094849e56081cce07798e247b142b489db4dd10283c2304bbf62275ed766061`；检出/CRLF `d796cc416de89362975ca4a96d333602bd5835a103af5c8349e2192e676f3703`。
- `tests/dom/favorite-import.dom.ts`：Git/LF `99b9fc0173a4dca8b7b8ff0ad8948e8541db9e70feef8db95baa4e3cb9870f54`；检出/CRLF `7ac1bf2671356fba761b3fdf206844e622ed86c65b45e147c9ab85d23254ae31`。

## vue-5b 无输入框内容区边界（历史记录，已由 vue-5c 收口）

- vue-5b 当时仅将 delete/loudness/purge 迁入 LibraryModalBody.vue；vue-5c 已迁完其余三种并删除旧 DOM 路径，当前 generic 仍为空宿主，共享 CSS/外壳/action 不改。
- library-view.ts 经精确编译边界使用 createSyncRegion，首次打开 Vue 种类才创建。旧 DOM 清空后创建；切回 DOM/generic 先卸载置空，再 replaceChildren；Vue 持有宿主时不清空。开启的新 session key=version，同 session busy patch，关闭保留当前 key/node，重新打开替换。
- 每次投影显式同步 update。busy 只改 primary.disabled 与外壳“正在删除…”/“正在清理…”；按钮文案保持“删除”/“全部清理”。焦点仍由原 renderer 在 update 后、RAF 前用常量 .library-modal-actions > .secondary-button 处理；组件无 focus、window、invoke、actions。
- 已卸载/被 session key 替换的 Vue 组件回调停用；保留脱离节点原生监听的 Vue 行为不宣称监听已移除。既有共享冻结 helper 不改，新增专用 Vue fixture 只记录真实 region 调用、平台调用与警告，不制造业务结果。
- 9a55058 旧 renderer 十组 innerHTML 存 library-modal-baseline.json；新 innerHTML 完全相同，无注释，Fragment/v-for 的空文本锚点如实登记。组件引用只读 purge 数据/ReadonlyMap 和回调，不接 store 订阅路径。
- 资料库阶段验收及获批四项修复已在 vue-5c 完成；历史 vue-5b 不包含这些后续变更。

## 全面 Vue 化路线与同步根契约（用户 2026-10-14 批准）

E1 已在 master 94b6a6f 本地合并；全应用 Windows/Mac 回归为“发布前待执行”。F1 已审阅并采纳，spike/vue-root 仅保留本地参考、不合并。原“Vue 岛”为最终形态及新增区域必须“首次使用才挂载、隐藏时不投影”的准入结论作废，业务、安全、数据、依赖与本地 Git 闸门继续有效。

### 迁移对象与批次

| 批次 | 迁移对象 | 必须保留的契约 |
| --- | --- | --- |
| F2a | 主窗 hidden 启动、Rust main_window_ready/watchdog；不动 Vue、不退役 head 脚本 | 其他窗口配置、迷你窗恢复、原启动阶段；G0 单项审批 |
| F2b | App.vue 启动根、外壳/侧栏/标题栏、store 组合模块、head 脚本退役 | 先同步挂载再求值控制器；单一 store；根最先订阅；持久化、拖动/双击/resize |
| F2c | 四种曲目列表与歌单目录并入树 | 结构共享、稳定模型/回调、激活/拖拽/计时器、列表投影版本 |
| F3 | 播放栏与状态条 | 同一个 audio、媒体/请求/跨窗顺序；两项 appearance 切片与播放过渡 fixture 按环境接线流程收口 |
| F4 | 页面控件、搜索/推荐草稿、歌单操作栏、设置 | 草稿回读/恢复/组字/分页；隐藏投影；API Key 临时参数边界 |
| F5 | 沉浸页与歌词 | 同一播放状态、隐藏更新、行高亮/滚动/焦点、原匹配及 offset 行为 |
| F6 | 分P/资料库内容并树，删除主窗 createSyncRegion 区域与过渡桥，最终 G0 | 强制替换与 session key、disabled、同步焦点、浮层动画、脱离节点回调清理 |
| F7（可选） | 独立迷你窗 | 独立窗口生命周期与主窗同步；不阻塞主窗 F6 收口 |

### 十条实施规则

1. 主窗最终为单一 App.vue，启动同步挂载；F2a 只准备隐藏启动。中间批次的旧区域桥须精确登记所有权与退场批次，F6 后主窗不再创建独立 createSyncRegion。迷你窗独立。
2. 主更新只用公开 h/render；每次 store 提交以该次完整 DeepReadonly 快照和稳定控制器回调 props 同步 render 一次，action 返回前完成 DOM 投影。不得用 nextTick、watch 调度、微任务或 RAF 合批作为主更新；原动画和平台每帧合并保留原边界。
3. 根订阅必须先于所有业务订阅安装，初始显式 getState 渲染；以嵌套提交反例证明旧外层快照不会最后覆盖新快照。store 算法、异常报告与 actions 不改，不建第二个业务 store。bootstrap 初始模型与唯一 store 接线须验证，不重复运行动作。
4. 子组件只收必要切片、标量和固定回调；不向普通子组件传整个根快照，不在 render 中复制不变切片、重建 rows/回调或动态 slot。按原依赖/投影版本缓存，实测无关提交的 render 次数和节点身份。组件不访问 window/DOM 查询/Tauri/invoke/actions；必要节点经类型化 ref 回调交给控制器。
5. audio 只创建一次，禁止条件卸载、随曲目变 key 或重绑媒体监听。业务事件种类、请求身份、trackchange 接收阶段、媒体监听、四项 IPC listen 与跨窗同步相对顺序保持；每区域一次性交接 DOM 与事件所有权，不保留双入口。
6. 设置、沉浸页、歌词常驻，保留隐藏期间数据和 DOM 投影。hidden/is-open/aria-hidden/transitionend、焦点和滚动阶段保留，不统一改 v-if。草稿经领域读写端口，组字/BV/恢复/分页阶段不变；API Key 只为临时动作参数，不进入快照、日志、普通投影或跨窗 payload。
7. G0 重建申请固定为：(a)播放、请求、trackchange、媒体监听、taskbar-media-control/global-shortcut/mini-player-ready/mini-player-command 四项 IPC listen、跨窗同步的受保护投影新旧逐条对比，必须完全相同；(b)其余新增/删除/移位逐条列出原因；(c)新条数、首个 trackchange 索引、SHA256；(d)旧 fixture 的 SHA 与原内容存档仓库外。投影不一致时不得申请，先报告原因；批准前不得修改 fixture。154/70 为历史基线，新基线只在批准后登记。
8. 环境接线重建预先授权：fixture 改为挂载真实 App、静态 HTML 扫描改为扫描挂载的真实 SFC、冻结 helper 中仅涉及环境接线的修改，只要业务断言原文、预期值、执行次数全部不变，直接实施并用一张表登记文件、旧/新接线、受影响测试及次数。内部结构与登记断言按既有分类处理，不借此重录业务期望。必须停下申请的只有：业务断言原文或含义变化；G0 重建；Tauri 配置/capability/Rust 改动（任务已单项授权的除外）；任何保留断言次数变为 0。
9. 新根模块/SFC/冷入口/类型项目按精确文件登记，不放宽 strict、类型擦除、组件边界和默认导入白名单。测试发现、helper 默认行为、守卫逻辑、verify-dist/G0 算法变化仍走严格模式完整阶段验收；普通登记按原规则跑相关 canary。环境授权不免除逐断言审计与阶段验证。
10. hidden、Rust ready/watchdog、head 退役分批验证故障。F2a 已单项授权 main visible:false（含 macOS 同步）、main_window_ready 与约5秒一次性 watchdog、相关前端启动握手/契约登记；无前端 show 新权限，其他配置与业务不改，G0 仍单项申请。后续批次、业务断言、合并/发布不因此自动获权；每批最多3提交，验收→仓库外报告→用户手测并明确允许合并→核对后本地 fast-forward。

原三个滑块每次 input 保存、清空搜索历史不确认、Key 临时参数等行为继续保留。已完成 B1/B2/资料库/分P的历史基线与 SHA 继续有效，不能因本路线自动删除。精确冷边界、Vue/模块/写入守卫、组件清理、测试分组、eval/new Function 为0、windows/darwin产物逐字节一致继续保护当前实现；按对应批次逐项替代区域登记。远程 Windows/macOS CI：待账号恢复后补验。

## vue-5c 输入类内容迁移（feat）

- LibraryModalBody.vue 渲染除 generic 外全部六种资料库内容；generic 先卸载并保持空宿主。旧 createNameField/createLibraryButtons/renderModalContent 删除，不保留两条 renderer 路径。每次投影公开 render 同步更新，session key 保持原契约。
- 名称输入不用 v-model：mounted 初始化值，watch 仅在只读 props 的名称改变时同步比较并写 DOM value；input 包括组字中间事件逐次回调。链接不绑定 value，外部链接不投影。Enter 阻止默认后原生 click 主按钮；禁用时无效。
- 初始 focus/select 与 focusName 由原 renderer 在 update 后用 .library-name-field:last-of-type input、.library-name-field:first-of-type input 常量选择器执行；组件无 focus、window、actions、invoke。choose 歌单名文本插值，is-added/aria-disabled 保持。
- 获用户本批授权，把 vue-5b 两项双路径过渡测试改为全部 Vue 内容与 generic 宿主独占/惰性创建；其余冻结测试在 feat 中逐字节不改。原静态十状态保留，1b71b27 旧 renderer 七个输入类状态追加到 library-modal-baseline.json。
- 本批两提交为 feat（行为不变）→ fix（四项预先获批修复），fix 后资料库阶段验收；本节不会提前授予合并权限。

## vue-5c 阶段 A 完成与焦点修复

- 资料库六种非 generic 内容已由 Vue 同步渲染，generic 保持空宿主；阶段 A 自动验收完成，用户已于 2026-10-12 确认 Windows/Mac 完整手测通过，fd1c4c4 已本地 fast-forward 合并，远程 Windows/macOS CI 待账号恢复后补验。
- ui/focus-trap.ts 为分P与资料库共用的 Tab 循环；仅在 is-open 时生效，包含 button/input/select/textarea/非 -1 tabindex，排除 disabled 及自身/祖先 hidden，aria-disabled 仍可聚焦。两个分P冻结文件逐字节不改。
- 打开时记录当前焦点；关闭时仅向仍连接文档的触发元素以 preventScroll 返回焦点。choose 请求期间 submitChoose/createAndAdd 都忽略重复调用，主按钮 disabled，歌单按钮仍不设置原生 disabled。关闭取消未执行的 RAF，RAF 前 Escape 仍不关闭。
- styles.css 的 settings-mask 使用 opacity/pointer-events，settings-panel 使用 transform（3896–3926 行），没有 visibility:hidden/display:none，因此初始 focus/select 保留 update 后、RAF 前的时机。
- 用户预先批准修复 1–4 的冻结断言变化；另单项批准 library-characterization 的 opener 前聚焦 createPlaylistButton 接线。其余业务断言与冻结共享 helper 不变。旧 SHA 保留作为历史基线，以下是本批更新后的冻结基线：
- `tests/dom/library-modal-actions.dom.ts`：Git/LF `f9e473b6a8da948023c5aa3b33797f9d832ec8d9786e895446b515c4827daf3e`；检出/CRLF `188bb1f29ea9fbda16d14cceca90dc6bd527b61c006259f47ab238352cf1caab`。
- `tests/dom/library-modal-render.dom.ts`：Git/LF `263b469bd42c195af1581de547066f98f50021051f7fa0410d084efa36a1d473`；检出/CRLF `84f2d67ceca287585a3425929be70cc8198ef109ac7cf94ea9270310d7070ed5`。
- `tests/dom/library-characterization.dom.ts`：Git/LF `823c62b8a8ce64e471f97b351bd78881d237851adc9b03ece073c09226f40a5e`；检出/CRLF `df0bc0a8a7c79b1964d5a0b0e091809f220635a5775fe9e78b950fe2ffc5618f`。
- `tests/dom/library-modal-inputs-vue.dom.ts`：Git/LF `39606e62c92dfc2edb847ac2f3def71f0a4098da082231bce1d350d6c480eeb1`；检出/CRLF `4b22f621287f255a39a487ce4c63eb6896e14591aac0185cf854e87593efcba8`。
- `tests/dom/library-modal-focus.dom.ts`：Git/LF `f2316fa53755bce930ca390c6a9f159b331bbb59359defb3d4f4dfe8770333ed`；检出/CRLF `f81cadb9ace7049f728034d02262b687f85eafa4566872faae003b72ce362e57`。
- 阶段 A 最终内容与 generic 宿主测试 `tests/dom/library-modal-vue.dom.ts`：Git/LF `bf1b2783dfb3214f17e9d1b38b7ac8d4a65459847f308bdb4d9ac1d77503d08d`；检出/CRLF `313d9c1234375b4cfcc239d74c140246bc1d7a705417f335758afacaccb710cc`，后续作为冻结基线。

### B1 首页与搜索真实 DOM 基线

首页榜单、首页推荐、搜索列表先在旧 renderer 上建立真实 DOM 特征测试。原首页八项、搜索七项与恢复五项迁入安装后 jsdom，业务断言保持。分P与资料库冻结文件、共享 helper 不变。失效标记保持原投影时机：首页仅在内容提交/重绘时读取，搜索无标记。资料库阶段 A 用户已完成 Windows/Mac 手测并批准本地合并 fd1c4c4。

B1 test 当前实测安装前 588、安装后 173；新增冻结文件与 Git/LF、检出/CRLF 哈希见 AGENTS.md 的 B1 节。原二十项 125 个断言位置的逐测试执行次数保持，三条变更仅为假 DOM 到真实 DOM 的等价读取。

## B1 首页与搜索 Vue 曲目列表

- TrackList.vue + TrackRow.vue 负责首页榜单、首页推荐及搜索行的内容、角标、收藏态、高亮与失效标记。外壳状态文字/重试/分页状态仍由旧投影维护；共享样式不改。组件只读 props/回调，不读 store，不访问平台或聚焦。高亮由控制器按旧 queueSource/queueSearchVersion 条件计算。
- 控制器显式同步 update，先比较已提交列表、高亮结果、角标、收藏及已采集失效映射；50 次无关资料库字段提交不调用列表 update。首次歌曲或骨架 li 才创建，空列表卸载并保留 :empty；G0 154/70 不变。
- key 为已提交列表代号 + 精确 BV + 重复序号；新查询成功提交后更换代号，等待期间保留已显示行。元数据/高亮/角标原位修补。用户已批准搜索翻页保留已有行、焦点与观察状态，替代旧整列重建；其余行为不变。
- bindTrackActivation 原接口与 Vue 回调共用 createTrackActivationSession；250ms、双击取消、detail=0 立即播放及真实按钮为 pageModalOpeners 键保持。Vue 不额外 addEventListener；已脱离行的已安排播放计时器不取消。IntersectionObserver observe/unobserve 由控制器经回调 ref 执行，dataset.pageCountBvid 属于控制器，修补不删除。
- 用户 2026-10-12 确认失效标记保持旧时机：搜索无标记；首页只在原内容提交/重绘时采集，失效映射单独变化不更新现有标记。实时更新留给独立修复。
- vueRendererImports 精确登记 track-list-view.ts 的 TrackList.vue/sync-region.ts 与 TrackList.vue 内的 TrackRow.vue。后者使分P冻结 fixture 依现有登记完整复制子组件；冻结 helper 与发现算法不改。
- 本批用户单项批准 library-modal-vue.dom.ts 惰性创建测试的四条统计断言仅按 libraryModalBody 宿主筛选，预期仍 0/1，执行次数 1、1、4、1 不变；其他业务断言不改。原阶段 A SHA 留作历史，新冻结基线如下。
- 最终实测安装前 588、安装后 206；test 提交新增旧实现基线 24，迁入原特征 20；feat 新增 Vue 合约 33（含 25 状态 HTML 对比）。第一提交六个冻结文件在 feat 中逐字节不变。用户 2026-10-13 已确认 B1 手测与 Mac 验证通过，0b4a87e 已本地合并；远程 Windows/macOS CI 待账号恢复后补验。
- `tests/dom/library-modal-vue.dom.ts`：Git/LF `af69af6553d774100d2bbef9b9605a8f1f10998a67c5c13a1e4c74182dc88b21`；检出/CRLF `8fc257ceee889ee80ae83ec5a1679feda238f97bd9710930b8741a130363e103`。
- `tests/dom/tracks-vue.dom.ts`：Git/LF `25ca1c3597f2653caac4b59d4452db7d9716137a36a0bb5e3e4cc2abb19d2b81`；检出/CRLF `2b7db6c44e379e2c5d52d96829afe75ecdd3133ab3d87fd40227432bd3a60568`。

## B2 收藏与歌单真实 DOM 基线

- B1 已由用户 2026-10-13 确认 Windows 手测、Mac 验证及 Enter/翻页焦点补测通过；4047996、0b4a87e 已本地 fast-forward 合并，master tree 为 3cc5c5765fe172ecbf2866ec506000db283e8128。远程 Windows/macOS CI 待账号恢复后补验。
- 用户批准拖拽方案 1：源/目标保存业务 key，视觉 class 由只读 props 同步投影；业务 drags/saving、400ms 抑制、保存成功提交与失败保留原顺序保持。不暂停区域投影，不改变交互。
- test 提交旧实现新增三种列表真实 DOM 基线 25 项；原 library-characterization 九项整体迁入 library-lists-characterization.dom.ts，native list drag handlers 单项迁入 library-drag-null.dom.ts。所有断言原文/参数/次数保持；其他 strict-null-runtime 测试块原文不变。未改共享冻结 helper、不加 sourceSlice 历史例外。
- 新 helper 编译真实跟踪 UI/Vue 源码，独立 jsdom/可控时钟/事件/RAF/观察器；平台桩只记录调用。拖拽命令桩按 favorites.rs:84–106、playlists.rs:35–57/157–185 的真实返回构造。21 个旧 HTML 状态保存为 library-lists-baseline.json，覆盖空、封面、标记、角标、高亮和文本转义。
- test 当前实测安装前 578、安装后 241；阶段 B 迁移与完整阶段验收尚未完成。用户另单项批准 library-modal-vue.dom.ts 剩余一条 create/unmount 比较仅统计浮层宿主，将随 feat 修改并审计；此 test 提交不改该文件。
- 下列文件为 B2 第一提交冻结基线（Git/LF；检出/CRLF），feat 中逐字节不改；分P、资料库与 B1 的冻结 helper/测试不改，单项授权例外另记。
- `tests/dom/library-lists-fixture.ts`：`b0e86c829e9a8dd49a021dd67365f5d183e8f6774cf0b6fa66d29dc8a5a75457`；`e49b0d1b5797ba7eadf389ce3bfa982702626a9dc35060ec18b24b1f8914a3da`。
- `tests/dom/library-lists-characterization.dom.ts`：`f312ba52ab0fadade06b518ed5de5f96357d03eeae718714c25d301d568d2f1b`；`10f36f125a4bc030712c587a007818485a47ca09f2083af55b0dd9ee1d853226`。
- `tests/dom/library-drag-null.dom.ts`：`b7526c117d1d1f56272fbb3948dbf65e30f5b8bc30672142900345db69d50086`；`4878d7b70766426b78fe8b2331358e174a39d2b4b3a98db17c4cd79c838cf5e5`。
- `tests/dom/library-lists-baseline.dom.ts`：`1eedf3a249373c8e4333475ac53d1e7dc91d7c6f002c44caed8f333534d2853d`；`657ffe1e188f0c64878ce0d83d91990cba6326e06c5d8ce403effeda1e3d5d82`。
- `tests/fixtures/vue/library-lists-baseline.json`：`31fab98bdd6df99c805dcbdfc4e97d6da38a10636bfdd5b0600e2200b385c812`；`e4576a87414deb52de757cdbc5e9d44700eb49c2d6f8483f96eef2c91726a8dd`。
- `tests/strict-null-runtime.test.ts`：`6c5ac7873844e6e0f43ddb75e320325e72a90bdade5414d060ebae031246485e`；`fdb4602a992a855e6125db0bcab1605645c394c9097cc9cdfd4f52a7582769bf`。

## B2 阶段 B 曲目列表迁移完成

- 收藏与歌单曲目复用 TrackList.vue/TrackRow.vue，歌单目录由 PlaylistList.vue 渲染；操作栏作为 C1 已取消后的保留项，共享样式、依赖、Rust 与持久化动作不改。阶段 B 自动验收完成，用户已于 2026-10-13 确认 Windows/Mac 完整手测及 Mac 阶段命令通过，9e97368 已本地 fast-forward 合并；远程 Windows/macOS CI 待账号恢复后补验。
- 三个投影先比较相关输入，50 次无关提交 update 为 0；收藏 key 为精确 BV + 重复序号，歌单曲目 key 增加歌单 id，卡片 key 为歌单 id。拖拽顺序由 Vue 按 key 移动，业务计时、观察器与状态机仍在控制器。
- 用户批准源/目标业务 key 与方向驱动拖拽 class，不跨投影保存拖拽行节点；保存中防重、失败保留原顺序、400ms suppressClickUntil、原内容刷新结束拖拽的规则不变。观察器 dataset.pageCountBvid 继续由控制器管理。
- 删除 B1 的 WeakSet 过渡机制、旧行 factory、全 document 角标/收藏/高亮写入及孤立 escapeText。bindTrackActivation 仅供冻结测试与兼容的保留接口，产品不再调用；它与组件共用激活会话，兼容按钮仅按登记集合更新角标，不恢复全局查询。未取消已脱离行的播放计时器。
- 启动时空列表不创建区域；异步资料库加载得到内容时可创建隐藏页列表，第一次有内容才创建，变空即卸载并保持 :empty。21 状态 innerHTML 与旧实现相同，仅非空 Fragment 存在两个空文本锚点；Vue 警告为 0；G0 154/70 不重录。
- 第一提交 e070c18 新增基线 25、纯环境迁入 10，六个冻结文件在 feat 逐字节不变；feat 新增 Vue 合约 30。最终实测安装前 578、安装后 271。新增 PlaylistList 编译边界、模块与 Vue 导入逐项精确登记；测试发现与守卫判定算法不变。
- 用户单项批准 library-modal-vue.dom.ts 剩余一条 create/unmount 断言两侧都限定 libraryModalBody；相等语义与 assert 数量不变，旧/新各执行 1 次；其余冻结业务断言不改。以下为新增或获批更新的冻结基线（Git/LF；检出/CRLF）：
- `tests/dom/library-lists-vue.dom.ts`：`4ba5e29a6a26d8986ff91766a20282dc9162a0d5fc5f6e556a5e15a35c0b2223`；`8209c762fefe973bd91d28f39d3299cccc8404677e19c625fd5d024767a37b4f`。
- `tests/dom/library-modal-vue.dom.ts`：`06a0f7b4bca551d11eaa9925caa8e6d01061eddfb8b32d54f14173d6185e690b`；`8fa4b4f26548e48a456f8151984bc34290c3748e79abc76488cfffceae9d5083`。
