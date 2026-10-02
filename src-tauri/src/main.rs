#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod appearance;
mod audio_cache;
mod commands;
mod fav_import;
mod guest_playurl;
mod library;
mod loudness;
mod lyrics;
mod mini_player;
mod proxy;
mod ranking;
mod resolve;
mod search;
mod shortcuts;
mod state;
mod storage;
mod taskbar;
mod wbi;
mod ytdlp_adapter;

use axum::routing::get;
use axum::Router;
use bilibili_music_core::{bilibili_cookie_path, yt_dlp_path};
use serde::Serialize;
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
#[cfg(debug_assertions)]
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;
use tokio::sync::RwLock;
use uuid::Uuid;

use appearance::{choose_background_image, load_background_image};
use guest_playurl::{GuestPageHint, GuestPlayurlClient};
use loudness::analyze_track_loudness;
use proxy::{
    build_proxy_client, proxy_audio, validate_cdn_url, ProxyState, StreamEntry, StreamLocation,
    STREAM_SESSION_TTL,
};
use ranking::{RankingClient, RankingTrack};
use resolve::{ResolveCoordinator, AUDIO_RESOLUTION_CANCELLED};
use search::SearchClient;
use state::{AppState, StreamSource};
use ytdlp_adapter::resolve_with_ytdlp;

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
    // cid 表示用户选定的分P，单P 时前端传 null；cache_cid 表示当前实际播放的分P，
    // 只用于缓存键，两者不可混用。
    cache_cid: Option<u64>,
    page: Option<u32>,
    part: Option<String>,
    duration_seconds: Option<f64>,
) -> Result<AudioResponse, String> {
    prepare_audio_with_dependencies(
        &state,
        bv_id,
        cid,
        cache_cid,
        page,
        part,
        duration_seconds,
        &RealPrepareDependencies,
    )
    .await
}

trait PrepareDependencies: Sync {
    fn lookup_cached_file(
        &self,
        bvid: &str,
        cid: Option<u64>,
    ) -> Result<Option<audio_cache::CachedAudio>, String>;

    fn guest(
        &self,
        guest: &GuestPlayurlClient,
        bvid: &str,
        page_hint: Option<GuestPageHint>,
        cancellation: &AtomicBool,
    ) -> impl std::future::Future<Output = Result<bilibili_music_core::StreamAudioInfo, String>> + Send;

    fn ytdlp(
        &self,
        bv_id_for_log: &str,
        resolving_bv_id: &str,
        page: Option<u32>,
        cancellation: Arc<AtomicBool>,
        label: &str,
    ) -> impl std::future::Future<Output = Result<bilibili_music_core::StreamAudioInfo, String>> + Send;

    #[cfg(test)]
    fn before_streams_lock(&self) -> impl std::future::Future<Output = ()> + Send {
        async {}
    }
}

struct RealPrepareDependencies;

impl PrepareDependencies for RealPrepareDependencies {
    fn lookup_cached_file(
        &self,
        bvid: &str,
        cid: Option<u64>,
    ) -> Result<Option<audio_cache::CachedAudio>, String> {
        audio_cache::lookup_cached_file(bvid, cid)
    }

    async fn guest(
        &self,
        guest: &GuestPlayurlClient,
        bvid: &str,
        page_hint: Option<GuestPageHint>,
        cancellation: &AtomicBool,
    ) -> Result<bilibili_music_core::StreamAudioInfo, String> {
        guest.resolve(bvid, page_hint, cancellation).await
    }

    async fn ytdlp(
        &self,
        bv_id_for_log: &str,
        resolving_bv_id: &str,
        page: Option<u32>,
        cancellation: Arc<AtomicBool>,
        label: &str,
    ) -> Result<bilibili_music_core::StreamAudioInfo, String> {
        resolve_with_ytdlp(bv_id_for_log, resolving_bv_id, page, cancellation, label).await
    }
}

