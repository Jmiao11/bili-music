#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod appearance;
mod audio_cache;
mod fav_import;
mod guest_playurl;
mod library;
mod loudness;
mod lyrics;
mod mini_player;
mod ranking;
mod search;
mod shortcuts;
mod taskbar;
mod wbi;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::header::{
    ACCEPT_ENCODING, ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_EXPOSE_HEADERS,
    CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_RANGE, LAST_MODIFIED,
    RANGE, REFERER, USER_AGENT,
};
use axum::http::{HeaderMap, Method, Request, Response, StatusCode};
use axum::routing::get;
use axum::Router;
use bilibili_music_core::{
    bilibili_cookie_path, resolve_bilibili_audio_cancellable_with_page, yt_dlp_path, AudioError,
    StreamAudioInfo, BILIBILI_REFERER, DESKTOP_USER_AGENT,
};
use reqwest::redirect::Policy;
use serde::Serialize;
use std::collections::HashMap;
use std::io::SeekFrom;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::path::{Path as FilePath, PathBuf};
use std::pin::Pin;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tauri::Manager;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt, ReadBuf};
use tokio::sync::RwLock;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use appearance::{choose_background_image, load_background_image};
use guest_playurl::{GuestPageHint, GuestPlayurlClient, VideoPage};
use library::{
    add_to_playlist, clear_playback_state, clear_search_history, clear_track_unavailable,
    create_playlist, delete_playlist, export_data, get_play_history, get_playback_state,
    get_search_history, get_shortcuts, import_data, is_favorite, list_favorites, list_playlists,
    list_unavailable_tracks, mark_track_unavailable, purge_unavailable_tracks, record_play,
    record_search_history, remove_from_playlist, rename_playlist, reorder_favorite,
    reorder_playlist, reorder_playlist_item, save_playback_state, set_shortcuts, toggle_favorite,
};
use loudness::analyze_track_loudness;
use ranking::{RankingClient, RankingTrack};
use search::{SearchClient, SearchVideo};

const STREAM_SESSION_TTL: Duration = Duration::from_secs(60 * 60);
const AUDIO_RESOLUTION_CANCELLED: &str = "audio resolution was cancelled";

#[derive(Clone)]
struct ProxyState {
    client: reqwest::Client,
    streams: Arc<RwLock<HashMap<String, StreamEntry>>>,
}

#[derive(Clone)]
struct StreamEntry {
    source: StreamLocation,
    expires_at: Instant,
}

#[derive(Clone)]
enum StreamLocation {
    Remote(reqwest::Url),
    Local(PathBuf),
}

struct AppState {
    loudness_busy: Arc<AtomicBool>,
    proxy: ProxyState,
    proxy_base_url: String,
    search: SearchClient,
    ranking: RankingClient,
    favorite_import: fav_import::FavoriteImportClient,
    ranking_cache: Arc<RwLock<Option<Vec<RankingTrack>>>>,
    guest: Arc<GuestPlayurlClient>,
    resolver: Arc<ResolveCoordinator>,
    stream_source: Arc<RwLock<StreamSource>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StreamSource {
    Auto,
    YtDlp,
    Guest,
}

impl StreamSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::YtDlp => "yt-dlp",
            Self::Guest => "guest",
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "auto" => Ok(Self::Auto),
            "yt-dlp" => Ok(Self::YtDlp),
            "guest" => Ok(Self::Guest),
            _ => Err(format!("unsupported stream source: {value}")),
        }
    }
}

#[derive(Default)]
struct ResolveCoordinator {
    next_id: AtomicU64,
    current: Mutex<Option<ResolveJob>>,
}

struct ResolveJob {
    id: u64,
    cancellation: Arc<AtomicBool>,
}

impl ResolveCoordinator {
    fn begin(&self) -> ResolveJob {
        let job = ResolveJob {
            id: self.next_id.fetch_add(1, Ordering::Relaxed),
            cancellation: Arc::new(AtomicBool::new(false)),
        };
        let mut current = self.current.lock().expect("resolve coordinator poisoned");
        if let Some(previous) = current.replace(ResolveJob {
            id: job.id,
            cancellation: job.cancellation.clone(),
        }) {
            previous.cancellation.store(true, Ordering::Release);
        }
        job
    }

    fn cancel_current(&self) {
        if let Some(job) = self
            .current
            .lock()
            .expect("resolve coordinator poisoned")
            .take()
        {
            job.cancellation.store(true, Ordering::Release);
        }
    }

    fn is_current(&self, id: u64) -> bool {
        self.current
            .lock()
            .expect("resolve coordinator poisoned")
            .as_ref()
            .is_some_and(|job| job.id == id && !job.cancellation.load(Ordering::Acquire))
    }

