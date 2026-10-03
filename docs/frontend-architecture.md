# 前端结构

## 入口与文件边界

主窗口入口是 `ui/app.js`，由 `index.html` 中唯一的模块标签加载。入口先导入 main，再导入 startAppearance，最后调用一次 startAppearance。

| 文件 | 形式 | 职责 |
| --- | --- | --- |
| sidebar.js | head 普通脚本 | 侧栏及宽度持久化。 |
| window-controls.js | 普通 defer 脚本 | 窗口按钮、拖动与缩放。 |
| dynamic-background.js | 普通 defer 脚本 | 封面配色与曲目事件响应。 |
| app.js | ES Module 入口 | 固定的 main → startAppearance 启动顺序。 |
| page-selection.js | ES Module | 分 P 可用性、随机轮次、合集偏好计算。 |
| track-utils.js | ES Module | 曲目规范化、格式化、播放错误分类。 |
| runtime-api.js | ES Module | 共享 Tauri invoke 引用。 |
| player-dom.js | ES Module | 77 个共享 DOM 引用，保持原查询写法。 |
| player-state.js | ES Module | 播放、搜索、首页、资料库状态与共享 Map / Set / 常量的声明。 |
| playback-policy.js | ES Module | 随机、合集偏好、音频恢复判定与 LUFS 公式。 |
| playback-notice.js | ES Module | 播放通知、定位、私有计时器及 initPlaybackNotice。 |
| playback-diagnostics.js | ES Module | initPlaybackDiagnostics 建立 window 诊断桥。 |
| playback-core.js | ES Module | 加载、恢复、取消、队列与导航、持久化、播放记录 / 缓存 / 响度触发、曲目行与私有标量。 |
| home.js | ES Module | 榜单和 AI 推荐的加载、渲染。 |
| library-ui.js | ES Module | 收藏、歌单、拖拽及共用浮层。 |
| video-pages.js | ES Module | 分 P 查询调度、角标与弹窗。 |
| search.js | ES Module | 搜索、结果渲染、分区与分页。 |
| main.js | ES Module | 组合根：显式导入、原位调用 init、页面级监听和启动尾部，不再导出业务名字。 |
| appearance.js | ES Module | 设置、主题、音量、响度、沉浸页；启动语句位于 startAppearance。 |
| lyrics.js | 普通 defer 脚本 | 歌词显示及事件交互。 |
| mascot.js | 普通 defer 脚本 | 吉祥物及 window.BiliMascot API。 |
| mini-player-host.js | 普通 defer 脚本 | 主窗口与迷你窗的状态、命令同步。 |

head 的平台内联脚本和 sidebar 保持原位；独立窗口的 mini.html、mini.js 不属于主窗口模块图。

## 模块依赖图

箭头方向为“使用方 → 提供方”，下表列出全部直接导入边。runtime-api、player-dom、player-state、page-selection、track-utils 没有导入边。

| 使用方 | 提供方 |
| --- | --- |
| app | main、appearance |
| main | runtime-api、player-dom、player-state、playback-notice、playback-diagnostics、home、library-ui、video-pages、search、playback-core、appearance |
| playback-notice | player-dom |
| playback-diagnostics | player-dom |
| home | track-utils、runtime-api、player-dom、player-state、playback-core |
| playback-core | page-selection、track-utils、runtime-api、player-dom、player-state、playback-policy、playback-notice、library-ui、video-pages、search、appearance |
| playback-policy | page-selection、player-state |
| library-ui | track-utils、runtime-api、player-dom、player-state、playback-core |
| video-pages | page-selection、track-utils、runtime-api、player-dom、player-state、playback-core |
| search | track-utils、runtime-api、player-dom、player-state、video-pages、playback-core |
| appearance | playback-policy、library-ui、playback-core |

core 与 library-ui、video-pages、search、appearance 保留原 main 与页面模块之间的循环；home → core 是单向依赖。页面模块直接从 core 导入业务入口，不经 main 转手，也不导入 main。诊断模块只依赖 player-dom。曲目行留在 core，因为它们使用 core 辅助函数和页面模块，不满足独立叶子模块条件。

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

- 文件头只使用命名导入与带 .js 后缀的相对路径：`import { a, b } from "./x.js";`。
- 导入语句按 module-imports.test.cjs 中的 moduleOrder 排列：page-selection、track-utils、runtime-api、player-dom、player-state、playback-policy、playback-notice、playback-diagnostics、home、library-ui、video-pages、search、playback-core、main、appearance；花括号内名字按字母序。
- 文件尾只有一条 `export { a, b };`，按字母序，只导出被其它模块实际导入的名字。main 无业务导出，使用唯一的空列表 `export {};`；这不允许空 import 或其它模块语法。
- 不使用 default export、内联 export function/const、namespace import、动态 import 或别名 as。
- app 是固定入口例外：先副作用导入 main，再命名导入 startAppearance，然后调用；不增加其它入口逻辑。
- 拆分文件只放声明及注释、允许的归属标量和模块语法；appearance 顶层只放声明，启动语句留在 startAppearance；main 保留组合与启动。

## 新增模块的步骤

1. 确认职责和绑定归属；播放核心、状态写入白名单、命令接口遵守既有约束，不顺手改动。
2. 使用方添加显式静态导入，提供方尾部列表只导出实际使用项；app 启动顺序保持固定。
3. 检查普通脚本边界、循环依赖和声明初始化：不依赖隐式全局，不在求值阶段读取未初始化绑定，不移动会改变取值的初始化。
4. 同步核对拆分文件规则与状态写入白名单；playerState 的写入只允许 core；searchState 允许 main/core/search，libraryState 允许 core/library-ui/video-pages，homeState 允许 main/home。局部同名冲突必须逐处检查并显式记录，不能静默忽略。
5. 调整测试加载方式而非业务断言；运行规定的八项验证、CRLF 克隆三项与原生模块加载测试，再做真实 WebView 手测。

