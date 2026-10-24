# 协作规则

本文件只记录长期规则。功能入口见 `docs/where-to-change.md`，架构与原生端口见 `docs/frontend-architecture.md`，已完成迁移的记录见 `docs/frontend-migration-history.md`。历史文件名不能作为改写现有链路的依据。后续设计说明保存到 docs/design/，不只保留在系统临时目录。

全面 Vue 化已完成；Windows/Mac 发布前全应用回归于2026-10-16完成，对应 master `d8a7f4bc856b1aa7af23ec81d2c84c4bce9cffaa`，Windows watchdog 故障包亦已验证。后续功能修改仍按任务验收；发布时须由用户核对最新 master CI。

## 技术栈与架构

- Tauri v2、Rust Cargo workspace、TypeScript、Vue 单一 `App.vue` 根组件。迷你窗保持独立入口。Vue 3.5.43、Vite 8.3.2、TypeScript 6.0.3、@vitejs/plugin-vue 6.0.10、@vue/test-utils 2.5.1、jsdom 26.1.0、vue-tsc 3.3.12 精确锁定；不增加 Pinia、Vitest 或其他状态库。TS 升级须等 Vue 工具链支持。
- `app.ts` 首先静态导入根挂载模块；先同步首屏挂载，再求值控制器与 DOM 端口。唯一应用 store 在无 DOM 的组合模块创建，根订阅最先安装，随后才能交给业务模块。首页 getter 仍在首次调用时安装首页订阅并首投影。
- 每次 store 提交用完整只读快照、稳定回调与 Vue 公开 `render()` 同步渲染。action 返回前 DOM、disabled、焦点契约必须成立；不能把 nextTick、watch、RAF 合批用作主渲染路径。禁止 Vue 私有调度 API。
- 迷你窗由独立 MiniApp.vue 根组件同步渲染主窗快照及本地显示变化；首次挂载完成后才发出双通道就绪。位置、原生拖动、焦点与标题测量/动画留在控制器。两个窗口分别构建并各自内联Vue，禁止公共运行时chunk改变主入口；根HTML主题/CSS变量是登记的平台端口。
- 子组件只接切片 props、稳定显示模型与回调，不访问 window、__TAURI__、invoke、actions，不订阅 store。未变切片靠结构共享与浅比较跳过。列表高亮只重绘旧、新行，收藏变化只重绘受影响行，纯进度不重绘列表或行。
- store 公开 getState、subscribe（返回取消订阅函数）、领域 actions；subscribe 不立即回调，首屏显式 getState。快照深只读，只复制改变路径；Map/Set 写入新集合。测试开启深冻结，生产不冻结。订阅者异常须报告并隔离，不能阻断其他订阅者及动作后续阶段。
- 状态与纯投影不引用 DOM、window、Tauri 或平台时钟；副作用经适配器/控制器。同步完整阶段提交一次，异步开始、成功、失败分别提交。不提供任意运行期写状态接口。
- 两个窗口的界面全部由 Vue 渲染。Vue宿主内节点只有组件一个写入方，控制器/投影不得写textContent、innerHTML、classList、style、属性或增删节点；原生读取/事件端口通过类型化ref回传，逐项登记于架构文档。焦点、几何测量、滚动、RAF/transitionend、窗口与媒体副作用保持控制器所有权。
- 精确例外：Vue宿主外的唯一audio；html/body的文档级属性、dataset和CSS变量；原生窗口拖动/缩放与指针捕获；控制器的焦点/选择、测量、滚动和observer；不挂载的Image/canvas取色。非受控输入只由组件内部directive/ref端口写入，Key不经props或store。scripts/vue/native-writes.ts按文件和完整表达式检查原生写入例外，新增项须说明理由并配反例；不能以宽泛文件白名单绕过。
- audio 永久在 index.html 的 Vue 宿主外；不得重建、复制或重复监听。不建立第二套播放器。分P列表每次投影整体替换并保留重绘焦点规则；资料库内容按 session.version 替换，同 session 输入框复用，generic 为空。隐藏设置、沉浸页与歌词继续投影，保留 hidden/is-open/aria-hidden 的阶段，不用 v-if/Transition 重写开关阶段。
- 搜索、首页提示、歌词手动搜索使用非受控草稿读写端口；保留各调用方 trim、恢复与分页执行时回读的时机。恢复不发 input、不提交、不记历史；切歌不写搜索草稿。API Key 不绑定任何来自 store/props 的 value。
- 构建与组件测试统一将 __VUE_OPTIONS_API__、__VUE_PROD_DEVTOOLS__、__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ 定义为 false。strict、erasableSyntaxOnly、isolatedModules 等不放宽，不写显式 any 或宽泛 declare module '*.vue'。生产 JS（含 inline）直接 eval/new Function 的 AST 计数均为0。

