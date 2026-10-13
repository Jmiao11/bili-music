技术栈:Tauri(Rust 后端 + 网页前端);取音频以免登录游客直链为主、yt-dlp 兜底;目标打包成单个 exe

架构：Tauri v2 + 原生 HTML/JS + Cargo workspace 复用核心库；

硬性约束:请求 B 站音频 CDN 必须带 `Referer: https://www.bilibili.com`;

默认取流与搜索均走免登录游客方案、不需要 cookie；cookie 仅作 yt-dlp 兜底取流、及搜索游客身份失败时的可选补充；cookie 文件永不提交；

运行路径与错误日志已固化：`cookies.txt` 和 yt-dlp 的定位不得依赖当前工作目录；dev 固定读取项目根目录的 `cookies.txt` 与 `tools/yt-dlp.exe`，release 固定读取 exe 同目录的对应文件；该 cookie 绝对路径仅供 yt-dlp 兜底取流使用；搜索已免 cookie，仅在游客身份获取失败时才读同一路径作可选兜底（详见搜索条款）；`cookies.txt` 与 `tools/` 均已加入 `.gitignore`，不得提交；解析失败时 dev 终端与前端 console 都会打印真实错误；后续不要重写这套路径解析与错误日志逻辑；

取流链路已固化：真实播放取流入口为 Tauri command `prepare_audio`（`src-tauri/src/main.rs`），按 `auto` / `guest` / `yt-dlp` 三档分流；yt-dlp 兜底解析复用核心库 `resolve_bilibili_audio_cancellable` / `resolve_bilibili_audio`（`src/lib.rs`）；`download_bilibili_audio`（`src/lib.rs`）是早期命令行下载验证的遗留函数、返回本地文件路径，不是当前播放链路入口，不得据此回退到先下载再播放；后续必须复用上述链路，不得重写取流逻辑；

播放方式：后端通过 Axum 本地流代理在线播放，使用随机 token 并透传 `Range`；`resolve_bilibili_audio` 只解析音频直链和元数据，不下载、不落盘；后续不得回退到“先下载整首再播放”；

播放队列与播放控制已完成：队列状态机在 `ui/main.js`；后端取消协调层在 `src-tauri/src/main.rs`，新解析会终止旧 yt-dlp，且旧解析在登记代理 URL 前会二次核验当前任务身份；自动前进只绑定 `ended`，事件层已加请求代号保护；不要重写这套逻辑；

自动连播解析失败跳过已完成：当前视频解析失败时自动跳到下一首；使用 `requestVersion` 区分真实解析失败与用户主动切歌造成的中断，被取消的旧请求不计入失败；连续失败 5 首触发刹车并停止自动跳过；单曲循环遇到坏视频也会跳过；继续复用阶段 6 的请求代号保护，迟到的失败结果和音频事件不得影响当前歌曲；提示统一走 `aria-live` 状态条；后续不要重写这套失败跳过逻辑；

搜索已增强并验收：搜索走 `wbi/search/type`，WBI 签名实现见 `src-tauri/src/wbi.rs` 并由搜索与 playurl 共用，不要重写；`search_videos` 支持 `page` 参数并复用原搜索接口与 WBI 签名，command 形状未改；搜索已免 cookie：搜索的游客 buvid 来源复用 `prepare_audio` 正在用的同一个 `Arc<GuestPlayurlClient>`（`guest_cookie_header()`），不新建实例、不抄缓存副本；搜索永远优先游客身份，仅在游客身份领取失败时兜底 `cookies.txt`，且兜底只取 `buvid3` / `buvid4` / `b_nut`、过滤 `SESSDATA` 等登录态；缺失或损坏的 `cookies.txt` 不导致搜索失败；游客身份补领改为“缺 `buvid3` 或 `buvid4` 都走 SPI 补齐”（修复无 cookie 首搜返回 `v_voucher` 的问题）；搜索接口与前端行为不变；已解耦“搜索展示列表”与“播放队列”——`searchState.results` 只管右侧展示，`playerState.queue` 只管真实播放；关键词搜索只更新展示列表、不中断当前播放、不重置播放队列；点击搜索结果才通过 `playSearchResult` 将当前展示列表升级为播放队列并切歌；右侧高亮按 `queueSearchVersion` 判断来源避免错位；前端滚动到底会自动加载下一页，新旧搜索用 `requestVersion` 隔离，旧分页结果不得追加到新搜索；分页加载更多按“播放队列是否来自本次搜索”决定是否同步扩展播放队列与 `randomRemaining`，否则只扩展展示列表；BV 直接播放仍主动切歌；无更多结果显示“没有更多了”；已移除点击播放时污染搜索框的逻辑，`loadCurrentTrack` 不再写 `searchKeyword`；这套搜索免 cookie、搜索分页、展示 / 播放队列解耦与搜索框隔离逻辑不要重写；

搜索音乐子分区 tab 已完成并验收：搜索页已新增 6 个音乐子分区 tab——全部 `tids=3` / 原创 `28` / 翻唱 `31` / VOCALOID `30` / 演奏 `59` / 电台 `267`，默认“全部”；`search_videos` 加可选 `tids` 和 `order`，白名单仅 `totalrank` / `click`，默认 `totalrank`，`tids` / `order` 一并进入 WBI 待签名参数并复用 `src-tauri/src/wbi.rs`，不要改 WBI 算法；交互已固化：有关键词时 tab 作为分区过滤并传 `tids`；无关键词点 tab 用 `order=click` 拉该分区热门，内部使用 `keyword="音乐"`，不写搜索框、不记搜索历史；切 tab 会 bump `requestVersion` 并复用现有新旧搜索隔离，当前 `tids` 存入 `searchState` 供分页复用；普通关键词搜索不传 `order`，行为不变；后续不要重写这套分区 tab、分页复用与搜索历史隔离逻辑；