    fn finish(&self, id: u64) {
        let mut current = self.current.lock().expect("resolve coordinator poisoned");
        if current.as_ref().is_some_and(|job| job.id == id) {
            current.take();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioResponse {
    audio_url: String,
    title: String,
    uploader: String,
    thumbnail_url: String,
    duration_seconds: f64,
}

#[tauri::command]
async fn prepare_audio(
    state: tauri::State<'_, AppState>,
    bv_id: String,
    cid: Option<u64>,
    page: Option<u32>,
    part: Option<String>,
    duration_seconds: Option<f64>,
) -> Result<AudioResponse, String> {
    let job = state.resolver.begin();
    let job_id = job.id;
    let cancellation = job.cancellation;
    let result = async {
        let resolving_bv_id = bv_id.clone();
        let page_hint = GuestPageHint {
            cid,
            page,
            part,
            duration_seconds: duration_seconds.map(|value| value.max(0.0).round() as u64),
        };
        let source = *state.stream_source.read().await;
        eprintln!(
            "[prepare_audio] begin {bv_id} cid={cid:?} source={}",
            source.as_str()
        );
        let info = match source {
            StreamSource::Auto => {
                match state
                    .guest
                    .resolve(&resolving_bv_id, Some(page_hint.clone()), &cancellation)
                    .await
                {
                    Ok(info) => info,
                    Err(guest_error) => {
                        if guest_error == AUDIO_RESOLUTION_CANCELLED
                            || !state.resolver.is_current(job_id)
                        {
                            return Err(AUDIO_RESOLUTION_CANCELLED.to_owned());
                        }
                        eprintln!(
                            "[prepare_audio][auto] guest failed for {bv_id}: {guest_error}; falling back to yt-dlp"
                        );
                        resolve_with_ytdlp(
                            &bv_id,
                            &resolving_bv_id,
                            page_hint.page,
                            cancellation.clone(),
                            "auto fallback",
                        )
                            .await?
                    }
                }
            }
            StreamSource::YtDlp => {
                resolve_with_ytdlp(
                    &bv_id,
                    &resolving_bv_id,
                    page_hint.page,
                    cancellation.clone(),
                    "yt-dlp",
                )
                .await?
            }
            StreamSource::Guest => {
                match state
                    .guest
                    .resolve(&resolving_bv_id, Some(page_hint.clone()), &cancellation)
                    .await
                {
                    Ok(info) => info,
                    Err(error) => {
                        if error != AUDIO_RESOLUTION_CANCELLED {
                            eprintln!("[prepare_audio][guest] {bv_id}: {error}");
                        }
                        return Err(error);
                    }
                }
            }
        };

        if info.muxed_preview {
            eprintln!(
                "[prepare_audio] {bv_id}: no DASH audio for guest (fresh upload?), using muxed durl stream"
            );
        }

        if !state.resolver.is_current(job_id) {
            return Err(AUDIO_RESOLUTION_CANCELLED.to_owned());
        }

        let upstream_url = reqwest::Url::parse(&info.audio_url).map_err(|error| {
            format!("{} returned an invalid audio URL: {error}", source.as_str())
        })?;
        let validation = validate_cdn_url(&upstream_url);
        #[cfg(debug_assertions)]
        eprintln!(
            "[stream-diag] validate host={} result={:?}",
            upstream_url.host_str().unwrap_or("?"), validation
        );
        validation?;
        let upstream_host = upstream_url.host_str().unwrap_or("?").to_owned();

        let token = Uuid::new_v4().simple().to_string();
        let now = Instant::now();
        let mut streams = state.proxy.streams.write().await;
        if !state.resolver.is_current(job_id) {
            return Err(AUDIO_RESOLUTION_CANCELLED.to_owned());
        }
        streams.retain(|_, stream| stream.expires_at > now);
        streams.insert(
            token.clone(),
            StreamEntry {
                source: StreamLocation::Remote(upstream_url),
                expires_at: now + STREAM_SESSION_TTL,
            },
        );
        drop(streams);

        let thumbnail_url = info
            .thumbnail_url
            .strip_prefix("http://")
            .map(|url| format!("https://{url}"))
            .unwrap_or(info.thumbnail_url);
        eprintln!(
            "[prepare_audio] resolved {bv_id} muxed={} host={upstream_host}",
            info.muxed_preview
        );

        Ok(AudioResponse {
            audio_url: format!("{}/audio/{token}", state.proxy_base_url),
            title: info.title,
            uploader: info.uploader,
            thumbnail_url,
            duration_seconds: info.duration_seconds,
        })
    }
    .await;
    state.resolver.finish(job_id);
    result
}

#[tauri::command]
async fn get_video_pages(
    state: tauri::State<'_, AppState>,
    bv_id: String,
) -> Result<Vec<VideoPage>, String> {
    state.guest.pages(&bv_id).await
}

#[tauri::command]
async fn get_video_meta(
    state: tauri::State<'_, AppState>,
    bvid: String,
) -> Result<lyrics::VideoMeta, String> {
    let cookie_header = state.guest.guest_cookie_header().await?;
    let meta = lyrics::fetch_video_meta(&bvid, &cookie_header).await?;
    if meta.videos >= 1 {
        let videos = meta.videos;
        let pages = meta.pages.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = lyrics::cache_video_pages(bvid, videos, pages) {
                eprintln!("[video-pages-cache] write failed: {error}");
            }
        });
    }
    Ok(meta)
}

#[tauri::command]
async fn resolve_lyrics(
    state: tauri::State<'_, AppState>,
    bvid: String,
    cid: i64,
    force: Option<bool>,
) -> Result<lyrics::ResolveOutcome, String> {
    let cookie_header = state.guest.guest_cookie_header().await?;
    lyrics::resolve_lyrics(&bvid, cid, force.unwrap_or(false), &cookie_header).await
}

#[tauri::command]
fn cancel_prepare_audio(state: tauri::State<'_, AppState>) {
    state.resolver.cancel_current();
}

#[cfg(debug_assertions)]
#[tauri::command]
async fn debug_register_local_stream(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let token = Uuid::new_v4().simple().to_string();
    state.proxy.streams.write().await.insert(
        token.clone(),
        StreamEntry {
            source: StreamLocation::Local(PathBuf::from(path)),
            expires_at: Instant::now() + STREAM_SESSION_TTL,
        },
    );
    Ok(format!("{}/audio/{token}", state.proxy_base_url))
}

#[tauri::command]
async fn search_videos(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
    tids: Option<u32>,
    order: Option<String>,
    sort_mode: Option<String>,
    rerank: bool,
) -> Result<Vec<SearchVideo>, String> {
    state
        .search
        .search_videos_page(
            &keyword,
            page.unwrap_or(1),
            tids,
            order.as_deref(),
            sort_mode.as_deref(),
            rerank,
        )
        .await
}

#[tauri::command]
async fn get_music_ranking(
    state: tauri::State<'_, AppState>,
    force_refresh: Option<bool>,
) -> Result<Vec<RankingTrack>, String> {
    if !force_refresh.unwrap_or(false) {
        if let Some(cached) = state.ranking_cache.read().await.as_ref().cloned() {
            return Ok(cached);
        }
    }

    let tracks = state.ranking.music_ranking().await?;
    *state.ranking_cache.write().await = Some(tracks.clone());
    Ok(tracks)
}

#[tauri::command]
async fn get_recommendations(
    state: tauri::State<'_, AppState>,
    user_hint: Option<String>,
) -> Result<Vec<SearchVideo>, String> {
    let recommendations = ai::generate_recommendations(&state.search, user_hint).await?;
    if !recommendations.is_empty() {
        if let Err(error) = ai::save_recommendations(&recommendations) {
            eprintln!("failed to save recommendations: {error}");
        }
    }
    Ok(recommendations)
}

async fn resolve_with_ytdlp(
    bv_id_for_log: &str,
    resolving_bv_id: &str,
    page: Option<u32>,
    cancellation: Arc<AtomicBool>,
    label: &str,
) -> Result<StreamAudioInfo, String> {
    let resolving_bv_id = resolving_bv_id.to_owned();
    let resolution = tauri::async_runtime::spawn_blocking(move || {
        resolve_bilibili_audio_cancellable_with_page(&resolving_bv_id, page, &cancellation)
    })
    .await;
    match resolution {
        Ok(Ok(info)) => Ok(info),
        Ok(Err(error)) => {
            if !matches!(error, AudioError::Cancelled) {
                eprintln!("[prepare_audio][{label}] {bv_id_for_log}: {error}");
            }
            Err(error.to_string())
        }
        Err(error) => {
            let message = format!("audio task failed: {error}");
            eprintln!("[prepare_audio][{label}] {bv_id_for_log}: {message}");
            Err(message)
        }
    }
}

#[tauri::command]
async fn get_stream_source(state: tauri::State<'_, AppState>) -> Result<String, String> {
    Ok(state.stream_source.read().await.as_str().to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YtDlpAvailability {
    available: bool,
    path: String,
}

#[tauri::command]
fn get_yt_dlp_availability() -> Result<YtDlpAvailability, String> {
    let path = yt_dlp_path();
    Ok(YtDlpAvailability {
        available: path.is_file(),
        path: path.display().to_string(),
    })
}

#[tauri::command]
async fn set_stream_source(
    state: tauri::State<'_, AppState>,
    source: String,
) -> Result<String, String> {
    let parsed = StreamSource::parse(&source)?;
    *state.stream_source.write().await = parsed;
    eprintln!("[runtime] stream source switched to {}", parsed.as_str());
    Ok(parsed.as_str().to_owned())
}

#[tauri::command]
fn open_bilibili_video(bv_id: String) -> Result<(), String> {
    let bv_id = bv_id.trim();
    if !is_valid_bvid(bv_id) {
        return Err(format!("invalid Bilibili BV ID: {bv_id}"));
    }

    let url = format!("https://www.bilibili.com/video/{bv_id}");
    open_url_in_system_browser(&url)
}

fn is_valid_bvid(value: &str) -> bool {
    value.len() == 12
        && value.starts_with("BV")
        && value[2..].bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn open_url_in_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open system browser: {error}"))
}

async fn proxy_audio(
    State(state): State<ProxyState>,
    Path(token): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let method = request.method().clone();
    if method != Method::GET && method != Method::HEAD {
        return empty_response(StatusCode::METHOD_NOT_ALLOWED);
    }

    let entry = {
        let streams = state.streams.read().await;
        streams.get(&token).cloned()
    };
    let Some(entry) = entry else {
        return empty_response(StatusCode::NOT_FOUND);
    };
    if entry.expires_at <= Instant::now() {
        state.streams.write().await.remove(&token);
        return empty_response(StatusCode::GONE);
    }

    let url = match entry.source {
        StreamLocation::Remote(url) => url,
        StreamLocation::Local(path) => {
            let range = request
                .headers()
                .get(RANGE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            // 本地响应没有 ETag / Last-Modified，因此刻意忽略 If-Range。
            return proxy_local_audio(&path, method, range.as_deref()).await;
        }
    };

    let upstream_host = url.host_str().unwrap_or("?").to_owned();
    let mut upstream_request = state
        .client
        .request(method.clone(), url)
        .header(REFERER, BILIBILI_REFERER)
        .header(USER_AGENT, DESKTOP_USER_AGENT)
        .header(ACCEPT_ENCODING, "identity");
    upstream_request = forward_request_header(request.headers(), upstream_request, RANGE);
    upstream_request = forward_request_header(request.headers(), upstream_request, IF_RANGE);

    let upstream = match upstream_request.send().await {
        Ok(response) => response,
        Err(error) => {
            eprintln!("[audio-proxy] upstream request failed: {error}");
            return empty_response(StatusCode::BAD_GATEWAY);
        }
    };

    let status = upstream.status();
    if !(status.is_success() || status.as_u16() == 206) {
        eprintln!(
            "[audio-proxy] upstream returned HTTP {} for {}",
            status.as_u16(),
            upstream_host
        );
    }
    let mut response = Response::builder()
        .status(status)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(ACCEPT_RANGES, "bytes")
        .header(
            ACCESS_CONTROL_EXPOSE_HEADERS,
            "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified",
        );
    for name in [
        CONTENT_LENGTH,
        CONTENT_RANGE,
        ETAG,
        LAST_MODIFIED,
        CACHE_CONTROL,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            response = response.header(name, value);
        }
    }

    // 部分B站CDN节点对音轨返回 application/octet-stream；macOS WKWebView
    // 拒绝把该类型当作媒体解码（表现为时间停在0、无进度）。本代理只服务
    // B站音频流（MP4 容器），遇到八进制流或缺失类型时改写为 audio/mp4。
    let upstream_content_type = upstream
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .unwrap_or("");
    let normalized_content_type = if upstream_content_type.is_empty()
        || upstream_content_type.eq_ignore_ascii_case("application/octet-stream")
    {
        if !upstream_content_type.is_empty() {
            eprintln!(
                "[audio-proxy] normalized content-type '{}' to audio/mp4 for {upstream_host}",
                upstream_content_type
            );
        }
        "audio/mp4"
    } else {
        upstream_content_type
    };
    response = response.header(CONTENT_TYPE, normalized_content_type);

    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from_stream(upstream.bytes_stream())
    };
    response
        .body(body)
        .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LocalByteRange {
    Full,
    Partial { start: u64, end: u64 },
    Unsatisfiable,
}

fn parse_local_range(value: Option<&str>, len: u64) -> LocalByteRange {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return LocalByteRange::Full;
    };
    let Some((unit, range)) = value.split_once('=') else {
        return LocalByteRange::Full;
    };
    let range = range.trim();
    if !unit.trim().eq_ignore_ascii_case("bytes") || range.contains(',') {
        return LocalByteRange::Full;
    }
    let Some((start, end)) = range.split_once('-') else {
        return LocalByteRange::Full;
    };
    let start = start.trim();
    let end = end.trim();

    if start.is_empty() {
        let Ok(suffix) = end.parse::<u64>() else {
            return LocalByteRange::Full;
        };
        if suffix == 0 || len == 0 {
            return LocalByteRange::Unsatisfiable;
        }
        let suffix = suffix.min(len);
        return LocalByteRange::Partial {
            start: len - suffix,
            end: len - 1,
        };
    }

    let Ok(start) = start.parse::<u64>() else {
        return LocalByteRange::Full;
    };
    if end.is_empty() {
        return if start >= len {
            LocalByteRange::Unsatisfiable
        } else {
            LocalByteRange::Partial {
                start,
                end: len - 1,
            }
        };
    }

    let Ok(end) = end.parse::<u64>() else {
        return LocalByteRange::Full;
    };
    if start > end {
        LocalByteRange::Full
    } else if start >= len {
        LocalByteRange::Unsatisfiable
    } else {
        LocalByteRange::Partial {
            start,
            end: end.min(len - 1),
        }
    }
}

fn local_content_range(range: LocalByteRange, len: u64) -> Option<String> {
    match range {
        LocalByteRange::Full => None,
        LocalByteRange::Partial { start, end } => Some(format!("bytes {start}-{end}/{len}")),
        LocalByteRange::Unsatisfiable => Some(format!("bytes */{len}")),
    }
}

struct LoggingReader<R> {
    inner: R,
    path: PathBuf,
}

impl<R: AsyncRead + Unpin> AsyncRead for LoggingReader<R> {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        match Pin::new(&mut this.inner).poll_read(context, buffer) {
            Poll::Ready(Err(error)) => {
                eprintln!(
                    "[audio-proxy] local stream read failed for {}: {error}",
                    this.path.display()
                );
                Poll::Ready(Err(error))
            }
            result => result,
        }
    }
}

async fn proxy_local_audio(
    path: &FilePath,
    method: Method,
    range_header: Option<&str>,
) -> Response<Body> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => return empty_response(StatusCode::NOT_FOUND),
        Err(error) => return empty_response(local_file_error_status(&error)),
    };
    let len = metadata.len();
    let range = parse_local_range(range_header, len);
    let (status, start, content_length) = match range {
        LocalByteRange::Full => (StatusCode::OK, 0, len),
        LocalByteRange::Partial { start, end } => {
            (StatusCode::PARTIAL_CONTENT, start, end - start + 1)
        }
        LocalByteRange::Unsatisfiable => (StatusCode::RANGE_NOT_SATISFIABLE, 0, 0),
    };

    let body = if method == Method::HEAD
        || range == LocalByteRange::Unsatisfiable
        || content_length == 0
    {
        Body::empty()
    } else {
        let mut file = match tokio::fs::File::open(path).await {
            Ok(file) => file,
            Err(error) => {
                eprintln!(
                    "[audio-proxy] failed to open local stream {}: {error}",
                    path.display()
                );
                return empty_response(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };
        if let Err(error) = file.seek(SeekFrom::Start(start)).await {
            eprintln!(
                "[audio-proxy] failed to seek local stream {}: {error}",
                path.display()
            );
            return empty_response(StatusCode::INTERNAL_SERVER_ERROR);
        }
        let reader = LoggingReader {
            inner: file.take(content_length),
            path: path.to_owned(),
        };
        Body::from_stream(ReaderStream::new(reader))
    };

    let mut response = Response::builder()
        .status(status)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(ACCEPT_RANGES, "bytes")
        .header(
            ACCESS_CONTROL_EXPOSE_HEADERS,
            "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified",
        )
        .header(CONTENT_TYPE, "audio/mp4")
        .header(CONTENT_LENGTH, content_length);
    if let Some(content_range) = local_content_range(range, len) {
        response = response.header(CONTENT_RANGE, content_range);
    }
    response
        .body(body)
        .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
}

fn local_file_error_status(error: &std::io::Error) -> StatusCode {
    if error.kind() == std::io::ErrorKind::NotFound {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

fn forward_request_header(
    headers: &HeaderMap,
    request: reqwest::RequestBuilder,
    name: axum::http::HeaderName,
) -> reqwest::RequestBuilder {
    if let Some(value) = headers.get(&name) {
        request.header(name, value.clone())
    } else {
        request
    }
}

fn empty_response(status: StatusCode) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::empty())
        .expect("static proxy response must be valid")
}

// 修改主机白名单时必须同步 guest_playurl.rs 的 stream_diag_allowed_host（候选排序与诊断）。
fn validate_cdn_url(url: &reqwest::Url) -> Result<(), String> {
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("audio URL uses a disallowed scheme".to_owned());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "audio URL has no host".to_owned())?
        .to_ascii_lowercase();
    let allowed_bilibili_domain = ["bilivideo.com", "bilivideo.cn"]
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")));
    let allowed_exact_mirror = host == "upos-hz-mirrorakam.akamaized.net";
    if !allowed_bilibili_domain && !allowed_exact_mirror {
        return Err(format!("audio CDN host is not allowed: {host}"));
    }

    Ok(())
}

