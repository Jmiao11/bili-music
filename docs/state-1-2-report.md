# state-1/2 实施与验收报告

日期：2026-10-07。基线：master/origin/master 的 fad12bd；使用已存在的 refactor/state-1 分支。推荐并落实方案 a：自写极简 store，一个应用 store、按领域分片，本批只接入首页，无新增依赖。

## 提交与边界

| 批次 | 提交 | 完成内容 | 提交前 Node 数量 |
| --- | --- | --- | --- |
| 1 | f44eb62 | TS/ESM 架构文档及九项、CRLF 四项、canary 验收口径 | 316 |
| 2 | 0afe9c9 | store 核心、契约测试和无 DOM 守卫；尚无业务使用 | 324 |
| 3 | b09b432 | 在旧首页上补充并提交特征测试 | 332 |
| 4 | 本报告随首页迁移提交 | 首页动作、只读 renderer、模块登记、无 DOM 动作测试 | 339 |

未改 HTML、CSS、Rust、依赖清单、取流链路、迷你窗同步时机或首页以外的状态结构。播放核心只把首页模式读取换成快照访问，点击入口仍为现有 playListItem。指定的三处现状没有修正。没有重录 G0。

## Store API 与契约

- createStateStore(initialState, createActions, options) 返回 getState、subscribe、actions；createApplicationStore(adapter, options) 创建含 home 分片的应用 store。
- getState() 返回 DeepReadonly 快照。领域动作复制改变路径；Map/Set 变更要求创建新集合。未变化的数组、view 等路径保留引用。
- subscribe(listener) 不立即回调，按登记顺序同步通知，返回取消订阅函数。挂载显式 getState() 渲染首屏。
- 每个请求的开始和完成分别提交；完成阶段合并数据、loading、文案和按钮恢复，订阅者不会看到半完成结果。模式动作与其触发的请求开始分别提交。
- 订阅者抛错通过 onSubscriberError 报告，其他订阅者与动作继续；报告器自身失败也输出 console.error 并继续。
- freeze 默认 false；测试设 true，深度冻结对象/数组，并用集合代理阻止 Map/Set 修改、原型方法调用和 forEach 暴露可写集合。
- commit 只在工厂内部提供，无公开的通用写入接口。isHomePopular 是纯选择器。

state-store.test.ts 的 6 项契约测试：旧快照及未改变路径稳定；不立即通知、顺序和取消；订阅者异常隔离；报告器异常隔离；对象/数组/Map/Set 冻结及绕过反例；运行时不冻结。state-architecture.test.ts 检查 state-store、app-state 及纯依赖 track-utils 的平台隔离、模块登记，并覆盖 document、window、DOM 类型和平台导入反例；另保护 renderer 不调用 actions/invoke。新模块已登记到模块清单、导入顺序、类型项目及写入归属守卫。

## 首页字段迁移对照

| 原 homeState 字段 | 新快照字段 | 写入入口 |
| --- | --- | --- |
| mode | home.mode | setHomeMode |
| ranking | home.ranking | loadHomeRanking |
| recommendations | home.recommendations | loadRecommendationHome / loadRecommendations |
| loaded | home.loaded | loadHomeRanking |
| loading | home.loading | loadHomeRanking |
| error | home.error | loadHomeRanking |
| recommendationLoaded | home.recommendationLoaded | 读取上次推荐 / 生成推荐 |
| recommendationLoading | home.recommendationLoading | 读取上次推荐 / 生成推荐 |
| recommendationError | home.recommendationError | 读取上次推荐 / 生成推荐 |
| userHint | home.userHint | setHomeHint / loadRecommendations |
| aiHasKey | home.aiHasKey | refreshAiKeyState |

原来只存在于 DOM 的状态文案、重试文案、按钮禁用及生成按钮文字进入 home.view。view.content 的引用变化标记本阶段需要刷新的区域（mode/ranking/recommendations）；它保留旧实现的重绘时机，避免隐藏请求完成时替换当前列表。搜索、播放、资料库没有并入本批 store。

## 首页 DOM 写入对照

