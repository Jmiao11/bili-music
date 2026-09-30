# 前端结构

主窗口在 `ui/index.html` 中按下表顺序加载普通 `<script>`。这些脚本共享全局词法作用域，顶层 `const`、`let`、`class` 不能重名；`ui/mini.html` 和 `ui/mini.js` 属于独立窗口。

| 顺序 | 脚本 | 职责 |
| --- | --- | --- |
| 1 | `sidebar.js` | 侧栏展开、收起和宽度持久化。 |
| 2 | `window-controls.js` | 无边框窗口的拖动、缩放与窗口按钮。 |
| 3 | `dynamic-background.js` | 从封面提取背景配色并响应曲目变化。 |
| 4 | `page-selection.js` | 分 P 可用性、随机轮次和合集偏好值的计算。 |
| 5 | `track-utils.js` | 曲目规范化、格式化及播放错误分类。 |
| 6 | `home.js` | 首页榜单和 AI 推荐的加载、渲染。 |
| 7 | `library-ui.js` | 收藏、歌单视图、拖拽和共用浮层操作。 |
| 8 | `video-pages.js` | 分 P 元数据查询调度、角标与弹窗。 |
| 9 | `search.js` | 搜索执行、结果渲染、分区与分页。 |
| 10 | `main.js` | 播放状态机、队列、恢复、搜索及资料库状态定义，DOM 引用、事件绑定和启动调用。 |
| 11 | `appearance.js` | 设置、主题、音量、响度及沉浸页交互。 |
| 12 | `lyrics.js` | 歌词显示与曲目变化响应。 |
| 13 | `mascot.js` | 桌面吉祥物及 `window.BiliMascot` API。 |
| 14 | `mini-player-host.js` | 主窗口与独立迷你窗之间的状态和命令同步。 |

## 拆分约束

从 `main.js` 拆出的六个文件只放顶层函数声明及其注释。原有状态定义、DOM 引用、事件监听和启动调用留在 `main.js`；`sidebar.js`、`appearance.js` 等原有脚本仍管理各自的局部状态与监听器。写入 `playerState` 字段的函数只能放在 `main.js`。`tests/architecture-guards.test.cjs` 检查脚本顺序、重名、拆分文件内容，以及四个状态对象的写入文件白名单。

新增从 `main.js` 拆出的文件时：

1. 在 `ui/index.html` 的 `main.js` 之前加入普通 `<script src>`，保持所需加载顺序。
2. 同步更新架构守卫中的脚本顺序清单和“只含函数声明”清单；若新文件确需写入 `searchState`、`libraryState` 或 `homeState`，核对后更新相应的文件白名单。写入 `playerState` 的函数仍留在 `main.js`。
3. 调整受影响测试的源码加载代码，并运行 `node --test`；函数体和既有断言不因搬迁而改变。

测试通过 `tests/helpers/source-slice.cjs` 按标记从源码切片；标记缺失或终点不在起点之后会直接报错。若同一个源码变量还供断言检查其它文本，应保留它读取原文件，另设变量读取新文件供切片使用。

## 跨文件依赖

拆分文件先于 `main.js` 加载，但函数只在调用时访问 `main.js` 中的状态、DOM 引用和函数；`main.js` 反过来调用这些已声明的函数。普通脚本没有 import/export，移动声明时须检查全局重名和调用时机。

`main.js` 与 `appearance.js` 有双向依赖：`main.js` 调用后加载的 `appearance.js` 中的 `setNormalizationGain`、`isLoudnessNormalizationEnabled`；`appearance.js` 调用先加载的 `main.js` 中的 `currentPlayableTrack`、`readShuffleCollectionPrefs`、`showLoudnessNormalizationDialog`、`refreshTrackLoudness`。`appearance.js` 还在交互时通过 `window.BiliMascot` 调用后加载的吉祥物脚本。

事件也连接这些脚本：`main.js` 发出 `bilibili-music-trackchange`，供 `appearance.js`、`dynamic-background.js` 和 `mini-player-host.js` 使用；`main.js` 发出 `bili-track-changed`，供 `lyrics.js` 使用；`library-ui.js` 发出 `bilibili-music-favorite-change`，供迷你窗宿主同步。`appearance.js` 发出 `bilibili-music-viewchange` 和 `ai-config-updated`，由 `main.js` 响应；迷你窗宿主还监听播放提示变化事件。
