#![allow(dead_code)]
// 本模块将在后续关卡接线，届时移除该属性。

use ebur128::{EbuR128, Mode};
use std::io::{self, Cursor, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use symphonia::core::audio::GenericAudioBufferRef;
use symphonia::core::errors::Error as DecodeError;
use symphonia::core::formats::{probe::Hint, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream};

// 按实测分布采用 -14 LUFS，仍只衰减、不放大。
pub const TARGET_LUFS: f64 = -14.0;
// 最多衰减 12 dB，避免极响音源导致音量降得过低。
pub const MIN_GAIN_DB: f64 = -12.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LoudnessMeasurement {
    pub integrated_lufs: f64,
}

/// 按顺序喂入交错 f32 样本；每批必须包含完整帧，沿用 ebur128 默认声道映射。
/// Ok(None) 表示静音、低于门限或数据不足等无法测量的情况。
/// 配置、样本格式或喂入失败返回 Err；本函数不解码、不执行 IO。
pub fn analyze<'a>(
    channels: u32,
    sample_rate: u32,
    batches: impl IntoIterator<Item = &'a [f32]>,
) -> Result<Option<LoudnessMeasurement>, String> {
    let mut meter = LoudnessAnalyzer::new(channels, sample_rate)?;
    for samples in batches {
        meter.feed(samples)?;
    }
    Ok(meter.finish())
}

// 原切片入口与解码入口共用同一分析器；只保留 R128 能量历史，不保存 PCM。
struct LoudnessAnalyzer(EbuR128);

impl LoudnessAnalyzer {
    fn new(channels: u32, sample_rate: u32) -> Result<Self, String> {
        EbuR128::new(channels, sample_rate, Mode::I)
            .map(Self)
            .map_err(|error| format!("无法初始化响度分析器：{error}"))
    }

    fn feed(&mut self, samples: &[f32]) -> Result<(), String> {
        if samples.len() % self.0.channels() as usize != 0 {
            return Err("交错样本必须包含完整声道帧。".to_owned());
        }
        if samples.iter().any(|sample| !sample.is_finite()) {
            return Err("音频样本不能包含 NaN 或无穷值。".to_owned());
        }
        self.0
            .add_frames_f32(samples)
            .map_err(|error| format!("无法分析音频样本：{error}"))
    }

    fn finish(&self) -> Option<LoudnessMeasurement> {
        self.0
            .loudness_global()
            .ok()
            .filter(|lufs| lufs.is_finite())
            .map(|integrated_lufs| LoudnessMeasurement { integrated_lufs })
    }
}

/// 无法测量（None 或非有限值）保持原音量；其余只衰减，最多 12 dB。
pub fn lufs_to_gain(lufs: Option<f64>) -> f64 {
    let Some(lufs) = lufs.filter(|value| value.is_finite()) else {
        return 1.0;
    };
    let gain_db = (TARGET_LUFS - lufs).clamp(MIN_GAIN_DB, 0.0);
    10.0_f64.powf(gain_db / 20.0)
}

const ANALYSIS_TIMEOUT: Duration = Duration::from_secs(5 * 60);

// 仅接受当前进程发出的代理 URL，防止手动命令变成任意 HTTP 请求入口。
fn proxy_token<'a>(audio_url: &'a str, proxy_base_url: &str) -> Result<&'a str, String> {
    let token = audio_url
        .strip_prefix(&format!("{proxy_base_url}/audio/"))
        .filter(|token| token.len() == 32 && token.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| "只接受当前应用的本地音频代理 URL。".to_owned())?;
    Ok(token)
}

fn skip_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 404 | 410)
}

fn remaining(deadline: Instant) -> io::Result<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|duration| !duration.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "响度分析超时"))
}

/// 同步解码器的 HTTP 适配器，仅在 spawn_blocking 中使用。
/// 保留一个网络 chunk；定位时丢弃旧响应并向同一代理 URL 发 Range 请求。
struct ProxyAudioSource {
    client: reqwest::Client,
    url: String,
    runtime: tokio::runtime::Handle,
    deadline: Instant,
    skipped: Arc<AtomicBool>,
    response: Option<reqwest::Response>,
    chunk: Cursor<axum::body::Bytes>,
    position: u64,
    length: Option<u64>,
}

