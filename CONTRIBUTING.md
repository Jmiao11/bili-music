# 贡献指南

感谢你的贡献。提交 Issue、提交代码或发起 Pull Request，即表示你同意遵守本文件和根目录的 [AGENTS.md](AGENTS.md)。两份规则如有冲突或无法确定适用范围，请先向维护者确认，不要自行猜测或重写既有实现。

## 开始前

1. 阅读 [README.md](README.md) 了解运行方式，并阅读 [AGENTS.md](AGENTS.md) 中对应模块的架构约束。涉及前端改动时还需阅读 [前端结构说明](docs/frontend-architecture.md)。
2. 涉及提示、加载态、错误态、确认交互或跨窗口反馈时，必须阅读并遵守 [用户操作反馈规范](docs/notification-guidelines.md)。
3. 从最新主分支创建单一目的的分支；提交前先检查 `git status`，保留并避开不属于本次工作的改动。
4. 改动已固化的取流、播放队列、切歌取消、搜索、持久化或窗口控制链路前，先与维护者确认设计和影响范围。

## 本地开发与构建

前端使用精确锁定的 Vite 8.3.2；建议使用 Node.js 22.12 或更高版本（CI 使用 Node 22），并准备既有 Rust、Tauri CLI 和平台构建依赖。首次检出或 package-lock.json 变化后，在仓库根目录执行：

```bash
npm ci
```

`cargo tauri dev` 会先运行 `npm run dev`，启动固定端口 1420 的 Vite 开发服务器，再启动 Rust 应用；WebView 从 http://localhost:1420 加载 ui/，不需要提前构建 dist。端口被占用时启动失败，不自动换端口。不要同时手动启动另一个占用该端口的 Vite 服务。

`cargo tauri build` 会先运行 `npm run build`，生成 dist/index.html、dist/mini.html 和脚本/样式资源，再编译并嵌入这些前端文件；首次构建前同样需要 npm ci。Windows 的免安装构建可继续使用 `cargo tauri build --no-bundle`，最终 exe 不依赖旁边的 dist 目录。

开发模式的 localStorage 属于 localhost:1420，与正式版的应用源分开；主题、侧栏宽度等前端保存项不会自动继承正式版。Rust 端的 `.local-data/` 与正式版路径策略保持原有约定。仅在浏览器打开 Vite 页面不能替代 Tauri WebView 的 IPC、媒体或窗口手测。

直接运行 `cargo build --workspace` / `cargo test --workspace`（含 --release）不会执行前端钩子；当前未启用 custom-protocol 且配置 devUrl，因此不要求 dist 存在。生成可分发应用应使用 Tauri CLI。前端改动另行执行 `npm run verify:dist`，它在系统临时目录构建、检查产物及开发页面，结束后删除临时产物并关闭服务器，不写入仓库 dist。

## 必须遵守的架构与安全约束

- 项目采用 Tauri v2、Rust 后端和原生 HTML/JavaScript 前端；优先复用既有 command、状态机、模块和测试，不创建平行实现。
- 音频必须通过后端本地流代理播放并透传 `Range`，不得回退为“先下载完整音频再播放”；请求 B 站音频 CDN 必须携带 `Referer: https://www.bilibili.com`。
- 默认搜索和取流使用游客方案。`cookies.txt` 仅能作为既有 yt-dlp 兜底的一部分，绝不提交、记录、输出或要求用户分享登录态。
- 不得改变既有运行时路径约定：开发环境资料写入 `.local-data/`，`cookies.txt`、`tools/`、收藏和歌单运行时数据均不得提交。
- 不得为了功能便利重写已完成的请求代号保护、切歌取消、自动失败跳过、WBI、游客身份复用、播放队列或本地代理链路。
- 不新增依赖、不修改锁文件、不改变 Tauri 权限或窗口配置，除非在 PR 中说明必要性并先获得维护者同意。

## 实现与界面规则

- 保持改动小而聚焦；不要借功能开发顺便重构无关模块，也不要覆盖或丢弃他人的未提交改动。
- 沿用现有状态、事件和 DOM 把手。修改公开 command、持久化格式、跨窗口事件或 UI 交互语义时，必须同步更新文档和测试。
- 新增或修改命令时，按 [前后端契约检查清单](docs/contract.md#新增或修改命令) 同步 Rust 签名、fixture、types/ 映射和守卫，并验证 debug/release 与 CRLF 检出。
- 页面视觉调整应保持“午夜黑胶”风格：不引入第二强调色、渐变或无关的全局样式改动；已有页面优先在其页面作用域内调整。
- 删除、改名等需要用户决定的操作必须使用项目自定义浮层；禁止浏览器原生 `alert`、`confirm`、`prompt`。
- 用户可见错误要说明结果和可行的下一步；调试细节留在日志中。通知的类型、时长、优先级、无障碍和 mini 同步规则以 [用户操作反馈规范](docs/notification-guidelines.md) 为准。

## 验证要求

每个 PR 至少执行与改动相符的验证，并在 PR 描述中如实列出命令及结果：

```bash
npm ci
npm run typecheck
npm run verify:dist
node --test tests/*.test.cjs
cargo test --workspace
```

- 新增行为或修复缺陷时，必须补充或更新覆盖该行为的自动化测试。
- 涉及播放器提示时，遵守通知规范中的专门测试要求；涉及 mini、快捷键、窗口或平台差异时，在受影响平台完成手工验证。
- 若因环境、平台或外部服务无法执行某项验证，必须在 PR 中明确写出未执行项、原因和风险，不能将其标为通过。

## 提交 Pull Request

- 一个 PR 只解决一个清晰的问题；提交信息和 PR 标题应准确说明改动目的。
- PR 描述应包含：问题与方案、影响的模块或用户行为、测试结果，以及仍存在的限制或风险。
- 不提交 cookie、密钥、个人资料、构建产物、下载工具或 `.gitignore` 中的运行时文件。
- 仅修改本次任务必要的文件；如需要后续工作，请在 PR 描述或 Issue 中单独记录，而不是夹带进当前改动。

感谢你帮助 Bili Music 保持稳定、可维护且尊重用户体验。
