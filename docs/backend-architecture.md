# 后端播放模块

F2a：main_window.rs 提供 main_window_ready 与 5000ms 一次性 watchdog。窗口无关 ReadyGate 共用成功门闩；show/焦点成功才完成，ready/超时重复到达不再改变窗口。主窗启动 visible:false，迷你窗及其 restore_main_window 保持原逻辑；无前端 show 权限。启动错误写stderr、现有前端诊断（可用时）及startup-errors.log。只写固定启动原因；未知窗口/路径错误详情用ai::safe_error整段脱敏，不读取API Key配置。head不传ErrorEvent或error对象，只记失败标志。日志每次写入覆盖旧记录，消息最多1024字符（UTF-8加时间不超过4128字节）；dev在.local-data/，release在exe同目录，startup-errors.*已忽略。日志写入失败也不阻止watchdog显示窗口，失败详情同样脱敏。

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

## 推荐请求预算

`ai.rs` 保留 AI 配置、HTTP 鉴权、响应提取与推荐提示词；`ai/protocol.rs` 保留三种 API 的消息/token 结构，按内部请求用途选择可选思考参数。仅推荐调用对已验证的“服务商主机 + 模型”关闭思考：阿里云 qwen3.8-27b 的 Chat 使用 enable_thinking=false，DeepSeek 官方 deepseek-flash 的 Chat 使用 thinking.type=disabled；两家的 Responses 使用 reasoning.effort=none，Anthropic 使用 thinking.type=disabled。未知组合和连接测试保持原请求参数，不从模型名猜测网关能力，不改变已保存配置或自动改写 Base URL。

`ai/recommendation.rs` 是推荐编排入口，开始时建立 75 秒绝对截止时间，包含口味/配置读取的时间核算；意图、全部候选搜索、重排阶段分别最多 20/30/20 秒，均受总剩余时间约束。配置在同一任务内只读一次。搜索仍复用既有 SearchClient/游客身份/WBI，最多五个关键词、三十个真实候选；部分搜索超时保留已得到的候选，重排失败/无效/超时则返回播放量默认顺序。无有效关键词或候选返回错误，不覆盖旧缓存。

所有等待都在当前 future 内由 timeout_at 截止，超时丢弃实际 HTTP/检索 future，不 spawn 后台重排；HTTP timeout 同时覆盖响应体读取。成功后仍由 discovery command 保存非空推荐，参数、Vec<SearchVideo> 返回与缓存格式不变。同步文件系统阻塞不能由异步计时器强行中止；本地丢弃 future 也不保证服务商取消生成/计费。新推荐日志仅记录阶段、结果、耗时和数量，推荐错误不回显服务端正文。

前端保留 95 秒最终兜底，推荐有独立请求版本与 busy 防重入；迟到结果不影响重试，失败恢复旧列表。超时/网络错误在首页提示，只有配置/鉴权等错误提供设置入口。复用现有列表投影，不更改播放队列或播放请求版本。

本地测试的 Dependencies 仅替换意图/搜索/重排外部调用，共用真实编排、deadline、候选校验和降级代码；覆盖剩余总预算、部分搜索超时、重排挂起与 future 丢弃。协议测试覆盖六种已验证组合及未知主机/模型；回环 HTTP 测试覆盖三协议关键词解析、截断、错误正文保密和响应体超时。自动测试不读取真实 AI 配置或调用外网业务服务。

## 播放契约和验证

AudioResponse 序列化契约仍由原 JSON fixture 校验，字段命名保持 camelCase。跨模块只开放实际需要的 pub(crate) 项；I/O 和 command 契约守卫扫描实际子模块路径，不通过搬迁绕过规则。

proxy 的缺失 token 返回空体 404，过期返回空体 410；会话 TTL 为一小时。暂停超过 TTL 的前端恢复是否接回进度，由播放恢复测试和代码路径单独验证，不能把后端 410 当作已验证的 WebView 恢复结论。

每刀执行 cargo fmt、debug/release build、debug/release test、node --test、npm ci、typecheck，及 core.autocrlf=true 克隆中的 Node/npm/typecheck 三项。测试不访问外网、不启动真实 yt-dlp；真实平台媒体与 IPC 行为仍需手测。
