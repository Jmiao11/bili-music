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

搜索历史已完成并验收（本轮仅记录、可清空、暂不展示不使用）：`src-tauri/src/library.rs` 已新增 `record_search_history` / `get_search_history` / `clear_search_history`；`search-history.json` 复用 `.local-data/` / exe 同目录的既有路径策略与原子写入方案；记录结构固定为 `{ keyword, searchedAt, count }`；写入前做 `trim`，空串不记录，按大小写不敏感去重，重复搜索执行 `count += 1`，最新记录置前，总量上限 100；前端记录方式固定为 fire-and-forget：搜索发起后异步发射、不 `await`，失败仅 `console.warn`，绝不拖慢或中断搜索主流程；坏文件降级已定：`record_search_history` 遇到损坏文件返回错误且不写入、不覆盖坏文件，`clear_search_history` 允许直接写空；设置二级页已提供“清空搜索历史”入口，使用自定义浮层，不用浏览器原生 `confirm`；搜索历史数据仅为后续 LLM 策展预留；这套搜索历史的数据结构、路径策略、原子写入、前端 fire-and-forget 接入与坏文件降级逻辑不要重写；

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
