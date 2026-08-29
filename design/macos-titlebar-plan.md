# macOS 标题栏自适应实现计划（方案 B）

> 目标：macOS 上自动切换为「系统原生红绿灯 + 沉浸式自定义标题栏」形态；Windows 现有行为零改动。
> 选型依据见调研结论（Cap / tauri-plugin-decorum / Tauri 官方文档同一路线），本文只写落地步骤。

## 方案 B 核心机制

- macOS 平台专属配置 `tauri.macos.conf.json`（Tauri v2 官方 merge 机制）覆盖主窗口：
  - `decorations: true`（mac 上红绿灯必须由系统窗口渲染，schema 明确要求）
  - `titleBarStyle: "Overlay"`（标题栏为透明 overlay，无可见系统标题栏条，视觉仍是无边框沉浸式）
  - `hiddenTitle: true`（隐藏原生窗口标题文字）
  - `trafficLightPosition`（LogicalPosition，逻辑坐标，与 retina 无关）
- 前端差异全部由 CSS 的 `[data-platform="macos"]` 作用域承载：隐藏 Windows 三键与 8 个 resize 热区、标题栏左侧留出红绿灯避让宽度
- **`ui/window-controls.js` 零改动**：拖动（`startDragging`）、双击缩放（`toggleMaximize`，mac 上即 zoom）、最大化状态同步（`data-window-maximized`）在 mac 上语义全部成立；三键与热区隐藏后对应监听自然失活
- capabilities 无需改动（现有 `core:window` 权限 mac 端完全够用）

## 相关文件现状（改动锚点）

| 文件 | 现状 | 本次角色 |
| --- | --- | --- |
| `src-tauri/tauri.conf.json` | 主窗口 `decorations:false` 等 9 个字段 | 不改（Windows 语义基准） |
| `src-tauri/tauri.macos.conf.json` | 不存在 | 新增，mac 独占 |
| `src-tauri/Cargo.toml` | `tauri = { version = "2", features = [] }` | 不改（Overlay 无需 feature） |
| `src-tauri/capabilities/default.json` | 已含全部所需权限 | 不改 |
| `ui/index.html` | head 无平台检测；脚本在 body 末尾 | head 加一行内联平台检测 |
| `ui/styles.css` | 183–296 行标题栏/窗口控制样式；372 行最大化去圆角 | 追加 `[data-platform="macos"]` 作用域规则 |
| `ui/window-controls.js` | Windows 三键 + 拖动 + 双击 + 热区 | **零改动** |

## 分步实施（每步独立可验证、可提交）

### 阶段 0：基线记录（不改代码）

- mac 上跑 `cargo tauri dev`，记录当前形态：右侧 Windows 三键、无红绿灯、拖动/双击行为、8 热区 resize 行为，截图留档
- `git status` 干净后建分支 `feat/macos-titlebar`
- 说明：mac dev 下取流走默认 `guest` 档即可；`tools/yt-dlp.exe` 是 Windows 路径逻辑，与本贡献无关，不碰

**验证标准**：应用能起，基线截图入库（PR 描述用）。

### 步骤 1：新增 `src-tauri/tauri.macos.conf.json`

注意：平台配置对 `app.windows` 是**数组整体替换**（非按字段 merge），必须写完整窗口对象：

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Bili Music",
        "width": 1180,
        "height": 760,
        "minWidth": 1080,
        "minHeight": 600,
        "decorations": true,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "trafficLightPosition": { "x": 20, "y": 11 },
        "resizable": true,
        "shadow": true
      }
    ]
  }
}
```

`trafficLightPosition` 初值含义：红绿灯区左上角落在 (20, 11) 逻辑点，12pt 直径按钮在 34px 标题栏内垂直居中（(34−12)/2 ≈ 11）。步骤 3 视觉校准后可微调。

**验证标准（mac dev）**：
1. 左上角出现原生红绿灯，窗口四周仍是沉浸式深灰、无系统标题栏条、内容顶到窗口顶
2. 红绿灯可点：关闭/最小化/全屏（绿点）均正常
3. dev 终端无 config 解析报错
4. 排查项（仅当 Overlay 未生效时）：确认 tauri 无 feature 报错；本方案不需要 `macos-private-api`

**Windows 回归**：此文件 Windows 构建不参与 merge，主 conf 未动，理论零影响；有 Windows 环境时补跑一次 dev 确认。

### 步骤 2：`ui/index.html` head 加平台检测（一行内联脚本）

放在 `<link rel="stylesheet">` **之前**，确保 CSS 命中前 `data-platform` 已就位，避免 mac 上 Windows 三键闪现：

```html
<script>
  document.documentElement.dataset.platform = /Macintosh|Mac OS X/i.test(navigator.userAgent) ? "macos" : "windows";