async fn prepare_audio_with_dependencies(
    state: &AppState,
    bv_id: String,
    cid: Option<u64>,
    cache_cid: Option<u64>,
    page: Option<u32>,
    part: Option<String>,
    duration_seconds: Option<f64>,
    dependencies: &impl PrepareDependencies,
) -> Result<AudioResponse, String> {
    let job = state.resolver.begin();
    let job_id = job.id;
    let cancellation = job.cancellation;
    let result = async {
        let cached = match dependencies.lookup_cached_file(&bv_id, cache_cid) {
            Ok(cached) => cached,
            Err(error) => {
                #[cfg(debug_assertions)]
                eprintln!("[audio-cache] lookup failed: {error}");
                #[cfg(not(debug_assertions))]
                let _ = error;
                None
            }
        };
        if let Some(cached) = cached {
            if !state.resolver.is_current(job_id) {
                return Err(AUDIO_RESOLUTION_CANCELLED.to_owned());
            }
            let token = Uuid::new_v4().simple().to_string();
            let now = Instant::now();
            #[cfg(test)]
            dependencies.before_streams_lock().await;
            let mut streams = state.proxy.streams.write().await;
            if !state.resolver.is_current(job_id) {
                return Err(AUDIO_RESOLUTION_CANCELLED.to_owned());
            }
            streams.retain(|_, stream| stream.expires_at > now);
            streams.insert(
                token.clone(),
                StreamEntry {
                    source: StreamLocation::Local(cached.path),
                    expires_at: now + STREAM_SESSION_TTL,
                },
            );
            drop(streams);
            #[cfg(debug_assertions)]
            eprintln!("[audio-cache] hit key={}", cached.key);

            // 索引中的封面 URL 来自前端已规范化的值，命中时直接使用。
            return Ok(AudioResponse {
                audio_url: format!("{}/audio/{token}", state.proxy_base_url),
                title: cached.metadata.title,
                uploader: cached.metadata.uploader,
                thumbnail_url: cached.metadata.thumbnail_url,
                duration_seconds: cached.metadata.duration_seconds as f64,
            });
        }
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
                match dependencies
                    .guest(&state.guest, &resolving_bv_id, Some(page_hint.clone()), &cancellation)
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
                        dependencies.ytdlp(
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
                dependencies.ytdlp(
                    &bv_id,
                    &resolving_bv_id,
                    page_hint.page,
                    cancellation.clone(),
                    "yt-dlp",
                )
                .await?
            }
            StreamSource::Guest => {
                match dependencies
                    .guest(&state.guest, &resolving_bv_id, Some(page_hint.clone()), &cancellation)
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
        #[cfg(test)]
        dependencies.before_streams_lock().await;
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
            cache_busy: Arc::new(AtomicBool::new(false)),
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
            library::playlists::create_imported_playlist,
            taskbar::set_taskbar_playback_state,
            mini_player::open_mini_player,
            mini_player::mini_player_ready,
            mini_player::exit_mini_player,
            prepare_audio,
            analyze_track_loudness,
            audio_cache::cache_track_audio,
            audio_cache::get_audio_cache_settings,
            audio_cache::set_audio_cache_settings,
            audio_cache::get_audio_cache_usage,
            audio_cache::clear_audio_cache,
            library::loudness_store::get_track_loudness,
            library::loudness_store::clear_loudness_data,
            commands::media::get_video_pages,
            commands::media::get_video_meta,
            lyrics::get_cached_video_pages,
            lyrics::clear_video_pages_cache,
            cancel_prepare_audio,
            #[cfg(debug_assertions)]
            debug_register_local_stream,
            commands::discovery::search_videos,
            commands::discovery::get_music_ranking,
            commands::runtime::get_stream_source,
            commands::runtime::get_yt_dlp_availability,
            commands::runtime::set_stream_source,
            commands::runtime::open_bilibili_video,
            choose_background_image,
            load_background_image,
            library::favorites::list_favorites,
            library::favorites::is_favorite,
            library::favorites::toggle_favorite,
            library::favorites::reorder_favorite,
            library::playlists::list_playlists,
            library::playlists::create_playlist,
            library::playlists::rename_playlist,
            library::playlists::delete_playlist,
            library::playlists::add_to_playlist,
            library::playlists::remove_from_playlist,
            library::playlists::reorder_playlist_item,
            library::playlists::reorder_playlist,
            library::history::record_search_history,
            library::history::get_search_history,
            library::history::clear_search_history,
            library::shortcut_config::get_shortcuts,
            library::shortcut_config::set_shortcuts,
            library::history::record_play,
            library::history::get_play_history,
            library::playback_state::get_playback_state,
            library::playback_state::save_playback_state,
            library::playback_state::clear_playback_state,
            library::unavailable::mark_track_unavailable,
            library::unavailable::clear_track_unavailable,
            library::unavailable::list_unavailable_tracks,
            library::disabled_pages::list_disabled_pages,
            library::disabled_pages::set_page_disabled,
            library::disabled_pages::clear_disabled_pages,
            library::unavailable::purge_unavailable_tracks,
            ai::get_ai_config,
            ai::set_ai_config,
            ai::test_ai_connection,
            ai::get_saved_recommendations,
            lyrics::get_lyrics_by_id,
            lyrics::search_lyrics_songs,
            lyrics::clear_lyrics_cache,
            lyrics::get_lyrics_offset,
            lyrics::set_lyrics_offset,
            commands::media::resolve_lyrics,
            lyrics::get_lyrics_binding,
            lyrics::set_lyrics_binding,
            lyrics::clear_lyrics_binding,
            commands::discovery::get_recommendations,
            library::backup::export_data,
            library::backup::import_data
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}

#[cfg(test)]
pub(crate) mod tests {
    // Test-only Rust lexical scan: blank comments without changing byte offsets or newlines.
    pub(crate) fn without_rust_comments(source: &str) -> String {
        let bytes = source.as_bytes();
        let mut output = bytes.to_vec();
        let mut i = 0;
        while i < bytes.len() {
            let start = i;
            if bytes[i..].starts_with(b"//") {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            } else if bytes[i..].starts_with(b"/*") {
                let mut depth = 1;
                i += 2;
                while i < bytes.len() && depth > 0 {
                    if bytes[i..].starts_with(b"/*") {
                        depth += 1;
                        i += 2;
                    } else if bytes[i..].starts_with(b"*/") {
                        depth -= 1;
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
            } else {
                if bytes[i] == b'r' {
                    let mut quote = i + 1;
                    while bytes.get(quote) == Some(&b'#') {
                        quote += 1;
                    }
                    if bytes.get(quote) == Some(&b'"') {
                        let hashes = quote - i - 1;
                        i = quote + 1;
                        while i < bytes.len() {
                            if bytes[i] == b'"'
                                && bytes.get(i + 1..i + 1 + hashes)
                                    == Some(&bytes[start + 1..quote])
                            {
                                i += 1 + hashes;
                                break;
                            }
                            i += 1;
                        }
                        continue;
                    }
                }
                // An apostrophe starts a char only if followed by an escape or one
                // Unicode scalar and a closing quote; otherwise it is a lifetime.
                let is_char = bytes[i] == b'\''
                    && (bytes.get(i + 1) == Some(&b'\\')
                        || source
                            .get(i + 1..)
                            .and_then(|tail| tail.chars().next())
                            .is_some_and(|c| bytes.get(i + 1 + c.len_utf8()) == Some(&b'\'')));
                if bytes[i] == b'"' || is_char {
                    let quote = bytes[i];
                    i += 1;
                    while i < bytes.len() {
                        if bytes[i] == b'\\' {
                            i = (i + 2).min(bytes.len());
                        } else if bytes[i] == quote {
                            i += 1;
                            break;
                        } else {
                            i += 1;
                        }
                    }
                } else {
                    i += 1;
                }
                continue;
            }
            for byte in &mut output[start..i] {
                if *byte != b'\n' && *byte != b'\r' {
                    *byte = b' ';
                }
            }
        }
        String::from_utf8(output).unwrap()
    }

    #[test]
    fn comment_scan_preserves_literals_lifetimes_and_newlines() {
        let source = r###"// real comment "keyword"
let a = "https://example.com";
let b = "/* not comment */";
let c = r#"// not comment"#;
let e = r"/* raw */";
let f = r##"// raw with " and #"##;
/* outer /* inner */ outer */
fn f<'a>(x: &'a str) -> char { '"' }
let d = '\'';
let escaped = "\"// still a string";
let unicode = '中'; // 中文 comment
"###;
        let clean = without_rust_comments(source);
        assert_eq!(source.len(), clean.len());
        assert_eq!(
            source
                .match_indices('\n')
                .map(|(i, _)| i)
                .collect::<Vec<_>>(),
            clean
                .match_indices('\n')
                .map(|(i, _)| i)
                .collect::<Vec<_>>()
        );
        for comment in ["keyword", "outer", "inner", "中文 comment"] {
            assert!(!clean.contains(comment), "{comment}");
        }
        for line in source
            .lines()
            .filter(|line| line.starts_with("let ") || line.starts_with("fn "))
        {
            let code = line.split("; // 中文 comment").next().unwrap();
            assert!(clean.contains(code), "{code}");
        }
        assert_eq!(
            without_rust_comments("a/* x\r\ny */b//z\r\n"),
            "a    \r\n    b   \r\n"
        );
    }

    #[test]
    fn playback_error_keywords_remain_in_rust_sources() {
        let entries: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../tests/playback-error-contract.json")).unwrap();
        for entry in entries {
            let Some(path) = entry["rustSource"].as_str() else {
                continue;
            };
            let source = match path {
                "src/lib.rs" => include_str!("../../src/lib.rs"),
                "src-tauri/src/guest_playurl.rs" => include_str!("guest_playurl.rs"),
                other => panic!("unexpected Rust source: {other}"),
            };
            let source = without_rust_comments(source);
            let keyword = entry["keyword"].as_str().unwrap();
            if let Some(template) = entry["rustTemplate"].as_str() {
                assert!(
                    source.contains(template),
                    "{path} no longer contains {template:?}"
                );
                let sample = entry["sampleError"].as_str().unwrap();
                let mut segments = template.split("{}");
                let first = segments.next().unwrap();
                let mut rest = sample
                    .strip_prefix(first)
                    .expect("sample must start with template prefix");
                for segment in segments {
                    let position = rest
                        .find(segment)
                        .expect("sample must contain template segments in order");
                    rest = &rest[position + segment.len()..];
                }
                assert!(
                    sample.contains(keyword),
                    "{sample:?} does not contain {keyword:?}"
                );
            } else {
                assert!(
                    source.contains(keyword),
                    "{path} no longer contains {keyword:?}"
                );
            }
        }
    }
}

#[cfg(test)]
mod contract_tests;