impl ProxyAudioSource {
    /// 作为普通 HTTP 客户端使用既有代理的 Range 能力，未修改代理实现。
    /// 位置为 0 时发送普通 GET，否则请求从当前位置开始的字节范围。
    /// 404/410 或超时由命令层降级为 Ok(None)；其他请求错误、非 206 的 Range
    /// 响应或 Content-Range 校验失败会返回错误，不重试、不回退为顺序 GET。
    fn open_response(&mut self) -> io::Result<()> {
        let mut request = self
            .client
            .get(&self.url)
            .timeout(remaining(self.deadline)?);
        if self.position != 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={}-", self.position));
        }
        let response = self.runtime.block_on(request.send()).map_err(|error| {
            if error.is_timeout() {
                self.skipped.store(true, Ordering::Relaxed);
            }
            io::Error::other(error)
        })?;
        if skip_status(response.status()) {
            self.skipped.store(true, Ordering::Relaxed);
            return Err(io::Error::other("代理 token 不存在或已过期，本次跳过"));
        }
        if self.position == 0 {
            if response.status() != reqwest::StatusCode::OK {
                return Err(io::Error::other(format!("代理 HTTP {}", response.status())));
            }
            self.length = response.content_length();
        } else {
            if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                return Err(io::Error::other("代理未返回请求的音频范围"));
            }
            validate_content_range(
                response
                    .headers()
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok()),
                self.position,
                self.length,
            )?;
        }
        self.response = Some(response);
        Ok(())
    }
}

fn validate_content_range(
    value: Option<&str>,
    position: u64,
    length: Option<u64>,
) -> io::Result<()> {
    let parsed = value.and_then(|value| {
        let (range, total) = value.strip_prefix("bytes ")?.split_once('/')?;
        let (start, end) = range.split_once('-')?;
        Some((
            start.parse::<u64>().ok()?,
            end.parse::<u64>().ok()?,
            total.parse::<u64>().ok()?,
        ))
    });
    match parsed {
        Some((start, end, total))
            if start == position && end >= start && end < total && length == Some(total) =>
        {
            Ok(())
        }
        _ => Err(io::Error::other("代理 Content-Range 与请求不匹配")),
    }
}

impl Read for ProxyAudioSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        remaining(self.deadline)?;
        if buf.is_empty() || self.length.is_some_and(|length| self.position >= length) {
            return Ok(0);
        }
        loop {
            let count = self.chunk.read(buf)?;
            if count > 0 {
                self.position += count as u64;
                return Ok(count);
            }
            if self.response.is_none() {
                self.open_response()?;
            }
            let response = self.response.as_mut().expect("response opened above");
            let chunk = self.runtime.block_on(async {
                tokio::time::timeout(remaining(self.deadline)?, response.chunk())
                    .await
                    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "响度分析超时"))?
                    .map_err(|error| {
                        if error.is_timeout() {
                            self.skipped.store(true, Ordering::Relaxed);
                        }
                        io::Error::other(error)
                    })
            })?;
            match chunk {
                Some(chunk) => self.chunk = Cursor::new(chunk),
                None if self.length.is_some_and(|length| self.position < length) => {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "代理音频提前结束",
                    ));
                }
                None => return Ok(0),
            }
        }
    }
}

fn seek_position(from: SeekFrom, position: u64, length: Option<u64>) -> io::Result<u64> {
    let position = match from {
        SeekFrom::Start(position) => Some(position),
        SeekFrom::Current(offset) => position.checked_add_signed(offset),
        SeekFrom::End(offset) => length.and_then(|length| length.checked_add_signed(offset)),
    };
    position.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "无效的音频定位"))
}

impl Seek for ProxyAudioSource {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        remaining(self.deadline)?;
        let position = seek_position(from, self.position, self.length)?;
        if position != self.position {
            self.position = position;
            self.response = None;
            self.chunk = Cursor::new(axum::body::Bytes::new());
        }
        Ok(position)
    }
}

impl MediaSource for ProxyAudioSource {
    /// 首次普通 GET 响应提供可用长度（length 为 Some）时返回 true，否则返回 false。
    /// 此判据未额外探测 Range 支持；实际定位请求失败时按 open_response 的规则处理。
    fn is_seekable(&self) -> bool {
        self.length.is_some()
    }

    fn byte_len(&self) -> Option<u64> {
        self.length
    }
}