首页音乐飙升榜已完成并验收：后端在 `src-tauri/src/ranking.rs` 提供 `RankingClient`，并通过 Tauri command `get_music_ranking(forceRefresh)` 对外；主接口固定走 `ranking/v2?rid=3&type=all`，该接口游客可用、`duration` 已是秒、不需要 WBI；主接口失败后仅在后端内部兜底 `ranking/region?rid=3&day=3`，且需把 `duration` 从 `m:ss` 转秒；若两者都失败，前端仅显示“拉取失败，点击重试”，不退回搜索兜底以保持榜单语义；请求复用同一个 `Arc<GuestPlayurlClient>` 游客身份与同一套 `Referer` / `User-Agent`，不新建 `buvid`、不读 `cookies.txt`；缓存放在 `AppState` 内存中，同一运行期内非强制刷新直接复用，刷新按钮显式走 `forceRefresh`，不加定时任务；前端 `homeState` 与 `searchState` 严格隔离；点击榜单某首通过 `playListItem` 进入现有播放队列，`queueSource='ranking'`、`queueSearchVersion=null`，完全复用现有队列 / 切歌中断 / 失败跳过逻辑，不新建第二套队列；加载态显示骨架屏；这套首页榜单的数据来源、游客身份复用、内存缓存、队列接入与失败语义不要重写；

搜索历史已完成并验收（本轮仅记录、可清空、暂不展示不使用）：`src-tauri/src/library.rs` 已新增 `record_search_history` / `get_search_history` / `clear_search_history`；`search-history.json` 复用 `.local-data/` / exe 同目录的既有路径策略与原子写入方案；记录结构固定为 `{ keyword, searchedAt, count }`；写入前做 `trim`，空串不记录，按大小写不敏感去重，重复搜索执行 `count += 1`，最新记录置前，总量上限 100；前端记录方式固定为 fire-and-forget：搜索发起后异步发射、不 `await`，失败仅 `console.warn`，绝不拖慢或中断搜索主流程；坏文件降级已定：`record_search_history` 遇到损坏文件返回错误且不写入、不覆盖坏文件，`clear_search_history` 允许直接写空；设置二级页已提供“清空搜索历史”入口，按当前实现直接执行，不弹确认；搜索历史数据仅为后续 LLM 策展预留；这套搜索历史的数据结构、路径策略、原子写入、前端 fire-and-forget 接入与坏文件降级逻辑不要重写；

收藏 / 歌单已完成并验收：数据层在 `src-tauri/src/library.rs`（独立模块，非 `appearance.rs`），通过 Tauri commands 提供收藏增删（`toggle_favorite` 按 `bvid` 去重）与歌单全套 CRUD（新建 / 改名 / 删除 / 加歌 / 移歌）；两套独立 JSON 文件 `favorites.json` / `playlists.json`，均带 `version` 字段（为迁移与导入导出预留），存快照 `{ bvid, title, uploader, thumbnailUrl, durationSeconds, addedAt }`；路径策略已固化：dev 下资料库文件放项目根的 `.local-data/` 子目录、不放项目根本身——因为 `cargo tauri dev` 会 watch 项目根，把项目根下的 `playlists.json` / `favorites.json` 写入误判为源码变更、触发反复 rebuild；release 下仍放 exe 同目录；`favorites.json` / `playlists.json` / `.local-data/` 均已加入 `.gitignore`；后续不要把这两个运行时数据文件改回项目根；写入安全已完成：原子写入（tmp + bak + rename，已处理 Windows rename 不能覆盖已存在文件的情况）；读文件降级已完成：文件不存在返回空列表，JSON 损坏 / 版本不支持时返回错误、前端显示错误空状态且绝不用空列表覆盖坏文件；播放接入已完成：收藏 / 歌单 / 搜索三者共用同一套 `playerState.queue`，点击收藏或歌单某首通过通用入口 `playListItem` 升级为播放队列并切歌，完全复用现有 `playSearchResult` / `loadCurrentTrack` / `prepare_audio` 链路；`queueSearchVersion` 仅搜索来源设值、收藏 / 歌单设 `null`，故搜索列表不错位高亮；收藏 / 歌单页用 `queueSource` 判自身高亮；未新建第二套队列、未碰切歌中断 / 失败跳过 / 随机循环；UI 已完成：收藏页 / 歌单页替换原占位入口，沿用「午夜黑胶」规范；所有歌单操作（加入歌单 / 新建 / 改名 / 删除确认）均为自定义玻璃浮层，不用浏览器原生 `prompt` / `confirm`；新建 / 改名做空名与重名校验；删除动作保持中性灰阶、不引入第二种强调色；本轮未做拖拽排序（押后）；相关文件：`src-tauri/src/library.rs`、`ui/index.html`、`ui/main.js`、`ui/appearance.js`、`ui/styles.css`；这套收藏 / 歌单的数据结构、路径策略、原子写入、播放接入与浮层交互不要重写；

阶段 8 游客取流已接入真实播放链路：`guest_playurl` 与 yt-dlp 支持三档运行时切换：`auto`（默认，游客优先 + yt-dlp 兜底）、`guest`（强制游客）、`yt-dlp`（强制老方案），切换状态不持久化；游客 resolve 输出对齐 `StreamAudioInfo`，复用现有 Axum 代理与 `src-tauri/src/wbi.rs`，未改代理路由、`Range` 透传、`ui/main.js` 播放队列；自动模式下只有“当前请求仍有效 + 游客真实失败”才会 fallback 到 yt-dlp，被切歌取消的旧请求不得触发 fallback，fallback 后的 yt-dlp 结果同样受请求代号/二次核验保护；首播实测同视频 yt-dlp 12.79s vs 游客冷启动 1.83s / 热态 0.54~0.91s，第三步自动默认实测约 1.28~3.60s（含直链探测/冷态波动）；切歌中断、自动下一首、失败跳过在游客方案下均兼容；后续不要重写这套接入方式，也不要删除 yt-dlp 老方案；

