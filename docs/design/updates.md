# 主页新版本提示

启动时通过 Rust 匿名访问 `https://api.github.com/repos/Jmiao11/bili-music/releases/latest` 一次，前端 fire-and-forget 发起，不等待网络完成来显示主窗口、读取推荐或播放。检测失败仅记录日志，下次启动重试；本轮不加轮询、持久化或手动检查入口。

## 判断与跳转

- 当前版本取 Tauri `package_info().version`，随 `tauri.conf.json` 打包；按数字比较主/次/补丁版本，支持同数字版本从预发布升级到正式版。
- 发布版本遵循仓库 `vMAJOR.MINOR.PATCH` 标签规范，忽略草稿、预发布、无效标签及相同/更低版本。
- 必须有当前平台 `state=uploaded` 且 `size>0` 的产物：`Bili-Music-v{version}-windows-x64.zip`、`...-macos-arm64.dmg` 或 `...-macos-x64.dmg`。无对应产物的平台不提示；源码压缩包不算可用构建。
- 检测客户端独立于 B站客户端，连接超时 4 秒、总超时 8 秒，不传 cookie、登录态或令牌，不跟随 API 重定向。404 视为无正式发布，其他非 200 状态、无效 JSON 或请求错误返回日志错误。
- 显示灰阶「发现新版本 vX.Y.Z ↗」，点击后调用无 URL 参数的 `open_update_download`，复用系统浏览器助手打开固定 `https://github.com/Jmiao11/bili-music/releases/latest`。不读取响应中的外链，不自动下载、安装或替换文件。
- 打开过程中防止重复点击，系统跳转助手返回错误时原位提供重试。助手沿用此前的子进程启动语义，只能报告进程启动失败，不保证浏览器随后加载 GitHub 成功。

## 改动归属

| 入口 | 责任 |
| --- | --- |
| `src-tauri/src/commands/updates.rs` | GitHub 请求、版本与平台产物判断、固定发布页跳转 |
| `commands/runtime.rs` | 仅提升既有浏览器助手可见性以供命令模块复用，实现保持原样 |
| `types/command-contract.d.ts` | `check_for_update` 的可空版本结果和 `open_update_download` 无参契约 |
| `ui/store/app-state.ts` | home 内独立 update 字段、一次检查和防重入打开 actions，其他状态结构共享 |
| `features/home/home.ts`、`app/main.ts`、`app/root-controls.ts` | 既有控制器转交 action、启动接线、稳定回调 |
| `HomeUpdateNotice.vue`、`AppShell.vue` | 首页提示的单一 Vue 显示写入方，独立礼貌播报 |
| `ui/styles.css` | 仅 `#view-home` 内更新按钮样式，复用现有灰阶 token |

取流、代理、请求取消、队列、搜索、游客身份、WBI、资料库、启动 ready/watchdog、窗口配置和权限均不改变。没有新增依赖、运行时文件或跨窗口消息。

## 验证

Rust 单测覆盖数字版本比较、稳定/预发布过滤、平台产物完整性与 JSON 输出契约；回环 HTTP 服务覆盖请求头、200/404/403/502、损坏或缺字段 JSON、重定向、超时和连接失败，不访问外网。前端测试使用真实冻结 store/actions 及挂载后的应用，覆盖一次检测、异步状态隔离、无更新隐藏、点击跳转、防重入、失败重试及提示恢复；保留既有启动 G0 和所有业务断言。

Windows 原生浏览器和 WebView2 手工验收由 Windows 环境补充，不能用 macOS/DOM 测试代替。
