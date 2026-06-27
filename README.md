<div align="center">
<img src="design/app-icon.png" width="96" alt="Bili Music logo" />
# Bili Music · 午夜黑胶
**一个免登录、不落盘的 B 站音乐播放器。把哔哩哔哩当作你的曲库，听歌不必登录、不必下载。**
![platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)
![tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)
![rust](https://img.shields.io/badge/Rust-backend-000000?logo=rust&logoColor=white)
![license](https://img.shields.io/badge/license-PolyForm%20Strict%201.0.0-orange)

<img src="screenshots/home-placeholder.png" width="760" alt="Bili Music 主界面截图占位" />

---

> ⚠️ **非官方项目**：本项目与哔哩哔哩（bilibili）没有任何官方关联或背书，仅供个人学习与研究使用。详见文末 [法律声明](#-法律声明与使用限制)。

---

## ✨ 这是什么

Bili Music 是一个基于 **Tauri v2 + Rust** 的桌面音乐播放器，把 B 站音乐区当作曲库来听歌。它和市面上同类工具最大的不同在于两条贯穿始终的设计原则：

- 🔓 **免登录**：默认走游客身份取流与搜索，全程不需要你的账号 cookie，**没有封号顾虑**。
- 💧 **不落盘**：音频通过本地流代理在线播放，**不下载、不缓存到磁盘**，听完即走。

换句话说，它刻意没有走"登录账号 + 下载到本地"那条更省事、但更有风险的路——而是把"零负担、零配置、隐私友好"作为产品的核心。

---

## 🎯 核心特性

| | |
|---|---|
| 🔍 **音乐搜索** | B 站音乐区搜索，支持 6 个子分区筛选（原创 / 翻唱 / VOCALOID / 演奏 / 电台 / 全部），支持粘贴 BV 号直接播放 |
| 🔥 **首页榜单** | 打开即见"音乐飙升榜"，游客身份直拉 B 站音乐区排行 |
| 🎵 **在线流式播放** | 后端 Axum 流代理 + `Range` 透传，边下边播、不落盘 |
| 📑 **合集连播** | 多 P 视频（如"周杰伦 50 首合集"）自动逐集连播，标题跟随当前曲目切换 |
| ❤️ **收藏与歌单** | 本地 JSON 持久化的收藏夹与自建歌单，原子写入、坏文件不丢数据 |
| 🎧 **沉浸播放页** | 全屏封面 + 镜面倒影的沉浸式播放界面 |
| 🌙 **午夜黑胶主题** | 深色 / 浅色 / 自定义背景图三档主题，毛玻璃质感，强调色克制 |
| 🪟 **原生质感** | 自定义无边框标题栏，告别浏览器套壳感 |

---

## 🛠 技术亮点

> 这一节写给技术读者：项目里几个有意思的工程决策与难点。

### 1. 免登录游客取流（核心差异点）

主流做法是登录账号、用 `yt-dlp --cookies` 解析下载。本项目改为**游客身份**直接领取 `buvid` 票据、经 WBI 签名请求 `playurl` 拿到音频直链，全程不需要登录态。

带来的不只是"不用登录"，性能也明显更好——同一视频实测：

| 方案 | 首播耗时 |
|---|---|
| yt-dlp（旧方案，需 cookie） | ~12.79s |
| 游客直链（冷启动） | ~1.83s |
| 游客直链（热态） | ~0.54–0.91s |

yt-dlp 作为**可选兜底**保留（游客取流极少数失败时启用），但默认分发版本不包含它，保持"双击即用"。

### 2. 与 B 站游客风控的真实博弈

无 cookie 首次搜索时，曾遇到 B 站返回 `v_voucher`（一种"请先完成验证"的风控响应）而非数据。定位到根因是游客身份只领到了 `buvid3`、缺 `buvid4`，补成"缺 `buvid3` 或 `buvid4` 都走 SPI 补领"后解决。处理这类真实风控行为，是这类项目最磨人也最有价值的部分。

### 3. 搜索展示 与 播放队列 的解耦

早期"搜索一下就打断正在播放的歌"是个恼人的 bug。根因是搜索结果列表和播放队列被绑死了。解法是拆成两个独立状态：`searchState.results`（右侧展示）与 `playerState.queue`（真实播放队列）——**搜索只更新展示，点击某首才升级为播放队列**。这个解耦贯穿了后来的首页榜单、收藏、歌单：它们都只是"新的列表来源"，共用同一套播放队列。

### 4. 切歌不串台：requestVersion 双闸

快速切歌时，旧歌的解析结果可能"迟到"返回、污染当前播放。通过给每次解析分配请求代号（`requestVersion`）+ 登记代理 URL 前的二次身份核验，确保**迟到的旧结果一律作废**，并能区分"真实失败"与"用户主动切歌"。

### 5. 多 P 合集连播的最小侵入设计

B 站大量音乐是"合集"（一个 BV 挂几十个分 P）。支持连播时，没有去改动已稳定的"按 BV"的播放队列结构，而是**旁挂一个分 P 游标 + 独立的显示层快照**：队列、收藏、搜索的数据结构完全不变，只有"播放推进"和"当前显示标题"知道分 P 的存在。在不破坏已验证核心的前提下加功能。

### 6. 本地数据的安全写入

收藏 / 歌单 / 搜索历史都是本地 JSON。写入采用**原子方案**（临时文件 + 备份 + rename，并处理了 Windows 下 rename 无法覆盖已存在文件的坑）；读取时**坏文件绝不被空数据覆盖**，最大限度避免用户数据丢失。

---

## 🧱 技术栈

- **框架**：[Tauri v2](https://tauri.app/)（Rust 后端 + 系统 WebView 前端，产物体积远小于 Electron）
- **后端**：Rust（Cargo workspace；Axum 本地流代理；游客 `playurl` / WBI 签名 / 排行榜 / 搜索均为自实现）
- **前端**：原生 HTML / CSS / JavaScript（无前端框架）
- **取流**：游客直链为主，[yt-dlp](https://github.com/yt-dlp/yt-dlp) 可选兜底
- **数据持久化**：本地 JSON（收藏 / 歌单 / 搜索历史）

> B 站接口的整理参考了 [SocialSisterYi/bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)，在此致谢。

---

## 📦 安装与运行

> ⚠️ **平台说明**：目前仅在 **Windows 10 / 11** 上开发与验证。macOS / Linux 理论上 Tauri 可支持，但**未经测试**。

### 方式一：直接下载使用（推荐普通用户）

### 前往 [Releases](https://github.com/Jmiao11/bili-music/releases) 下载最新的免安装版 `Bili Music.exe`，双击即可运行。

- 默认即为**纯游客模式**，无需任何配置、无需登录、无需放置任何额外文件。
- 运行时产生的收藏 / 歌单 / 搜索历史会保存在 **exe 同目录**下。

### 方式二：从源码构建（开发者）

#### 1. 前置依赖

| 依赖 | 说明 |
|---|---|
| [Rust](https://www.rust-lang.org/tools/install) | Rust edition: `2021` |
| [Node.js](https://nodejs.org/) | 用于本地 Tauri 开发环境（当前仓库前端为原生 `ui/` 静态文件，无独立 Node 前端构建链），建议 LTS（18+） |
| [Tauri CLI](https://tauri.app/) | `cargo install tauri-cli` |
| WebView2 Runtime | Windows 10/11 通常已自带；缺失时从微软官网安装 |

#### 2. 克隆并运行

```bash
git clone https://github.com/Jmiao11/bili-music.git
cd bili-music

# 开发模式（带热重载）
cargo tauri dev

# 构建免安装 exe
cargo tauri build
```

构建产物位于 `target/release/` 下。

#### 3.（可选）启用 yt-dlp 兜底

默认纯游客模式已能正常使用。若希望在游客取流极少数失败时有兜底，可：

1. 下载 [`yt-dlp.exe`](https://github.com/yt-dlp/yt-dlp/releases)，放到 **exe 同目录**（开发模式下放项目根的 `tools/yt-dlp.exe`）。
2. （可选）若该兜底需要 cookie，将 `cookies.txt`（Netscape 格式）放到同一目录。

> 🔒 `cookies.txt` 含登录态，**已被 `.gitignore` 忽略，请勿提交**。yt-dlp 兜底是为覆盖极个别游客无法取流的视频，并非必需。

---

## 🗂 项目结构

```
bili-music/
├── src/                  # Rust 核心库（取流地基、yt-dlp 解析）
├── src-tauri/            # Tauri 后端
│   ├── src/
│   │   ├── main.rs           # 入口、命令注册、播放取消协调
│   │   ├── guest_playurl.rs  # 游客取流（buvid / playurl）
│   │   ├── wbi.rs            # WBI 签名（搜索与 playurl 共用）
│   │   ├── search.rs         # 搜索
│   │   ├── ranking.rs        # 首页榜单
│   │   ├── library.rs        # 收藏 / 歌单 / 搜索历史
│   │   └── appearance.rs     # 主题 / 背景图
│   └── tauri.conf.json
├── ui/                   # 前端（原生 HTML/JS/CSS）
│   ├── index.html
│   ├── main.js              # 播放队列、搜索、收藏歌单、多 P 连播
│   ├── appearance.js        # 主题、设置、沉浸页
│   ├── window-controls.js   # 自定义标题栏窗口控制
│   └── styles.css
├── design/               # 「午夜黑胶」设计稿与规范
└── AGENTS.md             # 项目「宪法」：各模块设计决策与边界
```

---

## ⚖️ 法律声明与使用限制

- 本项目为**非官方**第三方客户端，与哔哩哔哩（bilibili）无任何官方关联或背书，不使用其商标与标识；相关名称与商标归各自权利人所有。
- 本项目**仅供个人学习与研究使用**，**禁止任何形式的商业用途**（包括但不限于销售、收费服务、广告变现、商业集成等）。
- 本项目**不下载、不存储**任何音视频内容到磁盘，仅做在线流式播放；不绕过登录 / 会员权限，不破解任何 DRM / 加密措施。
- 数据来源于公开接口；使用时须遵守哔哩哔哩的《用户协议》《社区规则》及相关法律法规，不得用于批量爬取、恶意抓取等违反平台规则的行为。
- 使用本项目所产生的一切风险与责任由使用者自行承担；如权利人认为本项目存在侵权或合规问题，请通过 Issue 联系，我会及时处理。

---

## 📄 许可证

本项目以 **[PolyForm Strict License 1.0.0](https://polyformproject.org/licenses/strict/1.0.0/)** 发布——**仅限个人非商业使用，不允许商业用途、再分发或修改后分发**。

---

<div align="center">
<sub>用 Tauri + Rust 构建 · 仅供学习研究 · 如果这个项目对你有帮助，欢迎 ⭐️</sub>
</div>