fn build_proxy_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .redirect(Policy::none())
        .build()
}

fn main() {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .expect("failed to bind the local audio proxy");
    listener
        .set_nonblocking(true)
        .expect("failed to configure the local audio proxy");
    let port = listener
        .local_addr()
        .expect("failed to read the local audio proxy address")
        .port();

    let proxy = ProxyState {
        client: build_proxy_client().expect("failed to create the audio proxy client"),
        streams: Arc::new(RwLock::new(HashMap::new())),
    };
    let server_proxy = proxy.clone();
    let cookie_path = bilibili_cookie_path();
    let yt_dlp = yt_dlp_path();
    eprintln!(
        "[runtime] cwd={} cookie={} yt-dlp={}",
        std::env::current_dir()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|error| format!("<unavailable: {error}>")),
        cookie_path.display(),
        yt_dlp.display()
    );
    let guest =
        Arc::new(GuestPlayurlClient::new().expect("failed to create the guest playurl client"));
    let search = SearchClient::new(cookie_path, Arc::clone(&guest))
        .expect("failed to create the search client");
    let ranking =
        RankingClient::new(Arc::clone(&guest)).expect("failed to create the ranking client");
    let favorite_import = fav_import::FavoriteImportClient::new(Arc::clone(&guest))
        .expect("failed to create the favorite import client");

    tauri::Builder::default()
        .on_window_event(|window, event| {
            if window.label() == mini_player::MINI_WINDOW_LABEL
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                if let Err(error) = mini_player::restore_main_window(window.app_handle()) {
                    eprintln!("[mini-player] close recovery failed: {error}");
                }
            }
        })
        .manage(AppState {
            loudness_busy: Arc::new(AtomicBool::new(false)),
            proxy,
            proxy_base_url: format!("http://127.0.0.1:{port}"),
            search,
            ranking,
            favorite_import,
            ranking_cache: Arc::new(RwLock::new(None)),
            guest,
            resolver: Arc::new(ResolveCoordinator::default()),
            stream_source: Arc::new(RwLock::new(StreamSource::Guest)),
        })
        .setup(move |app| {
            taskbar::install(app);
            shortcuts::install(app);
            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::from_std(listener)
                    .expect("failed to start the local audio proxy listener");
                let router = Router::new()
                    .route("/audio/{token}", get(proxy_audio).head(proxy_audio))
                    .with_state(server_proxy);
                if let Err(error) = axum::serve(listener, router).await {
                    eprintln!("local audio proxy stopped: {error}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fav_import::read_public_favorite_page,
            library::create_imported_playlist,
            taskbar::set_taskbar_playback_state,
            mini_player::open_mini_player,
            mini_player::mini_player_ready,
            mini_player::exit_mini_player,
            prepare_audio,
            analyze_track_loudness,
            library::get_track_loudness,
            library::clear_loudness_data,
            get_video_pages,
            get_video_meta,
            lyrics::get_cached_video_pages,
            lyrics::clear_video_pages_cache,
            cancel_prepare_audio,
            #[cfg(debug_assertions)]
            debug_register_local_stream,
            search_videos,
            get_music_ranking,
            get_stream_source,
            get_yt_dlp_availability,
            set_stream_source,
            open_bilibili_video,
            choose_background_image,
            load_background_image,
            list_favorites,
            is_favorite,
            toggle_favorite,
            reorder_favorite,
            list_playlists,
            create_playlist,
            rename_playlist,
            delete_playlist,
            add_to_playlist,
            remove_from_playlist,
            reorder_playlist_item,
            reorder_playlist,
            record_search_history,
            get_search_history,
            clear_search_history,
            get_shortcuts,
            set_shortcuts,
            record_play,
            get_play_history,
            get_playback_state,
            save_playback_state,
            clear_playback_state,
            mark_track_unavailable,
            clear_track_unavailable,
            list_unavailable_tracks,
            purge_unavailable_tracks,
            ai::get_ai_config,
            ai::set_ai_config,
            ai::test_ai_connection,
            ai::get_saved_recommendations,
            lyrics::get_lyrics_by_id,
            lyrics::search_lyrics_songs,
            lyrics::clear_lyrics_cache,
            lyrics::get_lyrics_offset,
            lyrics::set_lyrics_offset,
            resolve_lyrics,
            lyrics::get_lyrics_binding,
            lyrics::set_lyrics_binding,
            lyrics::clear_lyrics_binding,
            get_recommendations,
            export_data,
            import_data
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        is_valid_bvid, local_content_range, parse_local_range, proxy_local_audio, validate_cdn_url,
        LocalByteRange, ResolveCoordinator, StreamEntry, StreamLocation,
    };
    use axum::http::{header, Method, StatusCode};
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};
    use uuid::Uuid;

    #[test]
    fn stream_entry_sources_construct_and_match() {
        let url = reqwest::Url::parse("https://example.bilivideo.com/audio.m4s").unwrap();
        let remote = StreamEntry {
            source: StreamLocation::Remote(url.clone()),
            expires_at: Instant::now() + Duration::from_secs(1),
        };
        assert!(matches!(remote.source, StreamLocation::Remote(value) if value == url));

        let path = PathBuf::from("track.m4a");
        let local = StreamEntry {
            source: StreamLocation::Local(path.clone()),
            expires_at: Instant::now() + Duration::from_secs(1),
        };
        assert!(matches!(local.source, StreamLocation::Local(value) if value == path));
    }

    #[test]
    fn missing_local_stream_returns_not_found() {
        let path = std::env::temp_dir().join(format!("missing-{}.m4a", Uuid::new_v4()));
        let response = tauri::async_runtime::block_on(proxy_local_audio(&path, Method::GET, None));
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn local_stream_response_has_audio_headers() {
        let path = std::env::temp_dir().join(format!("local-stream-{}.m4a", Uuid::new_v4()));
        std::fs::write(&path, [1, 2, 3, 4]).unwrap();

        let response = tauri::async_runtime::block_on(proxy_local_audio(&path, Method::GET, None));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "audio/mp4");
        assert_eq!(response.headers()[header::CONTENT_LENGTH], "4");
        assert_eq!(response.headers()[header::ACCEPT_RANGES], "bytes");
        assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");

        let head = tauri::async_runtime::block_on(proxy_local_audio(&path, Method::HEAD, None));
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(head.headers()[header::CONTENT_LENGTH], "4");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn local_range_parses_full_and_explicit_ranges() {
        assert_eq!(parse_local_range(None, 1_000), LocalByteRange::Full);
        assert_eq!(
            parse_local_range(Some("bytes=0-"), 1_000),
            LocalByteRange::Partial { start: 0, end: 999 }
        );
        assert_eq!(
            parse_local_range(Some("bytes=100-199"), 1_000),
            LocalByteRange::Partial {
                start: 100,
                end: 199,
            }
        );
        assert_eq!(
            parse_local_range(Some("bytes=100-"), 1_000),
            LocalByteRange::Partial {
                start: 100,
                end: 999,
            }
        );
        assert_eq!(
            parse_local_range(Some("bytes=900-2000"), 1_000),
            LocalByteRange::Partial {
                start: 900,
                end: 999,
            }
        );
    }

    #[test]
    fn local_range_parses_suffix_ranges() {
        assert_eq!(
            parse_local_range(Some("bytes=-500"), 1_000),
            LocalByteRange::Partial {
                start: 500,
                end: 999,
            }
        );
        assert_eq!(
            parse_local_range(Some("bytes=-2000"), 1_000),
            LocalByteRange::Partial { start: 0, end: 999 }
        );
        assert_eq!(
            parse_local_range(Some("bytes=-0"), 1_000),
            LocalByteRange::Unsatisfiable
        );
    }

    #[test]
    fn local_range_rejects_out_of_bounds_and_ignores_unsupported_syntax() {
        assert_eq!(
            parse_local_range(Some("bytes=1000-"), 1_000),
            LocalByteRange::Unsatisfiable
        );
        assert_eq!(
            parse_local_range(Some("bytes=1001-"), 1_000),
            LocalByteRange::Unsatisfiable
        );
        assert_eq!(
            parse_local_range(Some("bytes=200-100"), 1_000),
            LocalByteRange::Full
        );
        assert_eq!(
            parse_local_range(Some("bytes=0-99,200-299"), 1_000),
            LocalByteRange::Full
        );
        assert_eq!(
            parse_local_range(Some("items=0-99"), 1_000),
            LocalByteRange::Full
        );
        assert_eq!(
            parse_local_range(Some("completely malformed"), 1_000),
            LocalByteRange::Full
        );
    }

    #[test]
    fn local_range_accepts_whitespace_and_handles_empty_files() {
        assert_eq!(
            parse_local_range(Some("  bytes = 100 - 199  "), 1_000),
            LocalByteRange::Partial {
                start: 100,
                end: 199,
            }
        );
        assert_eq!(parse_local_range(None, 0), LocalByteRange::Full);
        assert_eq!(
            parse_local_range(Some("bytes=0-"), 0),
            LocalByteRange::Unsatisfiable
        );
        assert_eq!(
            parse_local_range(Some("bytes=-1"), 0),
            LocalByteRange::Unsatisfiable
        );
    }

    #[test]
    fn local_content_range_matches_loudness_validation_rules() {
        let range = LocalByteRange::Partial {
            start: 100,
            end: 999,
        };
        let value = local_content_range(range, 1_000).unwrap();
        assert_eq!(value, "bytes 100-999/1000");
        assert_eq!(
            local_content_range(LocalByteRange::Unsatisfiable, 1_000).as_deref(),
            Some("bytes */1000")
        );

        // 复刻 loudness.rs::validate_content_range 的私有判定，不修改其可见性。
        let parsed = value.strip_prefix("bytes ").and_then(|value| {
            let (range, total) = value.split_once('/')?;
            let (start, end) = range.split_once('-')?;
            Some((
                start.parse::<u64>().ok()?,
                end.parse::<u64>().ok()?,
                total.parse::<u64>().ok()?,
            ))
        });
        assert!(matches!(
            parsed,
            Some((start, end, total))
                if start == 100 && end >= start && end < total && total == 1_000
        ));
    }

    #[test]
    fn local_partial_response_has_range_headers() {
        let path = std::env::temp_dir().join(format!("local-range-{}.m4a", Uuid::new_v4()));
        std::fs::write(&path, [1, 2, 3, 4]).unwrap();

        let partial = tauri::async_runtime::block_on(proxy_local_audio(
            &path,
            Method::GET,
            Some("bytes=1-2"),
        ));
        assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(partial.headers()[header::CONTENT_RANGE], "bytes 1-2/4");
        assert_eq!(partial.headers()[header::CONTENT_LENGTH], "2");

        let unsatisfiable =
            tauri::async_runtime::block_on(proxy_local_audio(&path, Method::GET, Some("bytes=4-")));
        assert_eq!(unsatisfiable.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(unsatisfiable.headers()[header::CONTENT_RANGE], "bytes */4");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn allows_bilibili_audio_cdn_subdomains() {
        let url = reqwest::Url::parse("https://example.bilivideo.com/audio.m4s").unwrap();
        assert!(validate_cdn_url(&url).is_ok());
    }

    #[test]
    fn allows_the_observed_bilibili_akamai_mirror() {
        let url =
            reqwest::Url::parse("https://upos-hz-mirrorakam.akamaized.net/audio.m4s").unwrap();
        assert!(validate_cdn_url(&url).is_ok());
    }

    #[test]
    fn rejects_hosts_outside_the_cdn_allowlist() {
        let url = reqwest::Url::parse("https://bilivideo.com.example.org/audio.m4s").unwrap();
        assert!(validate_cdn_url(&url).is_err());

        let unrelated_akamai =
            reqwest::Url::parse("https://unrelated.akamaized.net/audio.m4s").unwrap();
        assert!(validate_cdn_url(&unrelated_akamai).is_err());
    }

    #[test]
    fn newer_resolution_cancels_and_supersedes_the_previous_one() {
        let coordinator = ResolveCoordinator::default();
        let first = coordinator.begin();
        let second = coordinator.begin();

        assert!(first.cancellation.load(Ordering::Acquire));
        assert!(!coordinator.is_current(first.id));
        assert!(coordinator.is_current(second.id));

        coordinator.finish(first.id);
        assert!(coordinator.is_current(second.id));
        coordinator.cancel_current();
        assert!(!coordinator.is_current(second.id));
        assert!(second.cancellation.load(Ordering::Acquire));
    }

    #[test]
    fn validates_bvid_before_opening_external_browser() {
        assert!(is_valid_bvid("BV1faGX65EgK"));
        assert!(!is_valid_bvid("av123"));
        assert!(!is_valid_bvid(
            "https://www.bilibili.com/video/BV1faGX65EgK"
        ));
    }
}