fn copy_pcm(decoded: GenericAudioBufferRef<'_>, samples: &mut Vec<f32>) -> Result<(), String> {
    samples.resize(decoded.samples_interleaved(), 0.0);
    // Symphonia 负责 i16/i32/浮点等样本格式的归一化与交错排列。
    decoded.copy_to_slice_interleaved(samples.as_mut_slice());
    for sample in samples {
        if !sample.is_finite() {
            return Err("解码输出包含非有限音频样本。".to_owned());
        }
        *sample = sample.clamp(-1.0, 1.0);
    }
    Ok(())
}

fn decode_loudness(source: Box<dyn MediaSource>, deadline: Instant) -> Result<Option<f64>, String> {
    // MediaSourceStream 默认环形缓冲为 64 KiB；不缓存整首压缩音频。
    let stream = MediaSourceStream::new(source, Default::default());
    let mut hint = Hint::new();
    hint.with_extension("m4a");
    let mut format = match symphonia::default::get_probe().probe(
        &hint,
        stream,
        Default::default(),
        Default::default(),
    ) {
        Ok(format) => format,
        Err(DecodeError::Unsupported(_)) => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let Some(track) = format.default_track(TrackType::Audio) else {
        return Ok(None);
    };
    let Some(params) = track
        .codec_params
        .as_ref()
        .and_then(|params| params.audio())
    else {
        return Ok(None);
    };
    let track_id = track.id;
    let mut decoder =
        match symphonia::default::get_codecs().make_audio_decoder(params, &Default::default()) {
            Ok(decoder) => decoder,
            Err(DecodeError::Unsupported(_)) => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
    let mut meter: Option<LoudnessAnalyzer> = None;
    let mut samples = Vec::new();
    loop {
        if remaining(deadline).is_err() {
            return Ok(None);
        }
        let Some(packet) = format.next_packet().map_err(|error| error.to_string())? else {
            break;
        };
        while !format.metadata().is_latest() {
            format.metadata().pop();
        }
        if packet.track_id != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(DecodeError::Unsupported(_)) => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let channels = decoded.spec().channels().count() as u32;
        let rate = decoded.spec().rate();
        if meter.is_none() {
            meter = Some(LoudnessAnalyzer::new(channels, rate)?);
        }
        let meter = meter.as_mut().expect("meter initialized above");
        if meter.0.channels() != channels || meter.0.rate() != rate {
            return Err("音轨中途改变声道数或采样率。".to_owned());
        }
        // 复用单个解码包大小的 PCM 缓冲，用后覆盖，不按时长累积。
        copy_pcm(decoded, &mut samples)?;
        meter.feed(&samples)?;
    }
    Ok(meter
        .and_then(|meter| meter.finish())
        .map(|result| result.integrated_lufs))
}

struct AnalysisGuard(Arc<AtomicBool>);

impl Drop for AnalysisGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

async fn analyze_exclusively<F, Fut>(
    busy: Arc<AtomicBool>,
    analyze: F,
) -> Result<Option<f64>, String>
where
    F: FnOnce(Arc<AnalysisGuard>) -> Fut,
    Fut: std::future::Future<Output = Result<Option<f64>, String>>,
{
    if busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(None);
    }
    let guard = Arc::new(AnalysisGuard(busy));
    analyze(Arc::clone(&guard)).await
}

#[tauri::command]
pub async fn analyze_track_loudness(
    state: tauri::State<'_, crate::AppState>,
    audio_url: String,
    key: String,
) -> Result<Option<f64>, String> {
    if let Some(lufs) = crate::library::get_track_loudness(key.clone())? {
        return Ok(Some(lufs));
    }
    analyze_exclusively(Arc::clone(&state.loudness_busy), |guard| async move {
        let token = proxy_token(&audio_url, &state.proxy_base_url)?.to_owned();
        let client = state.proxy.client.clone();
        let runtime = tokio::runtime::Handle::current();
        let deadline = Instant::now() + ANALYSIS_TIMEOUT;
        let skipped = Arc::new(AtomicBool::new(false));
        let worker_skipped = skipped.clone();
        let worker = tauri::async_runtime::spawn_blocking(move || {
            // 超时或调用方取消后，worker 结束前仍占用分析槽。
            let _guard = guard;
            let mut source = ProxyAudioSource {
                client,
                url: audio_url,
                runtime,
                deadline,
                skipped: worker_skipped,
                response: None,
                chunk: Cursor::new(axum::body::Bytes::new()),
                position: 0,
                length: None,
            };
            source.open_response().map_err(|error| error.to_string())?;
            decode_loudness(Box::new(source), deadline)
        });
        // 外层按时返回；worker 的网络读取与解码循环也检查同一截止时间，防止后台继续分析。
        let result = match tokio::time::timeout(ANALYSIS_TIMEOUT, worker).await {
            Ok(Ok(result)) if !skipped.load(Ordering::Relaxed) && Instant::now() < deadline => {
                result
            }
            Ok(Err(error)) => Err(format!("响度分析任务异常：{error}")),
            _ => Ok(None),
        };
        #[cfg(debug_assertions)]
        {
            let lufs = result.as_ref().ok().copied().flatten();
            eprintln!(
                "[loudness] token={token} lufs={lufs:?} gain={:.6} result={result:?}",
                lufs_to_gain(lufs)
            );
        }
        #[cfg(not(debug_assertions))]
        let _ = token;
        if let Ok(Some(lufs)) = result {
            crate::library::save_track_loudness(&key, lufs)?;
        }
        result
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::TAU;

    const RATE: u32 = 48_000;

    #[test]
    fn concurrent_analysis_skips_download_and_releases_after_error() {
        let busy = Arc::new(AtomicBool::new(false));
        tauri::async_runtime::block_on(async {
            let result = analyze_exclusively(busy.clone(), |_guard| async {
                let second = analyze_exclusively(busy.clone(), |_| {
                    panic!("第二个请求不得启动下载");
                    #[allow(unreachable_code)]
                    async {
                        Ok(None)
                    }
                })
                .await;
                assert_eq!(second, Ok(None));
                Err("模拟分析失败".to_owned())
            })
            .await;
            assert!(result.is_err());
            assert!(!busy.load(Ordering::Acquire));
            assert_eq!(
                analyze_exclusively(busy.clone(), |_| async { Ok(Some(-10.0)) }).await,
                Ok(Some(-10.0))
            );
            assert!(!busy.load(Ordering::Acquire));
        });
    }

    #[test]
    fn analysis_slot_remains_busy_until_worker_guard_drops() {
        let busy = Arc::new(AtomicBool::new(false));
        let mut worker_guard = None;
        tauri::async_runtime::block_on(async {
            assert_eq!(
                analyze_exclusively(busy.clone(), |guard| {
                    worker_guard = Some(guard);
                    async { Ok(None) }
                })
                .await,
                Ok(None)
            );
        });
        assert!(busy.load(Ordering::Acquire));
        drop(worker_guard);
        assert!(!busy.load(Ordering::Acquire));
    }

    fn sine(amplitude: f64) -> Vec<f32> {
        (0..RATE * 3)
            .map(|n| (amplitude * (TAU * 1_000.0 * n as f64 / RATE as f64).sin()) as f32)
            .collect()
    }

    fn measured(samples: &[f32]) -> f64 {
        analyze(1, RATE, [samples])
            .unwrap()
            .expect("测试正弦应可测量")
            .integrated_lufs
    }

    fn assert_gain(lufs: Option<f64>, expected: f64) {
        let gain = lufs_to_gain(lufs);
        assert!((10.0_f64.powf(MIN_GAIN_DB / 20.0)..=1.0).contains(&gain));
        if expected == 1.0 {
            assert_eq!(gain, 1.0);
        } else {
            assert!((gain - expected).abs() < 1e-12, "gain={gain}");
        }
    }

    #[test]
    fn gain_at_target_is_unity() {
        assert_gain(Some(TARGET_LUFS), 1.0);
    }

    #[test]
    fn gain_attenuates_louder_audio() {
        assert_gain(Some(-12.0), 10.0_f64.powf(-2.0 / 20.0));
    }

    #[test]
    fn gain_does_not_amplify_quieter_audio() {
        assert_gain(Some(-30.0), 1.0);
    }

    #[test]
    fn gain_clamps_at_floor() {
        for lufs in [TARGET_LUFS - MIN_GAIN_DB, 100.0, f64::MAX] {
            assert_gain(Some(lufs), 10.0_f64.powf(MIN_GAIN_DB / 20.0));
        }
    }

    #[test]
    fn gain_unmeasurable_is_unity() {
        for lufs in [
            None,
            Some(f64::NAN),
            Some(f64::INFINITY),
            Some(f64::NEG_INFINITY),
        ] {
            assert_gain(lufs, 1.0);
        }
    }

    #[test]
    fn gain_stays_in_bounds() {
        let floor = 10.0_f64.powf(MIN_GAIN_DB / 20.0);
        for step in -2_000..=2_000 {
            assert!((floor..=1.0).contains(&lufs_to_gain(Some(step as f64 / 10.0))));
        }
        assert_gain(Some(-f64::MAX), 1.0);
    }

    #[test]
    fn silence_is_unmeasurable() {
        assert_eq!(
            analyze(1, RATE, [vec![0.0; RATE as usize].as_slice()]),
            Ok(None)
        );
    }

    #[test]
    fn below_absolute_gate_is_unmeasurable() {
        assert_eq!(analyze(1, RATE, [sine(1e-6).as_slice()]), Ok(None));
    }

    #[test]
    fn empty_and_short_audio_are_unmeasurable() {
        assert_eq!(analyze(1, RATE, std::iter::empty()), Ok(None));
        assert_eq!(analyze(1, RATE, [&[][..]]), Ok(None));
        assert_eq!(analyze(1, RATE, [&sine(0.1)[..100]]), Ok(None));
    }

    #[test]
    fn sine_matches_expected_lufs() {
        // ITU-R BS.1770 参考条件：997 Hz、峰值 0.5、单声道，-9.03 LUFS。
        // 这是规范参考值而非自行推算值；容差 ±0.5 LU。
        let samples: Vec<f32> = (0..RATE * 3)
            .map(|n| (0.5 * (TAU * 997.0 * n as f64 / RATE as f64).sin()) as f32)
            .collect();
        let lufs = measured(&samples);
        assert!((lufs - (-9.03)).abs() <= 0.5, "lufs={lufs}");
    }

    #[test]
    fn halving_amplitude_lowers_lufs_by_six() {
        let difference = measured(&sine(0.05)) - measured(&sine(0.1));
        // 能量变成 1/4，因此 10*log10(1/4)=20*log10(1/2)≈-6.0206 LU。
        assert!((difference - 20.0_f64 * 0.5_f64.log10()).abs() <= 0.5);
    }

    #[test]
    fn batched_and_single_pass_match() {
        // 双声道交错，右声道静音：也验证声道数与帧排列被正确解释。
        let mono = sine(0.1);
        let stereo: Vec<f32> = mono.iter().flat_map(|&sample| [sample, 0.0]).collect();
        let whole = analyze(2, RATE, [stereo.as_slice()]).unwrap().unwrap();
        for frames in [1, 137, 1_024, 7_777] {
            let batched = analyze(2, RATE, stereo.chunks(frames * 2))
                .unwrap()
                .unwrap();
            assert!((whole.integrated_lufs - batched.integrated_lufs).abs() < 1e-9);
        }
        assert!((whole.integrated_lufs - measured(&mono)).abs() < 1e-9);
    }

    #[test]
    fn invalid_inputs_return_errors() {
        for (channels, rate) in [(0, RATE), (1, 0), (u32::MAX, RATE), (1, u32::MAX)] {
            assert!(analyze(channels, rate, std::iter::empty()).is_err());
        }
        assert!(analyze(2, RATE, [&[0.1][..]]).is_err());
        for sample in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert!(analyze(1, RATE, [&[sample][..]]).is_err());
        }
    }

    #[test]
    fn proxy_url_is_restricted_to_current_origin_and_token() {
        let base = "http://127.0.0.1:10857";
        let token = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            proxy_token(&format!("{base}/audio/{token}"), base),
            Ok(token)
        );
        for url in [
            format!("http://127.0.0.1:10858/audio/{token}"),
            format!("https://127.0.0.1:10857/audio/{token}"),
            format!("http://localhost:10857/audio/{token}"),
            format!("https://example.com/audio/{token}"),
            format!("{base}/audio/{token}?extra=1"),
            format!("{base}/audio/{token}#fragment"),
            format!("{base}/audio/../{token}"),
            format!("{base}/audio/short"),
        ] {
            assert!(proxy_token(&url, base).is_err(), "{url}");
        }
    }

    #[test]
    fn only_missing_and_expired_tokens_are_http_skips() {
        for code in [200, 206, 301, 400, 401, 403, 404, 410, 416, 500, 502] {
            assert_eq!(
                skip_status(reqwest::StatusCode::from_u16(code).unwrap()),
                matches!(code, 404 | 410)
            );
        }
    }

    #[test]
    fn range_response_must_match_requested_position_and_length() {
        assert!(validate_content_range(Some("bytes 100-999/1000"), 100, Some(1000)).is_ok());
        for range in [
            None,
            Some("bytes 0-999/1000"),
            Some("bytes 100-99/1000"),
            Some("bytes 100-1000/1000"),
            Some("bytes 100-999/2000"),
            Some("bytes */1000"),
        ] {
            assert!(validate_content_range(range, 100, Some(1000)).is_err());
        }
    }

    #[test]
    fn seek_offsets_are_checked_without_network() {
        assert_eq!(
            seek_position(SeekFrom::Start(50), 10, Some(100)).unwrap(),
            50
        );
        assert_eq!(
            seek_position(SeekFrom::Current(-5), 10, Some(100)).unwrap(),
            5
        );
        assert_eq!(seek_position(SeekFrom::End(-1), 10, Some(100)).unwrap(), 99);
        assert!(seek_position(SeekFrom::Current(-11), 10, Some(100)).is_err());
        assert!(seek_position(SeekFrom::Current(1), u64::MAX, None).is_err());
        assert!(seek_position(SeekFrom::End(0), 10, None).is_err());
    }

    #[test]
    fn expired_deadline_stops_work() {
        assert_eq!(
            remaining(Instant::now() - Duration::from_secs(1))
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
        assert!(remaining(Instant::now() + ANALYSIS_TIMEOUT).is_ok());
    }

    #[test]
    fn energy_history_hour_size_estimate() {
        let blocks = 1 + (3_600_000 - 400) / 100;
        assert_eq!(blocks * std::mem::size_of::<f64>(), 287_976);
        // ebur128 Queue 初始容量 5000；测量当前平台 VecDeque 的扩容开销。
        let mut history = std::collections::VecDeque::<f64>::with_capacity(5_000);
        for _ in 0..blocks {
            history.push_back(1.0);
        }
        let bytes = history.capacity() * std::mem::size_of::<f64>()
            + std::mem::size_of_val(&history)
            + std::mem::size_of::<usize>();
        assert!(bytes < 1_048_576);
        eprintln!(
            "[loudness-memory] blocks={blocks} capacity={} queue_bytes={bytes}",
            history.capacity()
        );
    }

    #[test]
    fn pcm_formats_are_normalized_and_interleaved() {
        use symphonia::core::audio::{layouts::CHANNEL_LAYOUT_STEREO, AudioBuffer, AudioSpec};
        let spec = AudioSpec::new(RATE, CHANNEL_LAYOUT_STEREO);
        let mut samples = Vec::new();
        let mut s16 = AudioBuffer::<i16>::new(spec.clone(), 2);
        s16.render(Some(2), &[i16::MIN, 16_384]);
        copy_pcm(GenericAudioBufferRef::S16(&s16), &mut samples).unwrap();
        assert_eq!(samples, [-1.0, 0.5, -1.0, 0.5]);
        let mut s32 = AudioBuffer::<i32>::new(spec.clone(), 1);
        s32.render(Some(1), &[i32::MIN, 1_073_741_824]);
        copy_pcm(GenericAudioBufferRef::S32(&s32), &mut samples).unwrap();
        assert_eq!(samples, [-1.0, 0.5]);
        let mut floats = AudioBuffer::<f32>::new(spec.clone(), 1);
        floats.render(Some(1), &[-0.25, 0.75]);
        copy_pcm(GenericAudioBufferRef::F32(&floats), &mut samples).unwrap();
        assert_eq!(samples, [-0.25, 0.75]);
        let mut overshoot = AudioBuffer::<f64>::new(spec, 1);
        overshoot.render(Some(1), &[-1.5, 1.5]);
        copy_pcm(GenericAudioBufferRef::F64(&overshoot), &mut samples).unwrap();
        assert_eq!(samples, [-1.0, 1.0]);
    }

    #[test]
    fn non_finite_decoded_pcm_is_rejected() {
        use symphonia::core::audio::{layouts::CHANNEL_LAYOUT_MONO, AudioBuffer, AudioSpec};
        for sample in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut buffer = AudioBuffer::<f32>::new(AudioSpec::new(RATE, CHANNEL_LAYOUT_MONO), 1);
            buffer.render(Some(1), &[sample]);
            assert!(copy_pcm(GenericAudioBufferRef::F32(&buffer), &mut Vec::new()).is_err());
        }
    }
}