已知观察项：游客方案曾偶发一次代理上游 502（疑似 CDN 偶发），后续未复现；暂不处理，正常使用若发现偶发卡顿再评估是否加取流重试；

界面重构已验收：界面已重构为「午夜黑胶」深灰阶风格（去渐变、去英文装饰标签，强调色仅用于播放态）；设计稿与规范在 `design/` 目录；侧边栏已精简，本地音乐仍仅作占位，收藏 / 歌单已由收藏 / 歌单条款接管；搜索框已合并并支持 BV 自动识别；主题为深色 / 浅色 / 背景图三档，已整合原文字模式；设置浮层包含主题、背景图、毛玻璃模糊 / 不透明度 / 背景暗化三滑条、取流方案；自定义背景继续使用 Rust 读图缩放后返回 data URL，`localStorage` 只保存图片路径，不使用 `convertFileSrc`，不得把原始本地路径直接写进 CSS；底部播放条已加音量控制，循环 / 随机改为图标，窗口最小宽度为 1080；相关样式与外观逻辑集中在 `ui/styles.css`、`ui/appearance.js`、`src-tauri/src/appearance.rs`，未改取流、播放队列、切歌中断、代理、搜索、WBI；这套视觉与设置结构不要重写；

UI impeccable 系统级视觉重构已完成并验收：首页、搜索页、收藏页、歌单页已用 impeccable 做系统级视觉重构，样式均锁在各自页面作用域（`#view-home` / `#view-search` / `#view-favorites` / `#view-playlists`），不得为这些页面继续改全局共享样式（`.track` / `.tracklist` 通用列表、播放条、侧栏、全局 token、浮层共享样式）；视觉语言统一为序号列 + 深灰列表面板 + 黑胶锚点 + hover 层次，沿用「午夜黑胶」（深灰阶、`#FB7299` 仅用于播放 / 激活态），不引入第二强调色、渐变、硬分割线、过大头部；背景图主题不额外压暗，仅保证灰色次要文字可读；重构仅改 `ui/styles.css` 及少量 `ui/index.html` 纯展示结构，未改 `ui/main.js` / `ui/appearance.js` 任何逻辑，未改任何现有 `id` / `class` / `data-*` 把手；后续 UI 调整必须沿用“页面作用域内改、不碰现有把手与全局共享样式”的方式，不要重写这套视觉；

自定义无边框标题栏已完成并验收：`src-tauri/tauri.conf.json` 主窗口设 `decorations:false` 去 Windows 原生标题栏，同时保留 `resizable:true` / `minWidth:1080` / `minHeight:600` / `shadow:true`；`src-tauri/capabilities/default.json` 已新增 `core:window` 的 `close` / `minimize` / `is-maximized` / `toggle-maximize` / `start-dragging` / `start-resize-dragging` 权限；窗口控制逻辑独立在 `ui/window-controls.js`，不接入、不改动 `ui/main.js` / `ui/appearance.js`：三个按钮调用 `getCurrentWindow()` 的 `minimize` / `toggleMaximize` / `close`，最大化后切换还原图标；拖动与双击最大化共存方案已固化为标题栏空白区 `mousedown` 立即调用 `startDragging()`，同时用时间与坐标手动识别双击触发 `toggleMaximize()`，按钮区排除，不使用 `data-tauri-drag-region`；8 个透明 resize 热区调用 `startResizeDragging`，保证无边框后仍可缩放；最大化时切 `data-window-maximized` 去圆角避黑边；标题栏高度 34px、深灰阶、关闭按钮 hover 才显危险态；标题栏 z-index 低于沉浸页、高于 app shell；后续不要重写这套窗口控制，也不要把 `decorations` 改回原生标题栏；

阶段 7.5 已实现沉浸式封面播放页：全屏覆盖层与底部播放条共享同一个 `<audio id="audio">` 和同一套播放状态，不是第二套播放器；包含封面大图 + CSS 镜面倒影，封面使用 `referrerpolicy="no-referrer"` 避免防盗链，歌词区仅留白显示“暂无歌词”占位，不接任何歌词来源；已实现“在 B站打开” command（`open_bilibili_video`），后端校验 BV 格式后通过系统默认浏览器打开 B 站页面，不嵌 iframe / WebView；本阶段仅显示层 + 跳转，未改取流、播放队列、切歌中断、代理、搜索、WBI；后续不要重写这套沉浸页与跳转逻辑；

浏览器不能直接播,要后端做流代理并透传 `Range`;

默认音频模式只拉 DASH 音频轨(省流、支持后台/息屏播放);封面始终取视频缩略图,与音频流无关。不在应用内播放视频;需要看视频时通过「在 B站打开」跳系统浏览器(见阶段 7.5),不嵌 iframe / WebView。

代理端点要有域名白名单；

协作纪律:**分步实现,每步必须可验证,先做(阶段 0 首个里程碑:输入 BV 号→命令行能取到音频直链)再往下走;不准一次性重构整个项目**;

改动取流逻辑前先停下来跟我确认；

# 长期协作与状态迁移规则

## Vue 工具链与推进决定