## 测试与守卫

| 文件或 helper | 保护范围 |
| --- | --- |
| helpers/module-syntax.cjs、module-syntax.test.cjs | 允许语法的剥离、行号保持；普通脚本逐字不变，模块非语法行逐字不变；禁止形式抛错。 |
| helpers/module-graph.cjs、module-graph.test.cjs | HTML 普通脚本与静态模块图的并集；递归、循环、缺失文件。 |
| architecture-guards.test.cjs | 标签顺序、全项目词法与函数重名、拆分文件声明规则、状态写入白名单。 |
| scalar-ownership.test.cjs | 顶层 let 的裸赋值归属；排除声明初始化及属性访问。 |
| module-imports.test.cjs、helpers/module-bindings.cjs | 缺失与无用导入、提供方、导入顺序、排序、只导出实际使用项；显式局部同名清单。 |
| appearance-startup.test.cjs | appearance 只有声明，app 固定三条语句。 |
| startup-order.test.cjs | 首个事件接收阶段、main 最后可执行语句、生命周期清单、内联脚本与 defer。 |
| native-module-loader.test.cjs | 原生链接错误、TDZ、事件记录、调用次数及临时环境清理。 |
| playback-notice-init.test.cjs | main 恰好一次调用通知与诊断 init；通知在诊断之后、搜索监听安装之前。 |
| playback-startup-installation.test.cjs、fixtures/playback-startup-installation.json | G0 启动安装序列快照：监听目标/事件/选项、window 属性赋值、Observer 构造与 observe、首个 trackchange 位置；逐项有序相等。 |
| real-module-startup.test.cjs | 真实 16 个模块（含 app）的链接和求值；首个 trackchange 一次、由 main 调用 core 函数派发；appearance 随后安装监听且只启动一次。 |

守卫是针对当前源码的棘轮，不是完整 AST 分析。局部同名清单须人工核对；scalar 守卫不检测解构赋值或 for…of/in 写入，只读 import 另由引擎约束。

按标记切片仍使用 helpers/source-slice.cjs，标记缺失或终点反向会报错。模块语法先剥离并保持行号；转换的逐字核验只允许排除头尾连续空行、尾部保留一个换行，内部切片必须完全相同。appearance 删除的启动调用仅属于本次迁移的核验例外，既有业务执行测试未整文件执行 appearance。

原生加载工具只在系统临时目录写入 type=module 的 package.json 和源码副本。通用 DOM、存储、定时器和 Tauri 桩不代表真实 WebView；IPC 返回永不 settle 的 Promise。工具验证链接、同步求值、TDZ 和启动事件顺序，不能验证真实网络、布局、媒体、IPC 完成回调或平台协议加载细节。Windows WebView2 与 macOS WKWebView 的这些行为仍需手测。

## 类型检查

根目录仅安装开发依赖 TypeScript 7.0.2，精确版本写入 package.json 与 package-lock.json；不设置 package 的 type，不改变 UI 脚本加载方式。检查使用 noEmit，配置和声明都在 ui/ 之外，Tauri 的 frontendDist 仍只包含 ui/。

检查有两个独立项目：scripts/typecheck/tsconfig.main.json 的 files 对应 index.html 普通脚本与 app.js 静态模块图的并集；tsconfig.mini.json 只检查 mini.js。两者继承 tsconfig.base.json，不让主窗口普通脚本的全局绑定污染迷你窗。主窗口外部接口位于 types/main-window.d.ts，两项目共用 types/tauri.d.ts。新增主窗口脚本后需同步 files；Node 测试会核对 files 与 HTML/模块图。

基础配置为 allowJs、checkJs、noEmit，strict:false、noImplicitAny:false，target ES2022、module ESNext、moduleResolution Bundler、moduleDetection legacy，lib 为 ES2023、DOM、DOM.Iterable，types 为空且 skipLibCheck。它保留普通脚本与 ES Module 的现有可见性边界，不把所有文件强制变成模块。

```bash
npm ci
npm run typecheck
```

typecheck 的成功表示诊断与已审查清单一致，不表示零诊断。scripts/typecheck/diagnostics.json 的键是仓库相对路径（使用 /）、错误码、空白规范化后的消息，值是出现次数，不含行号。新增键或次数增加均失败；修复使键消失或次数下降也先失败，要求显式缩减清单，以免以后重新引入已修复的问题。编译器异常退出、缺配置及无法解析的输出均失败。

修复诊断后运行：

```bash
npm run typecheck -- --update
```

--update 只能删除键或降低次数，发现增长不会写文件。审查 diagnostics.json 的 diff 后再提交。--rebaseline 是人工重建模式，可增加诊断，仅在维护者明确授权时使用；仅在明确授权的文件归属迁移等场景使用，不能未经授权新增诊断。默认 npm run typecheck 和 CI 都不调用它，不能用它绕过新增错误。

声明只描述 UI 实际使用的接口；禁止 any、宽泛的 Window/Element 扩展或任意 __TAURI__。无法确定的值用 unknown。invoke 未显式指定类型参数时返回 Promise<unknown>；不能为减少诊断而编造个别命令的返回类型。声明新增或修改时必须核对 UI 使用点和事件派发点，不能为压掉错误虚构类型。

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

Node 自测只使用内置模块和构造的编译器输出，不依赖已安装 TypeScript。CI 在 Windows、macOS 的 Node 测试之后分别执行 npm ci 与 npm run typecheck。TypeScript 通过 optionalDependencies 安装对应平台原生包；本地 Windows 验证不代替 macOS 安装验证，也不代替真实 WebView 手测。