## 固化的播放、网络与数据链路

- 改取流逻辑前先申请。实际入口是 Tauri command prepare_audio，经 auto/guest/yt-dlp 分流；复用核心 resolve_bilibili_audio_cancellable/resolve_bilibili_audio、既有取消协调与任务身份二次核验。download_bilibili_audio 是旧命令行遗留入口，不是播放器链路。
- 解析只返回直链与元数据，不下载整首、不落盘；播放经随机 token 的 Axum 本地代理，保持域名白名单、Range 透传。访问 B站音频 CDN 必带 `Referer: https://www.bilibili.com`。不在应用内播放视频；看视频经校验 BV 后调用 open_bilibili_video 打开系统浏览器。
- 默认游客身份，不要求 cookie。搜索与 playurl 共用同一个 Arc<GuestPlayurlClient>、WBI 实现与游客缓存，不新建身份或抄缓存。auto 仅在当前任务仍有效且游客真实失败时兜底 yt-dlp；取消不算真实失败，迟到结果不得登记代理或改变当前播放。
- cookies.txt 与 yt-dlp 不依赖 cwd：dev 固定项目根 cookies.txt、tools/yt-dlp.exe，release 固定 exe 同目录。cookie 仅供 yt-dlp 兜底，及搜索游客身份领取失败时的可选 buvid3/buvid4/b_nut 补充；过滤登录态，缺失/损坏不阻断搜索。缺 buvid3 或 buvid4 都按既有 SPI 补齐；不改路径及脱敏错误处理。
- 不重写队列、随机/循环、requestVersion、切歌中断、恢复或失败跳过状态机。自动前进只绑定 ended；迟到的音频事件/失败不得影响新请求，取消不计失败，连续真实失败5首刹车，坏视频即使单曲循环也跳过。提示保持 aria-live。
- 搜索展示列表与播放队列隔离：新搜索只更新展示，不中断播放；点击结果才把对应列表升级为队列。分页隔离旧请求，只有队列属于本次搜索才同步扩展队列/randomRemaining；来源与高亮版本不可混淆。BV、分区、排序及历史记录继续走现有逻辑，不用写搜索框来同步播放。
- 首页榜单固定游客 ranking/v2 主接口、ranking/region 后端兜底，后者时长转秒；均失败只显示重试，不退回搜索。复用游客 client 与内存缓存，显式刷新才强制拉取，不增加定时任务；首页与搜索状态隔离，共用真实队列。
- 收藏按 bvid 去重，歌单/收藏保留版本快照结构与共用队列。JSON dev 位于 .local-data/、release 位于 exe 同目录，不改回项目根触发 dev 重建。保持 tmp/bak/rename 原子写入；不存在返回空，坏文件/版本不支持报错，不能用空数据覆盖。歌单交互不用原生 prompt/confirm；设置导入的 window.confirm 例外保留在控制器。
- 搜索历史 trim、大小写不敏感去重、累计次数、最新置前、上限100，fire-and-forget，不拖慢搜索；坏文件写入报错不覆盖，清空允许写空且不弹确认。其他持久化、缓存、歌词匹配/获取、请求版本沿用既有模块，不在 UI 迁移中改写。
- 保持现有页面作用域、id/class/data-*、视觉与焦点契约，不借重构改外观或全局共享样式。标题栏拖动/双击、8向缩放、最小尺寸、最大化圆角与迷你窗恢复保持现有行为；不恢复原生 decorations。

