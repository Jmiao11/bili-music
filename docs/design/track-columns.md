# 曲目列宽与 UI-2b 补充

列顺序为序号、封面与标题、UP主、分P、播放量、时长、弹性空白、行内操作。默认标题自适应且至少240px；UP主160px(100–320)、分P72px(56–120)、播放量80px(64–120)、时长72px(56–100)。没有播放量时表头与行同时隐藏；标题与UP主文字间留24px。有效列宽可收缩，存储中的手动偏好保持；禁止横向溢出。

`bilibili-music.track-columns` 使用JSON `{ "title": "auto", "uploader": 160, "pages": 72, "plays": 80, "duration": 72 }`；title也可为至少240的有限数字。旧三字段数据补title=auto、pages=72；其他非法/缺项整体回退默认且不覆盖原值。沿用原设置初始化，交互结束保存。

根组件组装层在同步首屏挂载时向 `root-settings.ts` 登记专用初始化回调，由 `startAppearance` 在强调色初始化之后调用。设置业务模块不导入Vue或表头模型；未挂载界面的纯控制器环境不初始化展示端口。

表头只安装pointerdown、keydown两个委托监听，无新增监听。五条分隔线分别调整左侧标题、UP主、分P、播放量、时长。命中区6px，常驻1px×12px竖线，悬停/拖动强调色贯穿表头，title提示与焦点环齐全；role=separator及范围/当前值由Vue投影；auto标题以aria-valuetext“自适应”表达模式，aria-valuenow取240下限，手动调整后改为实际数字，不引入额外测量监听。左右键±8px；双击标题恢复auto，其他恢复默认。

有效宽度与偏好分离：共享CSS模板先缩标题至240，再按UP主/分P/播放量/时长各自可压缩余量的比例分配剩余空间，最低值不变。容器744/680/616/516px按ui-spec逐步收起列，表头与行同步。恢复偏好、窗口/侧栏宽度及拖动变化均自动计算，不新增resize监听或observer，也不回写存储。窄窗收缩的列拖动按原偏好增量计算，避免误把已压缩的显示宽度覆盖成偏好。

文档根仅投影9个偏好变量：title-width，uploader/pages/plays/duration-width及对应capacity。capacity为偏好减最小值，不是持久化字段。标题auto用百分比优先填余量，手动标题仍保留原值，先收缩标题；余量用末端弹性空白吸收。拖动与ARIA仍只刷新表头，不提交store、不重绘列表。

双击由同一分隔线400ms内、位移不超过3px的两次按下识别，不依赖浏览器中为0的PointerEvent.detail；发生拖动就清除短按记录。

原生写权例外仅为 `ui/app/track-columns.ts` 中九项列宽展示变量的文档根CSS变量；不得写Vue宿主或放宽文件白名单。新增Vue导入与精确表达式登记在现有守卫中。

播放栏封面使用新按钮调用已有openImmersive回调，aria-label为“打开沉浸页与歌词”；原沉浸页按钮及焦点返回规则保持。

## G0 重建登记

日期：2026-10-24。原因：用户单项授权恢复表头委托调整列宽及封面按钮。

| | 条数 | 首个trackchange索引 | Git/LF SHA256 |
|---|---:|---:|---|
| 旧 | 184 | 140 | `e7493c60a52764eb31e4b6f0a158d96ee38cca12b87d7ba2513659d1b8be2aff` |
| 新 | 193 | 149 | `4f2c9796640952257040919b72fde9400b9099f56f7c59226965b8aec9d22c7e` |

新增9条listen记录，options均为null；索引从0开始。

| 新索引 | 目标 | 类型 | 声明来源 |
|---:|---|---|---|
| 5 | #home-ranking-list-columns | pointerdown | ui/features/tracks/components/TrackColumns.vue:14 |
| 6 | #home-ranking-list-columns | keydown | 同上 |
| 13 | #search-results-columns | pointerdown | 同上 |
| 14 | #search-results-columns | keydown | 同上 |
| 15 | #favorites-list-columns | pointerdown | 同上 |
| 16 | #favorites-list-columns | keydown | 同上 |
| 21 | #playlist-tracks-columns | pointerdown | 同上 |
| 22 | #playlist-tracks-columns | keydown | 同上 |
| 35 | #open-immersive-cover-button | click | ui/features/playback/components/PlaybackBar.vue:20 |

去掉这9条后，余下184条与旧序列顺序、内容逐条完全一致，所有受保护投影保持。旧fixture已存档于仓库外任务报告目录的 `ui2b-extra-g0-old.json`；完整差异与来源栈存为 `ui2b-extra-g0-diff.json`。合集详情表头仅在该页存在时安装同样的两个委托，初始启动未挂载它，不在本次新增记录中。

同日经单项授权，同步 `mini-host-loading.dom.ts` 的条数184→193、索引140→149及 `startup-classic-characterization.dom.ts` 的索引140→149；仅这三个常量改变，断言结构、次数及其他预期保持。

## UI-5 补充恢复核对

表头和列表使用同一有效列轨且 overflow-x:hidden；先将标题压到240px，再按各列可压缩余量等比例收缩，容器744/680/616/516px依次隐藏播放量/分P/UP主/时长。只投影有效宽度，不回写偏好；窗口恢复后可回到保存宽度。UI-6改为：非标题拖动先冻结当前标题和其他列的实际宽度，增量只用末端空白；无空白时向右停止，向左缩列可释放空间。标题左侧线不动，被拖线在允许范围内逐像素跟手；窗口缩放仍走上述收缩策略。

恢复验证修正一处样式误伤：新增末端弹性轨后，旧的带列表ID选择器仍使操作按钮落在第八轨，导致重叠。第九轨覆盖规则改为相同的列表ID优先级；模板、按钮与监听不变。

## UI-6b 标题/UP主交换

仅标题分隔线按渲染起点固定标题，在标题/UP主之间等量交换，240/100–320约束共同夹紧；末端空白不参与。实际发生交换时保存可见布局（隐藏列不以0覆盖旧偏好），避免结束后再次套旧偏好移动其他边界；无有效位移不改其他列偏好。表头user-select:none避免原生文字拖放触发pointercancel。现有委托监听及其他分隔线不变。
