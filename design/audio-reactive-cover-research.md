# 歌曲封面音频响应动画：GitHub 方案调研与选型

> 调研日期：2026-09-23
> 范围：只做技术选型，不修改业务代码；检查的是源码而非仅 README。
> 项目基线：`c6894f11787a50185dcac5252fba32af5d2e45f9`（`upstream/master` / v0.7.0）。

## 结论先行

推荐方案一：**使用浏览器原生 Web Audio API 的 `MediaElementAudioSourceNode + AnalyserNode`，自行提取少量频段能量，动画只写 CSS 变量**。

这是三个方案中最符合本项目的选择：零第三方运行时依赖、无需 Canvas/WebGL、可以把分析器做成一个独立小模块，也不需要修改 Rust 取流、代理、播放队列或 mini 播放控制。主窗口只分析现有唯一的 `<audio>`，mini 窗口只接收 3～4 个经过限幅的数值，不创建第二个播放器。

这里的“随旋律波动”应准确理解为**随实时音频的低/中/高频能量与瞬态变化波动**，不是识别音符、调式或转录旋律。对封面的轻微缩放、光晕和呼吸感而言，频段能量比真正的音高追踪更稳、更省 CPU，也更不容易被人声或和弦误判。

## 当前项目约束

- 主窗口已有且只有一个 [`<audio id="audio">`](https://github.com/Jmiao11/bili-music/blob/c6894f11787a50185dcac5252fba32af5d2e45f9/ui/index.html#L381)，不能创建第二套播放链路。
- mini 窗口没有 `<audio>`；现有架构由主窗口通过定向事件发布状态，[host 调用 `emitTo("mini", ...)`](https://github.com/Jmiao11/bili-music/blob/c6894f11787a50185dcac5252fba32af5d2e45f9/ui/mini-player-host.js#L82-L88)，mini 侧[监听 `mini-player-state`](https://github.com/Jmiao11/bili-music/blob/c6894f11787a50185dcac5252fba32af5d2e45f9/ui/mini.js#L245)。
- mini 就绪后主窗口会被隐藏（[`main.hide()`](https://github.com/Jmiao11/bili-music/blob/c6894f11787a50185dcac5252fba32af5d2e45f9/src-tauri/src/mini_player.rs#L63-L70)），因此不能假设主窗口的 `requestAnimationFrame` 在 mini 模式仍按屏幕刷新率持续执行。
- Tauri 在 Windows 使用 WebView2、macOS 使用 WKWebView；官方文档也提醒其 WebView 不随应用打包，需要考虑平台差异。[Tauri WebView 版本说明](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/reference/webview-versions.md)
- Web Audio 会检查跨源媒体。规范规定：若媒体被标记为 CORS-cross-origin，`MediaElementAudioSourceNode` 必须输出静音。[Web Audio 1.1 § Security with MediaElementAudioSourceNode](https://webaudio.github.io/web-audio-api/#MediaElementAudioSourceOptions-security) 当前远程和本地代理响应已分别返回 [`Access-Control-Allow-Origin: *`](https://github.com/Jmiao11/bili-music/blob/c6894f11787a50185dcac5252fba32af5d2e45f9/src-tauri/src/main.rs#L608-L615)（[本地缓存路径](https://github.com/Jmiao11/bili-music/blob/c6894f11787a50185dcac5252fba32af5d2e45f9/src-tauri/src/main.rs#L812-L820)），具备接入条件；实现时仍必须把 `<audio crossorigin="anonymous">` 放在首次设置 `src` 之前，并做真实播放回归。

## 方案一：原生 `AnalyserNode` + CSS 变量（推荐）

### 已实现的参考

MDN 的 `webaudio-examples` 是 Web Audio 官方文档配套源码。`voice-change-o-matic` 的实现会创建 `AnalyserNode`，设置 `minDecibels`、`maxDecibels`、`smoothingTimeConstant`，再在动画循环中调用 `getByteTimeDomainData()` 或 `getByteFrequencyData()` 绘制实时波形/频谱：

- [创建并配置分析器的源码](https://github.com/mdn/webaudio-examples/blob/733def1c41939a7bb2ec4dc1be3603e3ae70af51/voice-change-o-matic/scripts/app.js#L18-L22)
- [时域波形采样与 `requestAnimationFrame`](https://github.com/mdn/webaudio-examples/blob/733def1c41939a7bb2ec4dc1be3603e3ae70af51/voice-change-o-matic/scripts/app.js#L100-L136)
- [频域采样与频谱柱绘制](https://github.com/mdn/webaudio-examples/blob/733def1c41939a7bb2ec4dc1be3603e3ae70af51/voice-change-o-matic/scripts/app.js#L142-L178)

MDN 的另一个已运行示例把已有 `<audio>` 变成 `MediaElementAudioSourceNode`，随后接入 Web Audio 图；这与本项目复用现有 `<audio>` 的方式一致。[`audio-basics` 源码](https://github.com/mdn/webaudio-examples/blob/733def1c41939a7bb2ec4dc1be3603e3ae70af51/audio-basics/index.html#L127-L158) Web Audio 规范还明确要求：创建该节点后，原有媒体元素的暂停、seek、音量和 `src` 切换行为应保持不变，只是声音改由音频图输出。[Web Audio 1.1 § MediaElementAudioSourceNode](https://www.w3.org/TR/webaudio/#MediaElementAudioSourceNode)

### 适配本项目的做法

```text
现有 #audio
    └─ MediaElementAudioSourceNode
         ├─→ AudioContext.destination       （声音直通，不把分析器串进可听路径）
         └─→ AnalyserNode                   （只读频谱，不连接输出）
                 └─ 低/中/高频能量 + spectral flux
                         ├─ 主窗口：CSS variables
                         └─ mini：限频后的 Tauri event
```

`AnalyserNode` 本身会让音频流原样通过，并允许在输出不连接时工作；这是接口定义的一部分。[MDN `AnalyserNode` 源码文档](https://github.com/mdn/content/blob/main/files/en-us/web/api/analysernode/index.md?plain=1) 分析支路不参与可听输出，能把视觉故障与声音隔离。

建议参数：

- `fftSize = 1024`：得到 512 个频率 bin，足够把低频、中频和高频分开；不需要高分辨率频谱库。
- 每帧只算 3 个频段的均值/峰值和一次相邻帧差值（spectral flux），再做 attack/release 平滑。
- 低频/瞬态驱动 `scale`，中频驱动外环强度，高频只做很小的亮度或扩散变化；所有输出限制在 `0...1`。
- 播放时采样，暂停/结束/错误时平滑归零；主窗口视觉更新不高于 30 fps，发往 mini 的数据不高于 12～15 fps。
- `prefers-reduced-motion: reduce` 时停止视觉采样和动态变换。

### 优缺点

优点：

- 零依赖；只增加一个很薄的 JS 深模块与页面作用域 CSS。
- 不需要 Canvas/WebGL/GPU，不引入额外渲染树。
- 算法、更新频率、跨窗口协议都由项目控制，能严格适配“只动封面”的需求。
- Web Audio 与 `createMediaElementSource()` 已属广泛可用能力；MDN 将其标为自 2021 年 4 月起跨浏览器广泛可用。[MDN `createMediaElementSource()`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource)

缺点与风险：

- `createMediaElementSource()` 会把媒体元素的声音重路由到 AudioContext；规范明确说明调用后声音由图输出，因此初始化与 CORS 失误可能造成静音。[Web Audio 1.1 `createMediaElementSource()`](https://webaudio.github.io/web-audio-api/#dom-audiocontext-createmediaelementsource)
- `AudioContext` 可能因自动播放策略先处于 `suspended`，需要在已有播放手势中调用 `resume()`；规范允许浏览器仅在 sticky activation 后启动。[Web Audio 1.1 `AudioContext`](https://webaudio.github.io/web-audio-api/#AudioContext)
- 主窗口隐藏时，不能依赖主窗口 `requestAnimationFrame`。mini 模式应由**可见的 mini 窗口低频请求采样**，或用经过实测不会被隐藏 WebView 暂停的调度方式；第一版必须在 Windows WebView2 与 macOS WKWebView 各连续运行至少 10 分钟验证。Tauri 自己也指出后台 WebView 可能节流定时器甚至卸载页面，且 `backgroundThrottling` 在 Windows 不受支持。[Tauri WebView API 源码注释](https://github.com/tauri-apps/tauri/blob/dev/packages/api/src/webview.ts#L386-L414)

## 方案二：audioMotion-analyzer

### 源码实现

audioMotion-analyzer 是完整的实时频谱分析器。当前源码会：

- 创建双声道 `AnalyserNode`、splitter、merger、输入/输出 gain，并可把输出接回扬声器。[节点拓扑源码](https://github.com/hvianna/audioMotion-analyzer/blob/bd226d1331316319583b9a56207b86c6f3c8fea5/src/audioMotion-analyzer.js#L268-L305)
- 若输入是 `HTMLMediaElement`，内部直接调用 `createMediaElementSource()`。[`connectInput()` 源码](https://github.com/hvianna/audioMotion-analyzer/blob/bd226d1331316319583b9a56207b86c6f3c8fea5/src/audioMotion-analyzer.js#L851-L871)
- 内置 `getEnergy()`，预设 bass `20–250 Hz`、mid `500–2000 Hz`、treble `4–16 kHz` 等频段，返回 `0...1` 的能量值。[`getEnergy()` 源码](https://github.com/hvianna/audioMotion-analyzer/blob/bd226d1331316319583b9a56207b86c6f3c8fea5/src/audioMotion-analyzer.js#L987-L1031)
- 自带 Canvas 绘制循环，源码说明绘制函数通常由 `requestAnimationFrame` 以约 60 fps 调用。[绘制循环源码](https://github.com/hvianna/audioMotion-analyzer/blob/bd226d1331316319583b9a56207b86c6f3c8fea5/src/audioMotion-analyzer.js#L1759-L1768)

### 评估

- **兼容性**：底层仍是 Web Audio + Canvas，Windows/macOS 基本可行；CORS、AudioContext 启动和隐藏窗口节流风险与方案一相同。
- **依赖与许可**：运行时无 npm 依赖，但整个库约 2,000 行且包含大量本项目用不到的频谱绘制、刻度、渐变、全屏、双声道布局逻辑。更关键的是仓库使用 **AGPL-3.0-or-later**，而本项目是 MIT；若直接打包该库，需要先确认愿意履行 AGPL 义务。[audioMotion `package.json`](https://github.com/hvianna/audioMotion-analyzer/blob/bd226d1331316319583b9a56207b86c6f3c8fea5/package.json#L1-L35)（这不是法律意见。）
- **CPU/GPU**：从源码拓扑推断，默认双分析器 + Canvas 约 60 fps 明显多于本项目“3 个标量 + CSS”的需要；实际占用仍需在目标机器基准测试。
- **mini 同步**：`getEnergy()` 很方便，但库自己的 RAF 在主窗口隐藏后同样不可靠，仍要额外做跨窗口调度。
- **维护成本**：API 完整但集成面积大，未来升级还要持续检查 AGPL、Canvas 生命周期和自己的动画循环。

结论：如果需求是新增完整频谱页，它很有吸引力；对两个 40～56px 封面的轻动画而言过重，而且许可风险不值得。

## 方案三：Wave.js（Canvas 动画库）

### 源码实现

Wave.js 是一个直接接收 `<audio>` 或既有 `AnalyserNode` 的 Canvas 2D 可视化库。当前 2.0.5 源码会：

- 对传入的 `<audio>` 延迟创建 `AudioContext`、`MediaElementAudioSourceNode` 和一个 `AnalyserNode`，并把 source 分别接到 analyser 与 destination。[初始化与音频图源码](https://github.com/foobar404/Wave.js/blob/7ed12c4fc32c3174e08e7622e34c47282919a888/src/index.ts#L57-L114)
- 固定使用 `smoothingTimeConstant = 0.85`、`fftSize = 1024`；每个 RAF 读取 512 个频率值、清空整个 Canvas，再逐个调用已启用动画的 `draw()`。[采样/绘制循环](https://github.com/foobar404/Wave.js/blob/7ed12c4fc32c3174e08e7622e34c47282919a888/src/index.ts#L113-L125)
- 内置 10 种 Canvas 动画。`AudioData` 通过数组比例切出 base/lows/mids/highs，但不是按采样率换算真实 Hz，而且 `slice()`/`map()` 会为绘制创建新数组。[`AudioData` 源码](https://github.com/foobar404/Wave.js/blob/7ed12c4fc32c3174e08e7622e34c47282919a888/src/util/AudioData.ts#L1-L31)
- `Shine` 和 `Turntable` 等效果会按频谱画几十条线或多层多边形，视觉形态接近封面周围的频谱环。[`Shine` 源码](https://github.com/foobar404/Wave.js/blob/7ed12c4fc32c3174e08e7622e34c47282919a888/src/animations/Shine.ts#L20-L61)（[`Turntable` 源码](https://github.com/foobar404/Wave.js/blob/7ed12c4fc32c3174e08e7622e34c47282919a888/src/animations/Turntable.ts#L21-L77)）
- 包为 MIT，运行时无依赖。[`package.json`](https://github.com/foobar404/Wave.js/blob/7ed12c4fc32c3174e08e7622e34c47282919a888/package.json#L1-L39)

### 评估

- **兼容性**：Web Audio + Canvas 2D 在两套目标 WebView 中可行；库甚至有 Safari 用户手势分支，但它靠 UA 正则识别 Safari，而不是能力检测。[Safari 分支源码](https://github.com/foobar404/Wave.js/blob/7ed12c4fc32c3174e08e7622e34c47282919a888/src/index.ts#L63-L82)
- **依赖与许可**：无运行时依赖且为 MIT，比 audioMotion 更容易合规；但会把约 25 KB 的 bundle 和 10 套 Canvas 动画一起带入，而本项目只需要 3～4 个数值。
- **CPU/GPU**：无需 WebGL，但循环无论音频是否暂停都会持续 RAF、清整张 Canvas并调用动画 `draw()`；动画内还会创建数组和多次绘图。从源码推断，开销高于“算三个均值 + CSS”，实际值仍需基准测试。
- **CORS/播放安全**：库内部直接创建 `MediaElementAudioSourceNode`，没有替本项目验证代理 CORS，因此不会消除静音风险。
- **mini 同步**：Canvas 位于主窗口，隐藏后 RAF 不可靠；库没有输出轻量音频特征或跨窗口协议。若只取其 analyser 数据自行同步，就等于绕过了库的主要价值。
- **维护成本**：公开 API 只有 `addAnimation()` 与 `clearAnimations()`；源码没有 `destroy()`、没有保存/取消 RAF，也没有暂停时停采样的生命周期接口。[公开方法与循环源码](https://github.com/foobar404/Wave.js/blob/7ed12c4fc32c3174e08e7622e34c47282919a888/src/index.ts#L117-L134) 这些都需要本项目另包一层处理。

结论：它能很快做出封面周围的 Canvas 频谱环，是三个方案中最接近“开箱即用视觉”的方案；但当前需求只是让既有图片轻微波动，Canvas 动画、不可取消的 RAF 和欠缺生命周期控制反而增加侵入面，所以不推荐直接引入。

## 横向比较

| 维度 | 原生 AnalyserNode | audioMotion-analyzer | Wave.js |
|---|---|---|---|
| 适合的视觉 | 封面缩放/光晕/CSS | 专业频谱图 | Canvas 波形/频谱环 |
| 运行时依赖 | 0 | 单库；AGPL-3.0-or-later | 单库、零依赖；MIT |
| 分析/渲染工作量（源码推断） | 最低：1 analyser、3 段聚合 | 最高：双 analyser + 60fps 高分辨率 Canvas | 中：1 analyser + 每帧 Canvas 动画 |
| WebGL/GPU 要求 | 无 | 无（Canvas 2D） | 无（Canvas 2D） |
| CORS/静音风险 | 有，能完全自行控制 | 有，库内部创建 source | 有，库内部创建 source |
| mini 跨窗口 | 只传 3～4 个数，最自然 | 仍需自建事件桥 | Canvas 无法直接复用，仍需自建事件桥 |
| 隐藏主窗口调度 | 需专门设计并实测 | 库 RAF 不适用，仍需补设计 | 库 RAF 不适用，且无停止 API |
| 维护成本 | 最低 | 高 | 中高 |
| 推荐度 | **推荐** | 不推荐 | 不推荐 |

CPU/GPU 一栏只根据上述源码的节点数、循环与渲染路径做相对判断；没有用虚构百分比代替基准测试。实现后应在目标 Windows 与 macOS 机器上记录空闲/播放/mini 模式三组 CPU 数据。

## 推荐落地边界（供下一步设计使用）

1. 新增一个独立的 `audio-reactive.js`，拥有唯一的 `AudioContext`、唯一的 `MediaElementAudioSourceNode` 和唯一的 `AnalyserNode`；绝不在切歌时重建 source。
2. 在首次设置任何音频 URL 之前，为现有 `<audio>` 声明 `crossorigin="anonymous"`。初始化顺序为：创建 source 后立即 `source.connect(audioContext.destination)`，再连接只读 analyser 分支；视觉异常不得中断 `audio.play()`。
3. 只输出版本化的小对象，例如 `{ sequence, active, energy, bass, mid, treble }`；接收端用 `Number.isFinite` 校验并 clamp 到 `0...1`，用 `sequence` 丢弃迟到帧。
4. 主窗口封面只接收 CSS variables；mini 复用现有定向事件通道，但使用独立的 `mini-player-audio-frame` 事件，避免把 12～15Hz 数据混入低频的 `mini-player-state`。
5. mini 模式不要沿用主窗口 RAF。优先做一个小型 spike：由可见 mini 以最多 15Hz 请求一帧，主窗口事件处理器即时读取 analyser 并回传；若 WebView2/WKWebView 任一平台在主窗口隐藏后不可靠，再评估 AudioWorklet 或原生后端分析。不要为了动画先改动 Rust 取流或解码链路。
6. 降级策略是“无动画但继续播放”：Web Audio 不可用、context 无法恢复、CORS 验证失败、mini 超时、`prefers-reduced-motion` 或页面卸载时都停止动画；不弹阻塞提示、不自动切换音源。
7. 验收首先看声音安全：首播、切歌、seek、暂停恢复、音量、循环、自动下一首、游客/yt-dlp/本地缓存三种来源必须与基线一致；再验收动画和资源占用。

## 最终推荐理由

原生 `AnalyserNode` 方案把本需求需要的能力压缩到最小：一次音频图接入、一次轻量 FFT、三个频段标量、两处 CSS 消费者。相比 audioMotion，它规避了 AGPL 和整套高分辨率频谱 Canvas；相比 Wave.js，它不引入 10 套未使用动画、整帧 Canvas 清绘和不可取消的 RAF。它也最容易遵守项目已有边界：不重写取流、不复制播放器、不改变队列，只复用唯一 `<audio>` 与现有 Tauri 事件通道。

唯一必须前置验证的风险不是 FFT，而是 **MediaElementAudioSource 的 CORS/声音重路由** 和 **主窗口隐藏后的调度**。因此建议下一步先做可随时删除的最小 spike，只验证“声音不变 + mini 隐藏主窗口后连续 10 分钟仍有实时采样”，通过后再加视觉样式。