| DOM 区域与把手 | 迁移前 | 迁移后 | 是否只读状态 |
| --- | --- | --- | --- |
| 面板模式、tab 激活/aria-selected、标题/副标题/来源/列表标签、输入行、刷新 title | home.ts:updateHomeModeUi | home-view.ts:renderHomeMode | 是 |
| 列表 replaceChildren/append、8 行骨架及骨架 innerHTML | home.ts 的内容 renderer | home-view.ts 内容 renderer / renderRankingSkeleton | 是 |
| 配置提示、推荐错误标题/说明、is-inline、needs-setup | home.ts:showHomeNotice 与内容 renderer | home-view.ts:showHomeNotice 与内容 renderer | 是 |
| 状态条、重试文案、生成按钮 disabled/textContent、刷新 disabled | home.ts 请求函数直接写 DOM | app-state 动作提交 view，home-view.ts:renderHomeSnapshot 写 DOM | 是 |
| 曲目行内部结构、按钮和分P交互 | playback-core.ts:createTrackRow 及既有页面辅助模块 | 同一入口，由 home.ts 控制器注入行工厂 | 保留既有实现，本批不迁移 |
| 首页曲目 aria-current 高亮 | playback-core.ts:updateQueueUi | 同一函数；首页模式改读 getHomeSnapshot | 保留既有播放状态读取 |
| 输入值读取、按钮/tab/键盘/页面事件 | main.ts / home.ts | 原位保留，写入改走动作 | 控制器可调用动作 |

首页内容与状态控件归 home-view；播放高亮及曲目行内部仍由播放/分P模块写入，所以首页尚不是所有 DOM 都由一个模块独占。renderer 没有 actions、invoke 或状态赋值；它只读快照，曲目点击回调在控制器里调用现有播放入口。没有改变 main 监听的登记位置。

## 旧实现上的特征测试证据

b09b432 提交时 ui/home.ts 保持旧实现，九项验证全部通过；Node 总数 332（原 316 + store/守卫 8 + 首页 8）。旧实现 TAP 与九项退出码保存在 %TEMP%/bili-music-verify/state12/commit3/。

home-characterization.test.ts 在迁移前后 SHA-256 都是：

68F82589EB9A0AB48CDE01ED10D5E5C0032853C8BA308F8AA5586CE1C3A29751

8 项覆盖：

1. 非空缓存命中、空榜不命中、强制刷新参数、禁用与骨架。
2. 榜单失败的重试文案、无搜索兜底。
3. 无 API Key 使用热门榜及既有静默失败语义。
4. 只读取上次推荐一次，不自动生成。
5. 上次推荐读取失败按完成的空结果缓存。
6. 推荐要求 trim、生成缓存、95000ms 超时及控件/计时器恢复。
7. 模式切换、标签、隐藏榜单请求不替换推荐列表；保留共享状态条的既有完成顺序。
8. 首页与搜索状态隔离，榜单/推荐点击使用现有播放入口。

home-actions.test.ts 直接导入纯状态工厂，不安装 window/document，也不使用 DOM 模拟。5 项覆盖完整阶段通知、旧快照与路径复用、无 Key 分支、上次推荐缓存、生成成功/超时、失败文案以及订阅者异常不影响完成。

## 验收结果

| 验证 | 结果 |
| --- | --- |
| 每个 commit 前九项 | 全部通过；最终 Node 339，Rust debug 386（316+63+7）、release 391（322+63+6） |
| 类型检查 | main/mini/node 均 0，diagnostics.json 仍为 {} |
| G0 | 156 条逐项相同，首个 trackchange 索引 70；fixture 未改 |
| verify:dist | windows/darwin 12 个 JS/HTML/CSS 逐字节一致；两个产物反例预期失败；开发页面与脚本检查通过 |
| CRLF 四项 | core.autocrlf=true 临时克隆；覆盖候选；ui 清单相同且 30 个文件全部 CRLF；无 node_modules 时先跑 Node，再 npm ci/typecheck/verify:dist，全部通过 |
| CI 一致性 | ci.yml 的 10 个 run 步骤中 9 个执行并通过；Linux 系统依赖安装因 Windows 环境跳过；bash 使用指定 Git bash |
| Node 22 名单 | 22.18.0 和 22.23.3 均 339 项通过；原 316 个名字无缺失，新增 23 个，两版本清单相同 |
| canary | 8 项、11 条指定命令均非零退出；每项之后恢复原文件、删除新增文件 |
| 安全与范围 | 自动测试只用临时目录/回环；npm 安装使用离线缓存；未接触真实资料库；日志 URL 已脱敏；未提交运行数据 |

canary 6 首次发现现有 Node 守卫只保护命令名、未保护 audioUrl 字段类型：违规仍返回 0。本批在 command-contract.test.ts 增加不依赖编译器的字段契约及反例，使 node --test 与 typecheck 都能拦截它；未修改契约声明或运行时代码。这是完成既定验收所需的守卫补漏。

外部证据目录：%TEMP%/bili-music-verify/state12/。最终九项在 commit4-final/；CRLF 在 final4-crlf-*.log；CI 在 ci-results.json 与 ci-*.log；Node 名单在 names-22.18.0.json、names-22.23.3.json 与 node-version-results.json；canary 在 canary-results.json 和各项日志。临时证据不提交仓库。

## 首页手测清单（待执行）

