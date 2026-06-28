#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appearance;
mod guest_playurl;
mod library;
mod ranking;
mod search;
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
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use uuid::Uuid;

use appearance::{choose_background_image, load_background_image};
use guest_playurl::{GuestPageHint, GuestPlayurlClient, VideoPage};
use library::{
    add_to_playlist, clear_search_history, create_playlist, delete_playlist, get_search_history,
    is_favorite, list_favorites, list_playlists, record_search_history, remove_from_playlist,
    rename_playlist, toggle_favorite,
};
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
    url: reqwest::Url,
    expires_at: Instant,
}

struct AppState {
    proxy: ProxyState,
    proxy_base_url: String,
    search: SearchClient,
    ranking: RankingClient,
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

        if !state.resolver.is_current(job_id) {
            return Err(AUDIO_RESOLUTION_CANCELLED.to_owned());
        }

        let upstream_url = reqwest::Url::parse(&info.audio_url).map_err(|error| {
            format!("{} returned an invalid audio URL: {error}", source.as_str())
        })?;
        validate_cdn_url(&upstream_url)?;

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
                url: upstream_url,
                expires_at: now + STREAM_SESSION_TTL,
            },
        );
        drop(streams);

        let thumbnail_url = info
            .thumbnail_url
            .strip_prefix("http://")
            .map(|url| format!("https://{url}"))
            .unwrap_or(info.thumbnail_url);

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
fn cancel_prepare_audio(state: tauri::State<'_, AppState>) {
    state.resolver.cancel_current();
}

#[tauri::command]
async fn search_videos(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
    tids: Option<u32>,
    order: Option<String>,
) -> Result<Vec<SearchVideo>, String> {
    state
        .search
        .search_videos_page(&keyword, page.unwrap_or(1), tids, order.as_deref())
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

    let mut upstream_request = state
        .client
        .request(method.clone(), entry.url)
        .header(REFERER, BILIBILI_REFERER)
        .header(USER_AGENT, DESKTOP_USER_AGENT)
        .header(ACCEPT_ENCODING, "identity");
    upstream_request = forward_request_header(request.headers(), upstream_request, RANGE);
    upstream_request = forward_request_header(request.headers(), upstream_request, IF_RANGE);

    let upstream = match upstream_request.send().await {
        Ok(response) => response,
        Err(_) => return empty_response(StatusCode::BAD_GATEWAY),
    };

    let status = upstream.status();
    let mut response = Response::builder()
        .status(status)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(ACCEPT_RANGES, "bytes")
        .header(
            ACCESS_CONTROL_EXPOSE_HEADERS,
            "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified",
        );
    for name in [
        CONTENT_TYPE,
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

    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from_stream(upstream.bytes_stream())
    };
    response
        .body(body)
        .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
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

    tauri::Builder::default()
        .manage(AppState {
            proxy,
            proxy_base_url: format!("http://127.0.0.1:{port}"),
            search,
            ranking,
            ranking_cache: Arc::new(RwLock::new(None)),
            guest,
            resolver: Arc::new(ResolveCoordinator::default()),
            stream_source: Arc::new(RwLock::new(StreamSource::Guest)),
        })
        .setup(move |_| {
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
            prepare_audio,
            get_video_pages,
            cancel_prepare_audio,
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
            list_playlists,
            create_playlist,
            rename_playlist,
            delete_playlist,
            add_to_playlist,
            remove_from_playlist,
            record_search_history,
            get_search_history,
            clear_search_history
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}

#[cfg(test)]
mod tests {
    use super::{is_valid_bvid, validate_cdn_url, ResolveCoordinator};
    use std::sync::atomic::Ordering;

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