## 安全隐私与启动

- cookie、API Key、运行时资料库、工具与 .local-data 不提交。测试只用临时目录、合成数据与回环地址，不访问外网业务服务或真实数据目录；明确授权的 GitHub 操作不在此限。
- 日志、错误、诊断、报告不得包含完整播放 URL、cookie、buvid3/b_nut 或 Key。Key 仅作临时 action/command 参数，不进入快照、组件 props、投影或跨窗消息；只显示 Rust 返回的 `••••` 加末四字符。测试连接允许传未保存 Key。备份导出继续剔除 api_key。
- 背景图继续由 Rust 读图缩放后返回 data URL；localStorage 仅保存路径，不用 convertFileSrc，不把原始路径写入 CSS。
- 主窗口隐藏启动；完成同步初始化、平台/外观、窗口控件与侧栏接线后调用一次 main_window_ready，不等网络、歌词、图片或 AI 配置。Rust ReadyGate 与约5秒 watchdog 共用一次性门闩，show 失败不能标记成功；ready 后超时不得弹出已最小化/切迷你窗的主窗，不新增前端 show 权限。
- 启动 error 监听只在启动阶段生效，完成后移除；仅写脱敏的类型、消息、文件名及行列，不序列化事件/错误对象。startup-errors.log 有大小上限，写失败不阻断启动；dev .local-data/、release exe 同目录且被忽略。主 JS 加载/解析失败时只能记录 watchdog 超时。窗口配置、capability、Rust 改动须单项授权。

## 开始工作、提交与临时副本

- 每次开始先 git branch --show-current，核对任务指定分支；不符停止，不自行切换开发分支。核对最新任务基线与工作区，保留已有改动。
- 分步实现并验证，不做一次性全仓重构。每批1–3个 Conventional Commits 中文提交，顺序按任务明确要求；默认按需 test→feat→fix，文档/登记随对应变更，明确要求拆分除外。推送前整理仅限未推送历史，整理前后最终 tree 必须相同；推送后只追加，不改写。
- 只暂存明确授权的具体文件。src-tauri/Cargo.toml 既有纯换行差异忽略、永不提交。禁止 AI 署名、Co-Authored-By 或生成标记。
- 仓库外副本只用本地 git clone/worktree 或基于 git ls-files 复制跟踪文件，不复制被忽略运行时文件。建立后先检查敏感文件是否存在及跟踪状态，不读内容；发现非跟踪运行时文件停止。正常项目工具不能按 tools 目录名批量删除。

## 验收与审批

