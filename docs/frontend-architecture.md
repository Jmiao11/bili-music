# 前端结构

## 入口与文件边界

主窗口入口是 `ui/app.ts`，由 `index.html` 中唯一的模块标签加载。入口先导入 startup-before-main 初始化窗口控制与动态背景，再求值 main，最后按顺序调用 startAppearance、initializeLyrics、initializeMascot、startMiniPlayerHost。启动调度先初始化窗口控制，再初始化动态背景；两者都在 main 顶层代码之前。

| 文件 | 形式 | 职责 |
| --- | --- | --- |
| sidebar.ts | head 普通脚本 | 侧栏及宽度持久化。 |
| window-controls.ts | ES Module | 导出显式初始化函数，窗口按钮、拖动与缩放。 |
| dynamic-background.ts | ES Module | 导出显式初始化函数，封面配色与曲目事件响应。 |
| startup-before-main.ts | ES Module 启动调度 | 在 main 顶层执行前初始化动态背景。 |
| app.ts | ES Module 入口 | 固定的 main → startAppearance 启动顺序。 |
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

UI 检查有两个独立项目：scripts/typecheck/tsconfig.main.json 的 files 对应 index.html 普通脚本与 app.ts 静态模块图的并集；tsconfig.mini.json 只检查 mini.ts。两者继承 tsconfig.base.json，不让主窗口普通脚本的全局绑定污染迷你窗。主窗口外部接口位于 types/main-window.d.ts，两项目共用 types/tauri.d.ts。新增主窗口脚本后需同步 files；Node 测试会核对 files 与 HTML/模块图。

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

vue-1a 实测安装前 625 个测试（原 622 个与新增 3 个分组守卫），安装后 1 个冒烟测试。新增测试不替换任何业务断言；原特征测试、sourceSlice 历史例外、播放过渡 fixture 和 G0 文件均保持不变。每批仍须实际运行并核对名称、重复次数与哈希，不能直接沿用本次数字。

每个 commit 提交前运行原九项并增加安装后测试：

1. `cargo fmt --all -- --check`
2. `cargo build --workspace`
3. `cargo build --release --workspace`
4. `cargo test --workspace`
5. `cargo test --workspace --release`
6. `node --test`
7. `npm ci`
8. `npm run test:dom`
9. `npm run typecheck`（main 与 SFC fixture 使用官方 vue-tsc；mini/node 使用 tsc）
10. `npm run verify:dist`

基线数量须先实测，不用文档数字替代结果。类型检查 main/mini/node/SFC fixture 均须为零诊断，diagnostics.json 为 {}。G0 必须与 tests/fixtures/playback-startup-installation.json 逐项相同（154 条，首个 trackchange 索引 70），不能为通过检查重录。verify:dist 比较 Windows/darwin 环境产物逐字节一致，并要求缺失普通脚本、模块位置错误两个反例失败。

CRLF 验证：在 %TEMP%\bili-music-verify\ 下，用 `git clone --config core.autocrlf=true --branch <当前分支> --single-branch <仓库路径> <临时目录>` 创建克隆；覆盖未提交候选文件，删除候选中的旧路径；检查 ui/ 清单与工作区相同，全部使用 CRLF；依次运行 `node --test`、`npm ci`、`npm run test:dom`、`npm run typecheck`、`npm run verify:dist`，第一项必须在安装依赖之前。ui/ 数量随已批准新增模块变化，不能固定成旧数量。

CI 一致性：逐条执行 .github/workflows/ci.yml 的 run 步骤；bash 步骤通过 `"C:/Program Files/Git/bin/bash.exe" --noprofile --norc -c` 执行。仅跳过 Linux 系统依赖安装，并说明当前为 Windows。

测试名：分别用 Node 22.18.0、22.23.3 运行完整 `node --test` 与 `npm run test:dom`，导出两组全部测试名，对比实测基线；原有名字必须完整保留并通过，新增名字单列。

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

home.ts 在原 updateHomeModeUi 调用位置挂载一次 store，注入 invoke、计时器与日志适配器；先 subscribe，再显式读取 getState() 完成首屏。既有首页函数作为动作桥接保留，main 的推荐要求写入改走 setHomeHint。home-view.ts 只读取快照并写首页 DOM，不调用 actions/invoke；曲目行由控制器注入现有 createTrackRow，点击通过既有 playListItem 进入队列，队列高亮仍由 core 的 updateQueueUi 写入。renderer 只读与旧状态写入归属均有守卫。

初始化事件、迷你窗同步时机、播放/搜索/资料库的状态结构保持原样。home-characterization.test.ts 先在旧首页上提交并通过，迁移期间保持逐字节相同；home-actions.test.ts 直接导入纯模块，不安装 window/document，不使用 DOM 模拟。批次报告和断言附录保存到仓库外的验证目录，不再提交；PR 描述只保留摘要。

## 搜索状态边界（state-3）

