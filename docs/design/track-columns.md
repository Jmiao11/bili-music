# 曲目列宽与 UI-2b 补充

列顺序为序号、封面与标题、UP 主、分P、播放量、时长、行内操作。分P固定72px、左对齐，沿用原分P/合集/失效角标与回调；没有角标时留空。播放量没有数据时表头与行一同收起。标题至少240px，与UP主间距24px；窄窗先保证标题，再压缩UP主至100px。四页与合集详情复用同一模板。

`bilibili-music.track-columns` 使用 JSON `{ "uploader": 160, "plays": 80, "duration": 72 }`。范围分别为100–320、64–120、56–100；非法、缺项或不可读取时整体回退默认。读取放在 `startAppearance` 原有设置初始化中，不增加启动阶段；初始化只投影，不覆盖非法旧值。交互完成后保存，不改其他键或备份格式。

根组件组装层在同步首屏挂载时向 `root-settings.ts` 登记专用初始化回调，由 `startAppearance` 在强调色初始化之后调用。设置业务模块不导入Vue或表头模型；未挂载界面的纯控制器环境不初始化展示端口。

表头只安装pointerdown、keydown两个委托监听。三条分隔线对应UP主、播放量、时长；每条命中区6px，role=separator、垂直方向及范围/当前值由Vue投影。左右键±8px，双击对应分隔线恢复该列默认值。拖动使用表头pointer capture，按下后临时向window安装pointermove、pointerup、pointercancel、lostpointercapture，结束后全部移除。宽度只写documentElement的三项CSS变量；独立表头显示模型更新ARIA与拖动线，不提交store、不刷新列表。

双击由同一分隔线400ms内、位移不超过3px的两次按下识别，不依赖浏览器中为0的PointerEvent.detail；发生拖动就清除短按记录。

原生写权例外仅为 `ui/app/track-columns.ts` 中三项已验证列宽的文档根CSS变量；不得写Vue宿主或放宽文件白名单。新增Vue导入与精确表达式登记在现有守卫中。

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
