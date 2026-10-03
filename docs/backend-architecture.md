# 后端播放模块

## 组合与依赖

`src-tauri/src/main.rs` 是组合根：声明模块、创建共享客户端与 AppState、绑定本机回环代理、setup 和注册 Tauri commands。播放命令按 `resolve::prepare_audio` / `resolve::cancel_prepare_audio` 等子模块路径注册；debug 本地流命令仍仅在 `debug_assertions` 下注册。main 保留去注释扫描器、错误契约测试及契约测试模块声明。

| 模块 | 职责与直接依赖 |
| --- | --- |
| proxy.rs | Axum 流代理与 StreamEntry / StreamLocation；远程域名白名单、Referer、Range 和响应头透传；本地缓存文件的字节范围；token TTL 与诊断。 |
| ytdlp_adapter.rs | 用 spawn_blocking 适配核心库的可取消、可选分P解析；保持取消错误及原日志文本，不下载整首音频。 |
| resolve.rs | prepare / cancel 命令、ResolveCoordinator、AudioResponse、debug 本地流注册；依赖 state、audio_cache、guest_playurl、proxy、ytdlp_adapter。 |
| guest_playurl.rs | 同一客户端的游客身份、WBI 缓存、视频/分P信息与音频直链解析和探测；输出核心库 StreamAudioInfo。 |
| wbi.rs | 共用 WBI key 获取与参数签名；guest 与 search 复用算法。 |
| state.rs | AppState 和 auto / guest / yt-dlp 运行时模式；保存共享游客客户端与解析协调器。 |
| src/lib.rs | Cargo workspace 核心库：yt-dlp 音频直链解析、取消、既有资源路径策略。遗留 download_bilibili_audio 不是真实播放入口。 |

调用方向为 main → resolve → guest / ytdlp_adapter / audio_cache / proxy；main → proxy 安装本地路由。代理在线透传远程流，不回退为先下载再播放。向 B 站音频 CDN 请求必须携带 `Referer: https://www.bilibili.com`，直链在登记 token 前通过域名校验。

## prepare 入口与可注入测试边界

`prepare_audio` 只准备参数并调用内部 `prepare_audio_with_dependencies`，生产传 `RealPrepareDependencies`。私有 `PrepareDependencies` 只替代缓存查找、游客 resolve 与 yt-dlp 适配调用；真实实现直接转发既有函数。内部入口及依赖定义留在 resolve，不为测试扩大外部可见性。

缓存命中登记本地 token；缓存条目损坏回退取流。guest 模式游客失败直接返回错误；auto 仅在游客真实失败且 job 仍当前、未取消时回退 yt-dlp。每次 prepare 开始替换并取消旧 job；在 streams 写锁前、后分别核验身份，旧请求不得登记 token；finish 只清除对应 id，不清除新 job。

两处 `#[cfg(test)]` 钩子在缓存/远程登记路径的首轮 job 核验之后、streams 写锁之前调用 `before_streams_lock`；非测试构建不存在。测试用假依赖及通道闸门控制替换/取消交错，不用 sleep。

resolve 内的测试覆盖缓存命中与损坏、guest/auto 分流、取消/非当前时不 fallback、CDN 拒绝不登记 token、两轮身份核验间替换、旧 finish 不清除新 job。允许的 CDN fixture 只作为字符串校验与登记断言，不发请求或解析 DNS；真实字节传输测试仅用本机回环假上游与临时目录。

## 契约和验证

AudioResponse 序列化契约仍由原 JSON fixture 校验，字段命名保持 camelCase。跨模块只开放实际需要的 pub(crate) 项；I/O 和 command 契约守卫扫描实际子模块路径，不通过搬迁绕过规则。

proxy 的缺失 token 返回空体 404，过期返回空体 410；会话 TTL 为一小时。暂停超过 TTL 的前端恢复是否接回进度，由播放恢复测试和代码路径单独验证，不能把后端 410 当作已验证的 WebView 恢复结论。

每刀执行 cargo fmt、debug/release build、debug/release test、node --test、npm ci、typecheck，及 core.autocrlf=true 克隆中的 Node/npm/typecheck 三项。测试不访问外网、不启动真实 yt-dlp；真实平台媒体与 IPC 行为仍需手测。