本轮没有执行真实 WebView/网络手测，以下不能由 Node、类型检查或 G0 代替。手测应使用隔离资料目录，并遮蔽敏感日志。

- 有 Key 启动：显示上次推荐，不自动发起生成；空结果显示生成入口。
- 无 Key 启动：显示热门榜、配置提示；切榜单与推荐 tab 的文案和输入行一致。
- 刷新：显示 8 行骨架；生成与刷新按钮按旧规则禁用并恢复；非强制重进复用缓存。
- 请求失败：榜单重试、推荐设置提示、上次推荐读取失败空状态分别正确；生成超时恢复控件。
- 连续切 tab、请求未结束时切页面：当前列表不被隐藏请求替换；状态条遵循原顺序。
- 输入要求、点击生成、Enter：trim 参数及按钮反馈一致；清空要求也可生成。
- 点击榜单/推荐曲目及分P：进入原队列，切歌中断、失败跳过、循环/随机和高亮保持；搜索列表与关键词保持。
- 首页播放后打开/操作迷你窗：仍走原同步时机和播放入口；沉浸页及底栏保持一致。
- 深色、浅色、背景图主题，以及最小窗口尺寸：列表、骨架、提示和控件无布局回归。

## 工作量与 state-3 起的拆分建议

本批新建 3 个运行时文件（store、app-state、home-view），旧 home.ts 从请求+渲染变为控制器；首页之外仅 main/core 的桥接读取及旧字段移除。测试投入大于入口改动：新增 23 项，首页特征测试必须先提交；另外同步维护模块清单、导入规则、类型项目、启动结构计数和守卫。后续估计应包含这些固定验证成本，不按“搬几个字段”估算。

| 建议批次 | 边界与主要保护 | 估计工程人日 |
| --- | --- | --- |
| state-3 搜索 | 先旧实现特征测试，再搜索分片；保护 requestVersion、分页、分区/排序、历史 fire-and-forget、播放来源版本 | 2–3 |
| state-4 收藏 | 加载/错误/增删、播放入口、坏文件不覆盖；拖拽另批 | 1.5–2.5 |
| state-5 歌单 | CRUD、浮层及曲目编辑；拖拽和异步保存再单独一批 | 2–3 |
| state-6 分P | 缓存/并发/禁用/弹窗状态，保留现有请求身份和页面队列 | 2–3 |
| state-7 外观/设置 | 存储和平台调用放适配器；主题/背景/AI配置分开迁移 | 2–3 |
| state-8 播放与队列 | 队列→请求协调→音频事件/恢复→持久化，至少拆 3 个完整批次；不得改取流 | 4–6 |
| state-9 迷你窗 | 主窗投影与动作入口接入；事件名称、同步时机和反馈回路逐项保护 | 1–2 |

合计约 14.5–22.5 工程人日，不含发现新行为差异后的返工及平台手测等待。最高风险是异步完成顺序、共享 DOM 写入、播放器请求身份、集合别名和跨窗回路。每个领域继续先提交旧实现特征测试、再迁移；每个完整 commit 跑九项，最终候选跑 CRLF/CI/两个 Node/全部 canary/G0，并补该领域手测。正式 Vue 接入另批，不在当前阶段加兼容框架或依赖。

## 新增测试名（23 项）

- a failing error reporter is logged and cannot interrupt notification or actions
- audio response stream URL contract remains a string without compiler dependencies
- frozen snapshots reject nested object array Map and Set writes including callback escapes
- home actions copy only changed paths and key absence selects the popular ranking
- home actions generation trims hint and releases its timer and controls on success and timeout
- home actions keep ranking failure semantics and isolate listener failures from completion
- home actions preserve saved read caching including an empty failed read
- home actions run without DOM and commit complete loading and success snapshots
- home and search states stay isolated while ranking and recommendation clicks use existing playback entry
- home generation trims the hint caches success and times out after 95000ms
- home mode switches preserve tab labels and do not let a pending hidden ranking replace recommendations
- home ranking caches nonempty results and force refresh preserves its request and busy UI
- home ranking failure leaves retry copy and no search fallback
- home reads saved recommendations once and does not generate them automatically
- home renderer reads snapshots and delegates user interaction without actions or invoke
- home saved recommendation errors become an empty completed read
- home without API key uses popular ranking and keeps its silent failure semantics
- runtime snapshots are not frozen when freeze is disabled
- state architecture guard rejects document references and DOM types and platform imports
- state modules are registered and contain no DOM or Tauri dependencies
- store snapshots retain old paths and copy only changed paths
- store subscriptions are synchronous ordered and not immediate and can unsubscribe
- subscriber exceptions are reported without stopping other subscribers or later action steps