- 合并前依次全量 node --test、npm ci、npm run test:dom、npm run typecheck、npm run verify:dist；类型零诊断，验证 G0、windows/darwin 产物字节一致及 AST 0/0。改 Rust 才加 cargo fmt --all -- --check、cargo build --workspace、cargo test --workspace；纯换行不算改 Rust。
- 安装前测试及其依赖只用 Node 内置/本地模块；安装后精确登记 tests/dom/*.dom.ts，用 test:dom，不能被 node --test 默认重复发现。优先直接测真实 store/控制器或挂载后的 SFC，不复制产品业务实现。公共 helper 新能力显式选择，默认行为保持。
- DOM 测试在挂载或重渲染后派发合成事件，须使用 `tests/dom/event-turn.ts` 等待下一个真实毫秒，避免触发 Vue 事件时间戳保护；不得修改或绕过该保护。最早一次 macOS“旧搜索测试”失败未复现，如再出现须单独排查，不能直接归因于已修复的冒泡问题。
- 日常仅受影响测试、typecheck 与必要构建，不要求报告。未改冻结文件以 git diff 证明，仅修改/新建的冻结文件报告 SHA。
- 业务断言原文、含义或预期值改变须申请；任何保留断言次数变0立即停止。真实 App 挂载、SFC 扫描、冻结 helper 的纯环境接线预先授权，原断言/预期/执行次数保持，以短表登记；不做常规全量断言次数统计。不能用接线掩盖行为变化。
- 每批 verify:dist 照跑；G0 改动先申请，批准前不改 fixture。申请只列受保护投影是否完全相同、其他变化简述、新条数/首个 trackchange 索引/SHA。播放、请求、trackchange、媒体监听、四项 IPC listen（taskbar-media-control/global-shortcut/mini-player-ready/mini-player-command）、跨窗同步逐条保持；不一致先查原因，不申请掩盖差异。
- 当前 G0 为184/140，Git/LF SHA256 `e7493c60a52764eb31e4b6f0a158d96ee38cca12b87d7ba2513659d1b8be2aff`。新增或重建须存档旧 fixture 到仓库外。
- 变异只针对新写竞态、启动可靠性、安全边界，每处1～2个，在合规仓库外副本执行、恢复。日常 canary 只跑改动守卫/脚本/分组算法对应项；不要扩成每批全量 canary。
- 专项严格验证只针对启动可靠性、Rust、取流/播放状态机、持久化、安全隐私的风险点；普通组件迁移/fixture 登记不触发全套。
- 跨平台完整回归只在指定阶段（F2b、F6、F8）及发布前执行：Node22.18.0/22.23.3 两组测试、CRLF、全部保留守卫 canary、Windows/Mac 全应用手测、分支双平台 CI。CI 代替用户在 Mac 手动运行完整命令；其他批次 Mac 界面手测只在改变平台界面行为时要求。
- 报告放仓库外，正文一页内：改动、验收表、需决定事项、手测清单及 GitHub 操作次数。默认 Windows 清单不超过8项，任务明确给定上限时从其规定。未测不写通过；任务要求用户手测时，须等用户明确“手测通过，允许合并”后，Codex只报告“可合并”，后续合并由用户执行。发布前由用户核对最新 master 远程 CI 与发布前全应用回归均已通过。

## Git 与 GitHub

- 分支命名：按类型使用 `feat/`、`fix/`、`style/`、`refactor/`、`chore/`、`test/`，后接简短英文描述，不再使用 `codex/` 前缀。
- Codex负责本地提交、推送功能分支、只读查看该分支的CI。
- Codex不执行合并到master、推送master、删除分支、创建或合并PR、force push；这些操作由用户执行。
- 用户在本地使用 `git merge --squash` 合并，每批在master上只保留一条提交。
- 每批提交数1–3个；提交信息使用中文Conventional风格，不含任何AI署名或痕迹。
- 只改文档、配置或规则，且不改产品代码和测试的小改动，可以直接在本地master上提交，不建分支；Codex只提交、不推送，由用户检查后推送。
- 涉及产品代码或测试的改动，仍须走功能分支、跑CI和手测。
- 每次推送前先fetch，确认远程目标是本地祖先；首次推送确认同名远程分支不存在。发现分叉、基线不符或非预期改动立即停止，不rebase、不reset --hard、不改remote、凭证或git配置。
- 外部贡献者的PR由用户在GitHub上审查并Squash and merge。仅在用户要求时，Codex可用 `git fetch origin pull/<编号>/head` 在本地获取PR代码，只做只读审查与验收，不评论、不合并。
- GitHub CLI/API仅限只读查看CI，其他操作一律禁止；包括不得重跑或取消CI、手动触发workflow、操作Issue/评论/Release/tag/label及仓库设置。
- 任务书中“手测通过，允许合并”之后的步骤，改为由Codex报告“可合并”，由用户执行合并及后续操作。