- 精确依赖：运行时 vue 3.5.43；开发依赖 @vitejs/plugin-vue 6.0.10、@vue/test-utils 2.5.1、jsdom 26.1.0、typescript 6.0.3、vue-tsc 3.3.12。Vite 保持 8.3.2；不引入 Vitest、Pinia 或其他状态库。
- 全项目统一 TypeScript 6.0.3：vue-tsc 暂不支持 TS 7，待 Vue 官方工具支持后再统一升级。main 由根目录官方 vue-tsc CLI 检查，mini/node 由根目录 tsc 检查；不建 tools/vue-typecheck。strict、erasableSyntaxOnly、isolatedModules 等选项不得放宽，不生成 any 声明，不用宽泛 declare module '*.vue'。
- 安装前组沿用 node --test；安装后组使用 npm run test:dom。scripts/tests/groups.ts 精确登记安装后文件并核对所有测试归属，安装前组及其本地依赖不得导入第三方包。安装后统一使用 tests/dom/*.dom.ts，禁止登记会被 node --test 默认发现的 *.test.ts；当前包含原十个分P特征、八个真实 DOM 基线、一个 SFC 冒烟测试、八个 Vue 基础设施测试、一个获授权迁移的空上下文测试及九个列表矩阵子测试（含一个父测试）。
- Vue 导入仅按 scripts/vue/check.ts 的精确文件与包名登记；产品 SFC 默认导入目标限 ui/components/，测试例外限登记的基础设施与 tests/fixtures/vue/ToolchainSmoke.vue。Vue 基础设施仅精确登记 ui/vue/use-app-state.ts 与 ui/vue/sync-region.ts；vue-3 仅由 pages-view.ts 导入 PagesList.vue 与 sync-region.ts，第一次打开分P弹窗才创建同步区域；use-app-state.ts 仍不接产品；资料库内容及 B1 首页/搜索曲目行按各批精确登记同步挂载，收藏/歌单行及歌单目录按 B2 精确登记同步挂载。StoreReader.vue 只登记为类型检查 fixture，默认导入例外仍只限原冒烟测试。组件不得访问 window、__TAURI__、invoke、actions，只经 props 与回调交互；生产 JS（含内联脚本）直接 eval 与 new Function 的 AST 计数必须均为 0。
- 推进顺序：vue-1a → vue-2a（分P真实 DOM 基线）→ vue-2b（store 读取工具与同步渲染）→ vue-3（分P列表试点）。分P使用 Vue 公开 render()；vue-2b 分别刻画响应式订阅与显式 render 的同步边界及焦点实际行为；vue-3 必须在 store action 返回前保持旧 DOM、disabled 与焦点契约，不能默认普通响应式更新同步。
- useAppState 只接收 getState/subscribe reader，返回 shallowReadonly(shallowRef)；选择器返回稳定引用或标量，继承 store 的 DeepReadonly，Object.is 未变化不写入，作用域释放取消订阅。它同步更新 ref，DOM 默认到 nextTick 才更新。vue-3 的分P同步投影必须显式调用 createSyncRegion.update(props)，不能以订阅响应式更新替代；render 后由原控制器同步处理焦点，Vue 不自动恢复替换节点的焦点。
- createSyncRegion 只用公开 h/render，首个 update 才渲染，宿主独占，卸载后 update 报错。按用户 2026-10-11 补充批准，创建时要求并校验空宿主，首次 update 前卸载不创建渲染器；vue-3 由原控制器先清理旧区域再创建区域。卸载清空宿主并由组件 onUnmounted/onScopeDispose 清理 store 订阅和外部监听；Vue 保留在被外部持有的脱离节点上的原生监听必须如实刻画，不宣称全部移除。开发 render 异常会抛出，store 订阅边界仍按现有机制报告；生产默认 console.error。
- 构建与组件测试统一将 __VUE_OPTIONS_API__、__VUE_PROD_DEVTOOLS__、__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ 定义为 false。
- vue-1b（音量测试切片例外）与 vue-1c（播放过渡 fixture）的债务在 E1 按需评估；播放栏不 Vue 化，当前仍有冻结调用方，保留历史切片登记与过渡 fixture，G0 和行为不变。迷你窗暂不迁移，主题、强调色、毛玻璃、透明度和暗化设置继续沿用现有逻辑。

本节规定后续批次的工作纪律；上文项目安全与固化链路约束继续有效。当前 TS/ESM 架构与完整验收命令以 `docs/frontend-architecture.md` 为准，历史文件名不能作为改写固化链路的依据。

## 开始工作与提交

- 每次开始工作先执行 `git branch --show-current`，核对任务指定分支；不符就停止报告，不自行切换到其他开发分支或修改代码。
- 基线采用任务指定的最新 master；查看工作区与历史，保留已有改动，不覆盖用户文件。
- 每批默认 1 个、最多 3 个提交，按需 test → feat → fix；文档、登记、守卫随对应事项提交，不单独提交 docs。使用 Conventional Commits，中文描述，通常为 `<类型>(<范围>): <中文描述>`。
- 需要旧实现基线时 test 在前、feat 在后；需要改变行为时可另加 fix，断言修改仍需单项批准。
- 批次进行中可以在本地有临时提交，但合并前必须整理成上述数量；整理只允许针对从未推送过的分支，并且要证明整理前后的最终 tree 完全一致。
- 推送过的历史一律不改写。
- 只暂存明确授权的具体文件。.local-data/、cookie、运行时数据与本地工具永不提交；src-tauri/Cargo.toml 只有换行差异时忽略且永远不提交。

## 临时副本与本地流程

- 仓库外项目副本只用本地 git clone、git worktree 或基于 git ls-files 的复制建立，只复制 Git 跟踪的项目文件；不复制被忽略的 cookie、用户资料库、密钥和运行时数据。每次建立后先检查敏感运行时文件是否存在及其跟踪状态，不读取或输出内容；发现非跟踪运行时文件即停止报告。区分正常项目工具与运行时文件，不按 tools 等目录名称批量删除。
- vue-1a 遗留的 all-canaries/canary-copy 已由用户手动删除；2026-10-11 已核查原路径不存在，清理完成。
- GitHub 账号暂停期间只走本地流程，直到用户通知恢复：不 fetch、不推送、不创建或查询 PR、不查询 CI，不使用 gh、GitHub 插件、其他凭证或接口。每批按“本地分支 → 全部本地验收 → 仓库外报告 → 用户回复手测通过，允许合并 → 本地 fast-forward 合并”执行；远程 CI 一律标注“待账号恢复后补验”。此规则优先于下文远程工作流。
- 合并前核对 master、任务分支 HEAD、工作区和祖先关系；只有指定提交一致且 master 可 fast-forward 才合并。分叉、非预期修改或提交不一致即停止，不自动 rebase、reset --hard 或覆盖本地历史。下一批从合并后的本地 master 建分支。
- 用户 2026-10-11 已取消“等远程 CI 通过才能开始下一批”的阻塞；GitHub 账号暂停期间，vue-3 及后续批次都按纯本地流程开展，本地验收标准不降低；每批用户手测及 Mac 验证按下节合并/阶段验收执行；远程 Windows/macOS CI 登记为待账号恢复后补验；此规则不自动授予任何批次的手测、合并或发布权限。账号恢复后先核查本地 master、远程 master 与 PR #61 的实际状态，再决定推送与 PR 收尾；不得预认直接推送 master 会使 PR 自动标记合并。

## 验收口径

- 开发自检：自行反复运行相关测试、typecheck、npm run build，不要求逐次报告。
- 合并验收：每批默认依次运行 node --test（npm ci 之前）、npm ci、npm run test:dom、npm run typecheck、npm run verify:dist。verify:dist 包含 G0 154/70、同机 windows/darwin 配置逐字节一致及 eval/new Function AST 计数均为 0；类型检查零诊断；本批 G0 不重录，后续例外按下文单项申请规则。
- Rust：只有本批改动 src-tauri/、src/、Cargo.toml、Cargo.lock 或 Rust 测试时，合并验收运行 cargo fmt --all -- --check、cargo build --workspace、cargo test --workspace（debug）；否则报告“未改 Rust,跳过”。src-tauri/Cargo.toml 的既有纯换行差异不算本批修改，永不提交。
- 测试审计：用 git diff 证明已有测试哪些未改，冻结文件用 SHA256 证明未改；只对本批改过的已有测试文件列旧/新断言原文和逐测试执行次数，包含共享 helper。原测试名和重复次数保留；新增测试单列，数量重新实测。
- 合并变异：选 3～5 个覆盖本批新接线及关键契约，在仓库外副本用全量 node --test 与 test:dom 判定；抓不到须说明是否等价，不改业务断言以通过验证。只运行与本批守卫、登记、helper 直接相关的 canary，每项恢复文件，不跑无关 canary。
- 用户手测：Windows 清单不超过 8 项，写成可照做的步骤；Mac 运行 npm ci && node --test && npm run test:dom && npm run typecheck && npm run verify:dist，改了 Rust 时加 cargo test --workspace。只有改变键盘、焦点、输入法、滚动行为才要求 Mac 界面手测。手测与自动检查分开报告，未执行不得写通过；合并仍须用户明确授权。
- 阶段验收：每个区域迁移完成（资料库在 vue-5c 后；之后四个曲目列表、播放栏）、GitHub 账号恢复后以及任何正式发布前，运行完整十项（fmt、debug/release build、debug/release cargo test、node --test、npm ci、test:dom、typecheck、verify:dist）、CRLF 四项加 DOM、本地 CI 步骤对等、Node 22.18.0 与 22.23.3 两组、全部 canary、相对上一阶段基线的全量断言审计，以及 Windows/Mac 完整手测。
- 阶段 CRLF：core.autocrlf=true 本地克隆，只覆盖跟踪的候选并处理删除/改名；ui 清单与候选相同、全部 CRLF，lockfile 等文本也检查；依次 node --test、npm ci、test:dom、typecheck、verify:dist。阶段 CI 逐条跑 workflow run，Git Bash 用 --noprofile --norc -c，只说明并跳过 Windows 不适用的 Linux 系统依赖安装。
- 严格模式：播放核心（取流、队列、请求版本、失败跳过、播放状态机）、Rust 后端、数据持久化（资料库文件、设置、备份导入导出）、安全隐私（cookie、API Key、诊断）、G0、依赖版本，以及基础设施逻辑改动，每批按阶段验收。
- 常规登记不触发严格模式：新增测试文件；groups.ts、tsconfig.*.json、scripts/vue/check.ts 导入登记表、vueRendererImports、模块清单、架构守卫白名单追加条目，以及对应登记断言更新。仅运行直接相关 canary（新增编译边界跑冷入口 canary）。非冻结 helper 只新增能力、旧调用默认行为不变算常规。
- 基础设施逻辑改动触发严格模式：测试发现/分组算法、helper 默认行为、守卫判定规则、verify-dist 构建验证逻辑、G0 采集/比较逻辑改变。冻结共享 helper（pages-fixture.ts、library-modal-fixture.ts、library-modal-open.ts 及以后登记项）任何改动均先附完整 diff 申请。
- 冻结测试等价适配仅限环境变化且业务行为完全相同：安装前假 DOM 迁到安装后 jsdom；假 .focused 改为 document.activeElement 与节点比较；假 children 数组改为真实 children 或 childNodes 文本。可免申请，但逐条报告旧/新原文及次数。改变业务期望/预期值/比较语义、放宽比较、删除断言或次数变为 0，仍须停下附 diff 申请。
- 报告正文约一页：改动、验收结果表、偏差例外、手测清单。断言原文、日志、哈希放仓库外附录，正文给路径；远程 Windows/macOS CI 一律“待账号恢复后补验”。
- 区域迁移批次：基线与迁移同批，按需 test（旧实现通过）→ feat（行为不变）→ fix（行为改变需断言授权），默认 1 个、最多 3 个提交，一轮手测。
- 用户 2026-10-12 批准以上规则从 vue-5b 第二提交生效；本批测试改动为常规登记与纯环境迁移，按合并验收，新增 library-view 编译边界跑冷入口及对应守卫条目的 canary，其余 canary 不跑。业务断言授权、冻结文件、G0、安全隐私、Git/合并闸门、临时副本规则均保持。
- 当前实测安装前 578、安装后 271（B2 迁入原特征 10、新增真实 DOM 基线 25），以后重新实测；完整命令和 canary 判据见架构文档。

## Store 设计约定

- store 不新增依赖或状态库；自写极简store，一个应用store按领域分片，公开getState、subscribe（返回取消订阅函数）和领域actions；选择器是纯函数，不提供任意写入接口。Vue 工具链依赖仅按下节已批准清单登记。
- 快照类型深只读，提交只复制改变路径，Map/Set写入创建新集合。测试工厂开启深冻结并验证写快照会抛错；生产不冻结。
- 每个完整同步阶段提交一次并同步按顺序通知，异步开始/成功/失败分阶段。订阅者异常必须报告，不能阻断其他订阅者或动作后续步骤。
- subscribe不立即回调，挂载显式getState完成首屏。renderer只读快照，不调用actions、invoke，不修改状态。
- 状态与纯依赖不引用window、document、DOM类型或Tauri API；平台操作经注入适配器/控制器。新模块同步登记模块清单、导入规则、类型项目和写入归属守卫，并配反例。
- 原事件、初始化位置、媒体监听登记与跨窗同步时机必须保持；只迁移当前任务明确授权的领域。遇到任务停止条件就停止报告，不能用测试接线掩盖行为变化。

## 特征测试与断言审计

- 先在旧实现上写特征测试，全部通过并独立提交；迁移后该文件一行不改、逐字节相同，报告记录SHA256。
- 现有测试改动分三类：登记类（模块清单/数量/顺序/白名单等）允许更新但逐条列出；绑定旧写法的源码文本检查只有覆盖同一意图的行为测试时才能删除或替换，附“被删断言→替代测试”映射；业务断言（状态/返回值/调用参数/事件/界面输出）不得改变或删除。
- 任何现有测试被修改时，逐条提取改动前后全部assert.*、t.assert.*等调用及参数原文，提供匹配、新增/删除/改变列表和逐测试/嵌套测试的实际断言执行次数。包含共享helper中的断言，保留原返回值与抛错语义。
- 任何保留断言由正次数变为0，立即停止；不能因接线变化提前返回或空跑。登记/源码扫描循环次数随模块清单变化的情况逐项解释。
- 格式影响前端行为的命令桩（掩码、时间、路径、文案、枚举等）必须照Rust真实输出构造，在测试中注明Rust文件与行号；不能只凭契约样例猜格式。

## 测试基础设施与切片例外

- 公共helper优先只增加能力，未显式使用新能力的默认行为保持原样；新增单元测试覆盖新能力与旧行为。
- 自动接入真实模块只允许sourceSliceModuleExceptions中的精确源文件/起止标记登记项，登记模块清单和理由；登记表单测必须恰好等于批准清单。
- 改helper前后分别完整运行Node测试，记录每次sourceSlice的源文件、起止标记、返回SHA256；原调用次数和顺序一致，未登记调用逐字节不变，只允许登记项的返回内容改变。
- 对全部使用helper的原测试核对名字与逐测试逐断言执行次数一致，不只核对冻结测试。实际模块从ui源码按既有类型擦除加载，不能用手写替代实现。
- 在仓库外破坏真实状态计算、适配器写入、过渡时长等关键路径，冻结测试必须因相应业务断言失败；没有抓到任何一项就停止。新增能力根据任务补相应反向验证。
- 两项历史切片例外是过渡措施；播放领域迁移完成、冻结测试可改显式接线时，应删对应登记及固定表内容。

## 安全与报告

- 测试只使用临时目录和回环地址，不访问外网服务或真实数据目录；GitHub流程的明确授权网络操作不属于业务测试。
- 日志、诊断、报告不得输出完整播放URL、buvid3/b_nut或cookie值。API Key仅临时动作参数，不进入快照、投影、日志、错误或跨窗同步；后端生成的尾号提示按真实格式保留。
- 批次报告和完整断言附录放仓库外验证目录，PR描述只写摘要与实际验证结论，不能夸大；用户手测清单明确标为待执行。
- 禁止在commit、PR、代码注释或文档中添加AI工具署名、Co-Authored-By或生成标记。

## Git 与 GitHub 工作流

- 本地Git用终端；GitHub查询、PR及CI操作优先使用已安装的GitHub插件。创建或继续处理的PR附到当前任务，已存在则复用。
- 允许创建/切换任务授权的工作分支、提交授权文件、推送授权工作分支、创建/更新PR和查询CI。禁止强推、reset --hard、未授权rebase/amend、改写已推送历史、擅自删除远程分支、创建Release或发布版本。
- 每批按“本地验证→推送→Draft PR（base master）→检查Windows/macOS CI→等待用户手测→获授权后合并→创建下一批分支”执行。
- CI失败先分析关联性；只有与改动无关的偶发失败可重跑失败job一次并说明。同一失败两次或与改动有关，停止报告，不重跑第二次，不改业务断言、业务代码或跳过检查来变绿。
- 用户明确回复“手测通过，允许合并”前，不合并master、不删除远程分支、不提前开始下一批实现。
- 获授权后再次确认PR双平台CI通过且对应分支最新提交，git fetch后核对本地master与origin/master完全一致且无未推送提交；不一致停止。git switch master，git merge --ff-only <任务分支>，git push；不能fast-forward就停止。确认远程master包含提交、PR显示已合并后，才从最新master创建下一批分支，然后等待下一份任务。
- 本次7a/7b的顺序按用户明确指令：7b包含7a三个提交、共同祖先为当前master；先处理7a，再处理7b的推送与Draft PR。7b描述开头注明依赖7a；若7a已合并则复用原PR并如实说明当前diff。两个PR的双平台CI完成后等待手测；获得授权后依序核对并fast-forward合并，全部完成才创建refactor/state-7c并停止。

## vue-3 分P列表边界

- Tab 循环只计入可见且可用的按钮；按 hidden 属性排除按钮自身或祖先，不使用布局判断。
- PagesList.vue 只渲染列表内部 li 与两个按钮，继续复用既有样式；外壳、控制器、查询/请求版本、禁用保存和全部恢复逻辑保持原模块。同步投影调用 createSyncRegion.update，整批替换列表节点后原入口同步应用焦点规则；RAF 打开焦点规则保持原样。只读 props 与回调交互，不引入 store 订阅路径。
- 安装前业务模块图把 pages-view.ts 的两个精确编译边界另列为 rendererFiles；不在无依赖环境解释 SFC 或导入 Vue。冷入口测试的精确临时模块解析边界一旦尝试创建区域便抛错，不能模拟渲染成功；安装后 fixture 经 Vite 编译真实模块和组件，生产 G0 再用真实产物核对。其他模块语法与导入规则不放宽。
- 用户 2026-10-11 单项授权：strict-null-runtime 中空 modal 测试迁到 tests/dom/pages-null.dom.ts；仅将 children 数组断言等价适配为读取真实 childNodes 文本，其余四条业务断言原文、测试名与五条各执行一次保持。报告明确登记这一项业务断言适配；两个分P冻结文件和 G0 fixture 不改。
- 九个真实旧 renderer 状态矩阵由 master 3c21c42 生成，记录于 pages-list-baseline.json；新列表 innerHTML 完全相同，Vue Fragment 仅增加宿主首尾两个空文本锚点。首次引入 Vue 后与 master 的产物字节比较不再适用，但同机 windows/darwin 配置的七产物字节一致检查继续保留；真实 macOS 测试与 WebView 手测另由用户执行，远程 CI 待账号恢复后补验。

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

## Vue 迁移收口与最终形态（E1，用户 2026-10-13 确认）

- Vue 迁移阶段结束，最终形态为“Vue 岛”：动态区域使用 Vue，启动时可见的外壳保持静态 HTML 与 TS 投影。已 Vue 化：分P列表（PagesList.vue）；资料库浮层六种非 generic 内容（LibraryModalBody.vue，generic 仍为空宿主）；首页榜单与推荐、搜索结果、收藏、歌单曲目（TrackList.vue/TrackRow.vue）；歌单目录（PlaylistList.vue）。不继续强制把所有 UI 变成 Vue。
- Vue 岛准入条件须同时满足：第一次使用才渲染且启动/隐藏期间不被投影；冻结测试/helper 不把区域当静态节点直接操作；控制器之外没有模块跨模块直接读写控件值；有实际动态内容与迁移收益。该条件约束以后新增的迁移，不改变已获批准的 B1/B2 隐藏列表投影契约。
- C1 取消，C2 暂缓并入设置视觉改版，D2 沉浸页与歌词不迁移。D1 不再作为播放栏 Vue 化批次；appearance 两项 sourceSlice 历史例外与播放过渡 fixture 在 E1 按需评估，本次仍有测试使用，保留并登记如下。E1 仅做失效代码/登记收口与全面回归，不进行大范围架构重构。
- 下一步为视觉改版，用户逐区域决定外观与是否组件化。当前不改共享样式，不重写 Rust、播放状态机、store 结构或业务逻辑，迷你窗不迁移。sidebar 与 head 首帧脚本保持现状。
- B2 已由用户确认 Windows/Mac 阶段手测及 Mac 阶段命令通过，9e97368 已本地 fast-forward 合并，tree 为 7aeb54eab4ea6d6a5b2c31dfc71b946f4b39666a。远程 Windows/macOS CI 待账号恢复后补验。

### 保留项

| 区域/接口 | 位置 | 未迁移或保留原因 | 将来处理前需解决 |
| --- | --- | --- | --- |
| 首页模式与提示区 | ui/index.html #view-home[data-home-mode]/#home-hint-row，home.ts/home-view.ts/player-dom.ts | 静态把手、启动投影及冻结测试接线；C1 已取消 | 控件草稿读写接口、冻结 helper 适配、启动挂载与 G0、首帧 |
| 搜索框与分区/排序 | ui/index.html #search-form/#music-tabs/#search-sort-modes，search.ts/search-view.ts/main.ts/player-dom.ts | 搜索草稿被跨模块直接读写，投影收益不足；C1 已取消 | 搜索草稿统一读写接口、BV/恢复/组字契约、冻结 helper、启动/G0/首帧 |
| 歌单页操作栏 | ui/index.html #create-playlist-button/#import-playlist-button/#rename-playlist-button/#delete-playlist-button，main.ts/library-view.ts | 静态操作把手，现有控制器足够；C1 已取消 | 冻结 helper 接线、外壳节点归属、启动/G0/首帧 |
| 设置面板 | ui/index.html #settings-modal，appearance.ts/settings-view.ts/playback-settings-view.ts | 启动时已投影；冻结资料库测试未打开设置便操作响度开关；C2 暂缓 | 分离全局启动主题应用与面板投影、冻结 helper 响度触发方式、G0、API Key 临时参数边界 |
| 沉浸页与歌词 | ui/index.html #immersive-player/#lyrics-lines，appearance.ts/lyrics.ts/playback-display-view.ts/playback-core.ts | 内容在启动或隐藏期间投影；歌词虽显式初始化但隐藏时仍更新行/高亮/滚动；D2 不迁移 | 后台数据获取与可见投影分离、打开补投影/滚动契约、静态把手与冻结 helper、G0 |
| 播放栏/状态条 | ui/index.html 底部 .player-bar 与 #status，appearance.ts/playback-*-view.ts/player-dom.ts | 首帧可见、媒体同步与静态冻结把手，不再安排 D1 迁移 | 首帧、媒体及跨窗顺序、双区域投影、冻结测试/helper、G0；两项切片与过渡 fixture 另见下文 |
| 侧栏及 head 首帧脚本 | ui/index.html head 内联脚本与 sidebar.js，ui/sidebar.ts | 首帧外壳、导航/主题早期应用与独立脚本，保留静态路径 | 首帧/Fouc、脚本时机、导航把手、冻结启动测试及 G0 |
| 标题栏 | ui/index.html .window-titlebar，ui/window-controls.ts | 首帧静态窗口控制与固化拖动/双击/resize 行为 | 首帧、平台控制与事件时序、静态把手、冻结启动测试及 G0 |
| 应用 store 惰性 getter | ui/home.ts getApplicationStore | 创建同时安装首页订阅并首投影；冻结 pages/library/tracks helper 从 home.ts 读取该入口。本次不为可选整理增加模块与兼容转发 | 若以后搬移，保持懒创建/首次订阅顺序、保留冻结入口、登记模块并验证 G0；不得改成显式挂载 |
| 兼容激活接口 | ui/video-pages.ts bindTrackActivation 及 legacyTrackButtons | 产品使用 createTrackActivationSession 回调路径；分P冻结测试仍使用原生按钮入口及角标同步 | 只有冻结调用方获授权退场时再删；不得恢复全 document 写入或取消脱离行计时器 |
| appearance 两项 sourceSlice 例外 | tests/helpers/source-slice.ts 的 applyVolume→startAppearance、applyLoudnessNormalization→initializeLoudnessNormalization | playback-volume-characterization/loudness-normalization 冻结测试仍通过精确切片接线 | 获得冻结环境迁移/接线授权，保留全部业务断言与执行次数后再收口；不扩展例外 |
| 播放过渡 fixture | tests/helpers/playback-control-fixture.ts 与 playback-session-fixture.ts/mini-host-fixture.ts | 播放控制及迷你窗冻结测试仍使用，当前不是失效代码 | 后续显式接线迁移须核对冻结 helper 范围、调用方及逐断言次数；本次保留 |

设置旧行为更正：三个滑块每次 input 都保存（appearance.ts 的 setGlassBlur/setPanelAlpha/setBackgroundDim）；清空搜索历史直接调用命令，不弹确认；测试连接允许把未保存的 Key 作为临时 action 参数传出，禁止进入 props、store 快照、日志、错误文本或迷你窗消息。

### 保留的守卫与 G0

- 冷编译边界及 vueRendererImports：仍供安装前 Node 测试隔离 SFC 依赖，并供冻结 DOM fixture 编译真实组件；精确登记仍保护现有 Vue 岛，保留。冷边界收尾必须核对创建尝试为 0，不能只依靠抛错。
- scripts/vue/check.ts 的 Vue 包导入、SFC 导入/文件清单及内容守卫；scripts/vue/infra-guard.ts；模块清单与导入/写入归属守卫：仍用于现有产品与测试，保留，不能当迁移临时项放宽。
- ui/vue/sync-region.ts 的空宿主、重复创建、卸载后更新及同步 render 契约保留。SFC 不访问 actions/invoke/window、不聚焦，高亮由控制器计算；测试分组与安装前依赖隔离、生产 eval/new Function AST 检查均保留。
- E1 不改变 getXxxActions 的隐含初始化、不拆 player-dom.ts、不改任何启动顺序或冻结文件。本批 G0 154/70 不重录。以后只有启动可见区域挂载确实改变序列时才可单项申请，附逐条新增/删除/移位原因；播放、请求、trackchange、媒体监听与跨窗同步事件种类及相对顺序必须不变，批准前不改 golden fixture。
- E1 进行最终完整阶段验收；Windows/Mac 全应用手测须由用户执行并单独确认。纯本地流程、不推送不合并；远程 Windows/macOS CI 待账号恢复后补验。

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

## B1 首页与搜索列表基线

- B1 按 test → feat 迁移首页榜单、首页推荐与搜索列表；收藏与歌单留到 B2。本批新真实 DOM 基线 24 项，原首页 8、搜索 7、搜索恢复 5 项仅迁移测试环境，业务断言保持；等价 DOM 读取逐条记录在仓库外附录。
- 用户 2026-10-12 确认失效标记保持旧时机：搜索不显示；首页只在原内容提交/重绘时采集原因，映射单独变化不更新现有标记。实时更新留给独立修复。

B1 test 提交冻结文件（Git/LF；检出/CRLF）：
- `tests/dom/tracks-fixture.ts`：`a2cadb3216d526a4beee8e302a5ba688e29fd4a0b5f6c8f7e8d9937c1db9e06e`；`ee8a6c2b1613cb1cf9d949994da4104c77d4da05d6236d786ac57736995a98bb`。
- `tests/dom/tracks-baseline.dom.ts`：`644fd905f7391e1bf0d62b54ada08230a733c9ff20903aeaa256fed155eef671`；`b4330f419b171c2b6232fa033fe6f3661305442310dc23260e5bf6b1fe560b71`。
- `tests/dom/home-characterization.dom.ts`：`45524baba48833becd5364b587f75aad755acfc2c51e177d9f47e83be94e0112`；`a59be3b9e8cbc09cbc994fad310975926b8b98246613e5fa69b2e492489e0a99`。
- `tests/dom/search-characterization.dom.ts`：`ab88657d6f84220c3d98f2a7a66dd8712ce4582c585bb20f49603e24cd50f228`；`adee156a78bb7d5eff215637ec1565117187c903473f023a078e707c51e0a016`。
- `tests/dom/search-restore-characterization.dom.ts`：`0c5990b0fcbb26aaca6ffe5c614fc3537d4761581b688a2c1fdd91d93da76f01`；`c5e870a98540f5da9221885e9519a7b81710574a6fd55b28985e4ceb90dc962c`。
- `tests/fixtures/vue/tracks-baseline.json`：`8ed89c63cdd8c4ffaef13c1d8b2dd20caf01560283e8c9c05745f3d6c6a0bf43`；`564b4d72ad59cc5034941f69c845a6f2e31475df9596dbe306e4e421cee84dd1`。

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