</script>
```

UA 兜底语义：识别失败默认 `windows`（保持现状行为，安全降级）。

**验证标准**：mac devtools 中 `document.documentElement.dataset.platform === "macos"`；语义上 Windows WebView2 UA 含 `Windows NT` 得 `"windows"`（有条件时实测）。

### 步骤 3：`ui/styles.css` 追加 mac 作用域规则

位置：紧随现有标题栏/窗口控制样式区（296 行后）追加，不改动任何现有规则行；属于全局 shell 层样式，不触碰各页面作用域（`#view-*`）与「UI impeccable」约束不冲突：

```css
:root[data-platform="macos"] .window-controls { display: none; }
:root[data-platform="macos"] .window-resize-layer { display: none; }
:root[data-platform="macos"] .window-titlebar { padding-left: 80px; }
```

- `padding-left: 80px` 为红绿灯避让初值（三键总宽 ≈52pt + 20pt 左 inset ≈ 72pt，留 80px 与 Cap 的 `w-20` 同量级），按实机视觉校准
- resize 热区隐藏后，mac 系统边缘 resize（decorations:true 自带）接管
- `:root[data-window-maximized="true"]` 去圆角逻辑 mac 上照常生效（zoom 后窗口贴边）

**验证标准（mac）**：
1. 右侧三键与 8 热区消失；红绿灯与标题栏垂直居中、不遮品牌 logo / "Bili Music" 文字
2. 标题栏仍 34px 午夜黑胶视觉；深色 / 浅色 / 背景图三主题下红绿灯对比度正常（mac 系统主题联动，应用侧无需处理）
3. 窗口边缘可系统 resize，`minWidth:1080` 约束仍生效

### 步骤 4：行为验证（不改代码）

mac 上逐项手测，全部走现有逻辑，预期直接成立：

| 项 | 预期 |
| --- | --- |
| 标题栏空白处拖动 | `startDragging` 正常拖动窗口 |
| 标题栏双击 | zoom 最大化 / 还原，圆角随 `data-window-maximized` 去除/恢复 |
| 红绿灯关闭/最小化/全屏 | 系统行为；全屏时红绿灯自动隐藏、退出恢复 |
| 点击搜索结果/收藏/歌单切歌 | 播放链路无感知（未触碰任何取流/队列代码） |
| 沉浸页 / 设置浮层 / 桌宠 | z-index 关系不变（标题栏 z-index 低于沉浸页的约定不受影响） |

**已知限制（记录，不处理）**：
- Overlay 模式窗口失焦时 HTML 拖动区拖不动（Tauri 已知限制 tauri#4316），点一下聚焦即可
- 双击行为固定为 zoom，不跟随系统"双击标题栏最小化"设置（与 Windows 端语义一致，可接受）

### 步骤 5：Windows 回归 + 收尾

1. Windows 环境（实体机/VM/CI）跑 dev：三键、双击、8 热区、最大化图标切换、关闭 hover 危险态——对比阶段 0 基线应零差异（代码层面 Windows 路径无任何改动）
2. 提交拆分建议（每步一 commit）：C1 = 步骤 1 conf；C2 = 步骤 2+3 前端；C3 = 视觉校准微调（如 trafficLightPosition / padding 值有变）；C4 = 文档
3. 验收通过后按项目惯例更新 `AGENTS.md` 窗口控制条款，追加一句「mac 分支说明」：macOS 走 `tauri.macos.conf.json` 的 Overlay + 原生红绿灯形态，`ui/window-controls.js` 与 Windows 路径保持零改动——此步由维护者确认后执行

## 明确不做的事

- 不改 `ui/window-controls.js`、`src-tauri/src/main.rs` 取流与取消协调、播放队列、代理、搜索、WBI
- 不引第三方插件（decorum / tauri-controls 均不需要）
- 不做 Linux 适配（项目目标 Win + Mac）
- 不加 macOS 应用菜单定制（系统默认 menu 已随 Tauri 提供 Cmd+W/Q 等标准快捷键）