应用 store 由 home 的 getApplicationStore 按原位初始化首次创建，搜索控制器复用同一实例。search-state 定义搜索领域动作与只读快照；没有 DOM 或 Tauri 依赖。search 控制器注入输入草稿读取、上次关键词保存、分页队列协调和曲目交互。search-view 订阅投影只读状态，调用注入交互回调；播放来源高亮和队列计数仍在 core。

首页与搜索分别复制改变的分片。搜索开始、成功、失败和分页开始、完成各提交一次；BV 重置、元数据回填、分区或排序操作分别为同步动作。view 中的修订号保持原有列表重绘时机；状态提交不代表每次都重建列表。搜索与解析忙态分别记录，buttonDisabled/buttonSource 保存原有最后写入者的结果，不采用忙态逻辑或，否则会改变现有按钮行为。

state-architecture 守卫覆盖平台引用、renderer 依赖、搜索提交按钮归属及简单快照别名写入，配直接写入、集合写入和 Object.assign 反例；它是词法守卫，深度只读类型与冻结动作测试补充保护。旧 VM 测试仅更新接线与切片，业务断言和名称保留；state-3 搜索特征测试保持提交时的全部字节。

## 资料库状态边界（state-4）

library-state 负责收藏、BV 索引、歌单、选中项、失效标记、读取错误及共用弹窗 session。selectedPlaylistId 的有效性在动作提交时修正；renderer 不修正状态。loadLibrary 的读失败只发布错误空状态，不发起持久化写回。播放核心通过 markLibraryUnavailable / clearLibraryUnavailable 改变内存标记，原后端命令及错误记录仍在原位置；响度说明通过 openLoudnessModal 动作打开共用弹窗。

三套拖拽位于 library.drags.favorites / playlistItems / playlists：只存 index、playlistId、saving、suppressClickUntil；library-ui 的三个私有 DOM 容器只存 row / target。拖拽结束传入控制器读取的单调时钟值，纯状态层计算 400ms 截止时间；选择器 isLibraryDragClickSuppressed 只读快照。保存成功才替换排序结果；失败保留列表，解除忙态并重新渲染。

library-view 不导入动作、store 工厂、invoke 或 Tauri API，交互只调用控制器注入的回调。节点、弹窗内容引用、动画和既有焦点行为由 renderer 保留；未新增关闭后主动恢复焦点的行为。library-ui 只挂载一次订阅，首屏显式 getState；收藏变更的两种窗口事件仍在持久化结果和渲染之后发出，名称与 payload 不变。禁用分 P / 分 P 保存中已在 state-5 迁入 library 分片，由 changeDisabledPages 动作处理乐观更新与回滚。

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

测试分组由 scripts/tests/groups.ts 约定：tests/ 下、tests/dom/ 外的 *.test.ts 为安装前组；安装后组只有精确登记的 tests/dom/vue-smoke.dom.ts。*.spec.ts、未登记的 *.dom.ts、DOM 目录中的 *.test.ts 均拒绝。守卫遍历仓库测试文件并追踪安装前测试的本地 TS 导入，禁止第三方导入；默认 node --test 不收集 *.dom.ts。test:dom 先核对登记，再显式运行安装后清单。CI 仅在 npm ci 后增加 test:dom，其他步骤不变。

唯一 SFC fixture 为 tests/fixtures/vue/ToolchainSmoke.vue；tests/fixtures/vue/tsconfig.json 继承现有 strict 配置，由 typecheck 调用官方 vue-tsc 检查。测试经 Vite API 编译到系统临时目录，以 @vue/test-utils 在 jsdom 中验证渲染、点击回调与卸载。Vue 插件和 test-utils 在 document 初始化后动态导入，避免 runtime 提前绑定空 document；结束恢复 globals、关闭 jsdom、删除临时产物。types/jsdom.d.ts 仅声明所用 JSDOM 构造、document、DOM 构造器与 close，依据 jsdom 26.1.0 lib/api.js，无 any 或 Window 全局扩展；不生成 SFC 声明，不使用 declare module '*.vue'。

scripts/vue/check.ts 使用 TypeScript AST 检查导入，Vue 包仅允许 scripts/vue/check.ts 的 vue/compiler-sfc 与 tests/dom/vue-smoke.dom.ts 的 vue 类型导入；产品 Vue 位置登记为空。产品 SFC 默认导入目标限 ui/components/；测试默认导入例外仅限 tests/dom/vue-smoke.dom.ts → tests/fixtures/vue/ToolchainSmoke.vue。现有 UI 模块守卫不变，后续试点若改变模块登记须另行审计，不放宽其他模块规则。

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

推进顺序固定为 vue-1a → vue-2a（分P真实 DOM 基线）→ vue-2b（store 读取工具与同步渲染）→ vue-3（分P列表试点）。vue-2b 使用 Vue 公开 render()，必须以真实 DOM 特征测试证明 store action 返回前，DOM、disabled 与焦点已和旧实现一致；不得以普通 Vue 响应式更新默认同步代替验证。Vue 只替代 renderer，读深只读快照、经控制器回调调用 actions；不改 store、命令与控制器逻辑。vue-1b 音量切片例外、vue-1c 播放过渡 fixture 等播放栏迁移时再处理，迷你窗暂不迁移。
