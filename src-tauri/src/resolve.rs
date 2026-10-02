use crate::audio_cache;
use crate::guest_playurl::{GuestPageHint, GuestPlayurlClient};
#[cfg(test)]
use crate::proxy::{build_proxy_client, ProxyState};
use crate::proxy::{validate_cdn_url, StreamEntry, StreamLocation, STREAM_SESSION_TTL};
use crate::state::{AppState, StreamSource};
use crate::ytdlp_adapter::resolve_with_ytdlp;
use serde::Serialize;
#[cfg(test)]
use std::collections::HashMap;
#[cfg(debug_assertions)]
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
#[cfg(test)]
use tokio::sync::RwLock;
use uuid::Uuid;

pub(crate) const AUDIO_RESOLUTION_CANCELLED: &str = "audio resolution was cancelled";

#[derive(Default)]
pub(crate) struct ResolveCoordinator {
    next_id: AtomicU64,
    current: Mutex<Option<ResolveJob>>,
}

pub(crate) struct ResolveJob {
    pub(crate) id: u64,
    pub(crate) cancellation: Arc<AtomicBool>,
}

impl ResolveCoordinator {
    pub(crate) fn begin(&self) -> ResolveJob {
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

    pub(crate) fn cancel_current(&self) {
        if let Some(job) = self
            .current
            .lock()
            .expect("resolve coordinator poisoned")
            .take()
        {
            job.cancellation.store(true, Ordering::Release);
        }
    }

    pub(crate) fn is_current(&self, id: u64) -> bool {
        self.current
            .lock()
            .expect("resolve coordinator poisoned")
            .as_ref()
            .is_some_and(|job| job.id == id && !job.cancellation.load(Ordering::Acquire))
    }

    pub(crate) fn finish(&self, id: u64) {
        let mut current = self.current.lock().expect("resolve coordinator poisoned");
        if current.as_ref().is_some_and(|job| job.id == id) {
            current.take();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioResponse {
    pub(crate) audio_url: String,
    pub(crate) title: String,
    pub(crate) uploader: String,
    pub(crate) thumbnail_url: String,
    pub(crate) duration_seconds: f64,
}

#[tauri::command]
pub(crate) async fn prepare_audio(
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
pub(crate) fn cancel_prepare_audio(state: tauri::State<'_, AppState>) {
    state.resolver.cancel_current();
}

#[cfg(debug_assertions)]
#[tauri::command]
pub(crate) async fn debug_register_local_stream(
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

#[cfg(test)]
mod tests {
    use super::ResolveCoordinator;
    use std::sync::atomic::Ordering;

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
    fn coordinator_old_finish_after_new_begin_keeps_new_job() {
        let coordinator = std::sync::Arc::new(ResolveCoordinator::default());
        let (started, ready) = std::sync::mpsc::channel();
        let (release, proceed) = std::sync::mpsc::channel();
        let old = coordinator.clone();
        let thread = std::thread::spawn(move || {
            let job = old.begin();
            started.send(job.id).unwrap();
            proceed.recv().unwrap();
            old.finish(job.id);
        });
        let old_id = ready.recv().unwrap();
        let new = coordinator.begin();
        assert!(!coordinator.is_current(old_id));
        release.send(()).unwrap();
        thread.join().unwrap();
        assert!(coordinator.is_current(new.id));
    }

    #[test]
    fn coordinator_cancel_between_current_checks_invalidates_job() {
        let coordinator = std::sync::Arc::new(ResolveCoordinator::default());
        let job = coordinator.begin();
        let (release, proceed) = std::sync::mpsc::channel();
        let worker = coordinator.clone();
        let thread = std::thread::spawn(move || {
            proceed.recv().unwrap();
            worker.cancel_current();
        });
        assert!(coordinator.is_current(job.id));
        release.send(()).unwrap();
        thread.join().unwrap();
        assert!(!coordinator.is_current(job.id));
        assert!(job.cancellation.load(Ordering::Acquire));
    }

    #[test]
    fn coordinator_two_threads_begin_supersedes_first_job() {
        let coordinator = std::sync::Arc::new(ResolveCoordinator::default());
        let (started, ready) = std::sync::mpsc::channel();
        let (release, proceed) = std::sync::mpsc::channel();
        let first = coordinator.clone();
        let thread = std::thread::spawn(move || {
            let job = first.begin();
            started.send(job.id).unwrap();
            proceed.recv().unwrap();
            assert!(job.cancellation.load(Ordering::Acquire));
            assert!(!first.is_current(job.id));
        });
        let first_id = ready.recv().unwrap();
        let second = coordinator.clone();
        let next = std::thread::spawn(move || second.begin()).join().unwrap();
        assert_ne!(first_id, next.id);
        assert!(coordinator.is_current(next.id));
        assert!(!next.cancellation.load(Ordering::Acquire));
        release.send(()).unwrap();
        thread.join().unwrap();
    }
}

#[cfg(test)]
mod prepare_tests {
    use super::*;
    use crate::audio_cache::{AudioCacheMetadata, CachedAudio};
    use crate::{fav_import::FavoriteImportClient, ranking::RankingClient, search::SearchClient};
    use bilibili_music_core::StreamAudioInfo;
    use std::sync::atomic::Ordering;
    use std::sync::Mutex;
    use tokio::sync::oneshot;

    struct Gate(Mutex<Option<(oneshot::Sender<()>, oneshot::Receiver<()>)>>);

    impl Gate {
        fn new() -> (Self, oneshot::Receiver<()>, oneshot::Sender<()>) {
            let (arrived, ready) = oneshot::channel();
            let (release, proceed) = oneshot::channel();
            (Self(Mutex::new(Some((arrived, proceed)))), ready, release)
        }

        async fn wait(&self) {
            let (arrived, proceed) = self.0.lock().unwrap().take().unwrap();
            arrived.send(()).unwrap();
            proceed.await.unwrap();
        }
    }

    struct FakeDependencies {
        cached: Mutex<Option<Result<Option<CachedAudio>, String>>>,
        guest_result: Mutex<Option<Result<StreamAudioInfo, String>>>,
        ytdlp_result: Mutex<Option<Result<StreamAudioInfo, String>>>,
        calls: Mutex<Vec<&'static str>>,
        guest_gate: Option<Gate>,
        streams_gate: Option<Gate>,
        ytdlp_label: &'static str,
    }

    impl FakeDependencies {
        fn new() -> Self {
            Self {
                cached: Mutex::new(Some(Ok(None))),
                guest_result: Mutex::new(Some(Ok(stream_info()))),
                ytdlp_result: Mutex::new(Some(Ok(stream_info()))),
                calls: Mutex::new(Vec::new()),
                guest_gate: None,
                streams_gate: None,
                ytdlp_label: "auto fallback",
            }
        }

        fn calls(&self) -> Vec<&'static str> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl PrepareDependencies for FakeDependencies {
        fn lookup_cached_file(
            &self,
            bvid: &str,
            cid: Option<u64>,
        ) -> Result<Option<CachedAudio>, String> {
            assert_eq!(bvid, "BV1234567890");
            assert_eq!(cid, Some(29));
            self.calls.lock().unwrap().push("cache");
            self.cached.lock().unwrap().take().unwrap()
        }

        async fn guest(
            &self,
            _guest: &GuestPlayurlClient,
            bvid: &str,
            page_hint: Option<GuestPageHint>,
            _cancellation: &AtomicBool,
        ) -> Result<StreamAudioInfo, String> {
            assert_eq!(bvid, "BV1234567890");
            let hint = page_hint.unwrap();
            assert_eq!(hint.cid, Some(17));
            assert_eq!(hint.page, Some(3));
            assert_eq!(hint.part.as_deref(), Some("分P"));
            assert_eq!(hint.duration_seconds, Some(121));
            self.calls.lock().unwrap().push("guest");
            if let Some(gate) = &self.guest_gate {
                gate.wait().await;
            }
            self.guest_result.lock().unwrap().take().unwrap()
        }

        async fn ytdlp(
            &self,
            bv_id_for_log: &str,
            resolving_bv_id: &str,
            page: Option<u32>,
            cancellation: Arc<AtomicBool>,
            label: &str,
        ) -> Result<StreamAudioInfo, String> {
            assert_eq!(bv_id_for_log, "BV1234567890");
            assert_eq!(resolving_bv_id, bv_id_for_log);
            assert_eq!(page, Some(3));
            assert_eq!(label, self.ytdlp_label);
            assert!(!cancellation.load(Ordering::Acquire));
            self.calls.lock().unwrap().push("yt-dlp");
            self.ytdlp_result.lock().unwrap().take().unwrap()
        }

        async fn before_streams_lock(&self) {
            if let Some(gate) = &self.streams_gate {
                gate.wait().await;
            }
        }
    }

    fn stream_info() -> StreamAudioInfo {
        // 仅字符串，不发起网络请求；复用白名单 fixture，不调用代理或客户端，不解析 DNS。
        let hosts: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../tests/fixtures/cdn-hosts.json")).unwrap();
        let host = hosts.iter().find(|entry| entry["allowed"] == true).unwrap()["host"]
            .as_str()
            .unwrap();
        StreamAudioInfo {
            audio_url: format!("https://{host}/audio.m4s"),
            title: "曲目".into(),
            uploader: "作者".into(),
            thumbnail_url: "http://127.0.0.1/cover.jpg".into(),
            duration_seconds: 120.5,
            muxed_preview: false,
        }
    }

    fn cached_audio() -> CachedAudio {
        CachedAudio {
            key: "BV1234567890:29".into(),
            path: std::env::temp_dir().join(format!("prepare-{}.m4a", Uuid::new_v4())),
            metadata: AudioCacheMetadata {
                title: "缓存曲目".into(),
                uploader: "缓存作者".into(),
                thumbnail_url: "http://127.0.0.1/cache-cover.jpg".into(),
                duration_seconds: 42,
            },
        }
    }

    fn app_state(source: StreamSource) -> Arc<AppState> {
        // 构造客户端不会发送请求；prepare 的全部 I/O 依赖均由 FakeDependencies 接管。
        let guest = Arc::new(GuestPlayurlClient::new().unwrap());
        Arc::new(AppState {
            loudness_busy: Arc::new(AtomicBool::new(false)),
            cache_busy: Arc::new(AtomicBool::new(false)),
            proxy: ProxyState {
                client: build_proxy_client().unwrap(),
                streams: Arc::new(RwLock::new(HashMap::new())),
            },
            proxy_base_url: "http://127.0.0.1:1234".into(),
            search: SearchClient::new(
                std::env::temp_dir().join("unused-cookies.txt"),
                guest.clone(),
            )
            .unwrap(),
            ranking: RankingClient::new(guest.clone()).unwrap(),
            favorite_import: FavoriteImportClient::new(guest.clone()).unwrap(),
            ranking_cache: Arc::new(RwLock::new(None)),
            guest,
            resolver: Arc::new(ResolveCoordinator::default()),
            stream_source: Arc::new(RwLock::new(source)),
        })
    }

    async fn prepare(
        state: &AppState,
        dependencies: &FakeDependencies,
    ) -> Result<AudioResponse, String> {
        prepare_audio_with_dependencies(
            state,
            "BV1234567890".into(),
            Some(17),
            Some(29),
            Some(3),
            Some("分P".into()),
            Some(120.5),
            dependencies,
        )
        .await
    }

    async fn assert_remote_response(state: &AppState, response: AudioResponse) {
        assert_eq!(response.title, "曲目");
        assert_eq!(response.uploader, "作者");
        assert_eq!(response.thumbnail_url, "https://127.0.0.1/cover.jpg");
        assert_eq!(response.duration_seconds, 120.5);
        let token = response
            .audio_url
            .strip_prefix("http://127.0.0.1:1234/audio/")
            .unwrap();
        assert_eq!(token.len(), 32);
        let streams = state.proxy.streams.read().await;
        assert_eq!(streams.len(), 1);
        assert!(matches!(&streams[token].source, StreamLocation::Remote(url)
            if url.as_str() == stream_info().audio_url));
        assert!(streams[token].expires_at > Instant::now());
        assert!(!state.resolver.is_current(0));
    }

    #[test]
    fn prepare_cache_hit_registers_local_token_without_resolving() {
        tauri::async_runtime::block_on(async {
            let state = app_state(StreamSource::Auto);
            let dependencies = FakeDependencies::new();
            let cached = cached_audio();
            let path = cached.path.clone();
            *dependencies.cached.lock().unwrap() = Some(Ok(Some(cached)));
            let response = prepare(&state, &dependencies).await.unwrap();
            assert_eq!(dependencies.calls(), ["cache"]);
            assert_eq!(response.title, "缓存曲目");
            assert_eq!(response.uploader, "缓存作者");
            assert_eq!(response.thumbnail_url, "http://127.0.0.1/cache-cover.jpg");
            assert_eq!(response.duration_seconds, 42.0);
            let token = response
                .audio_url
                .strip_prefix("http://127.0.0.1:1234/audio/")
                .unwrap();
            assert_eq!(token.len(), 32);
            let streams = state.proxy.streams.read().await;
            assert_eq!(streams.len(), 1);
            assert!(
                matches!(&streams[token].source, StreamLocation::Local(value) if value == &path)
            );
            assert!(!state.resolver.is_current(0));
        });
    }

    #[test]
    fn prepare_corrupt_cache_lookup_falls_back_to_resolution() {
        tauri::async_runtime::block_on(async {
            let state = app_state(StreamSource::Guest);
            let dependencies = FakeDependencies::new();
            *dependencies.cached.lock().unwrap() = Some(Err("corrupt cache entry".into()));
            let response = prepare(&state, &dependencies).await.unwrap();
            assert_eq!(dependencies.calls(), ["cache", "guest"]);
            assert_remote_response(&state, response).await;
        });
    }

    #[test]
    fn prepare_guest_success_registers_remote_token() {
        tauri::async_runtime::block_on(async {
            let state = app_state(StreamSource::Guest);
            let dependencies = FakeDependencies::new();
            let response = prepare(&state, &dependencies).await.unwrap();
            assert_eq!(dependencies.calls(), ["cache", "guest"]);
            assert_remote_response(&state, response).await;
        });
    }

    #[test]
    fn prepare_guest_failure_returns_error_without_fallback() {
        tauri::async_runtime::block_on(async {
            let state = app_state(StreamSource::Guest);
            let dependencies = FakeDependencies::new();
            *dependencies.guest_result.lock().unwrap() = Some(Err("guest failed".into()));
            assert_eq!(
                prepare(&state, &dependencies).await.err().unwrap(),
                "guest failed"
            );
            assert_eq!(dependencies.calls(), ["cache", "guest"]);
            assert!(state.proxy.streams.read().await.is_empty());
            assert!(!state.resolver.is_current(0));
        });
    }

    #[test]
    fn prepare_auto_guest_failure_falls_back_to_ytdlp() {
        tauri::async_runtime::block_on(async {
            let state = app_state(StreamSource::Auto);
            let dependencies = FakeDependencies::new();
            *dependencies.guest_result.lock().unwrap() = Some(Err("guest failed".into()));
            let response = prepare(&state, &dependencies).await.unwrap();
            assert_eq!(dependencies.calls(), ["cache", "guest", "yt-dlp"]);
            assert_remote_response(&state, response).await;
        });
    }

    #[test]
    fn prepare_auto_cancelled_guest_error_does_not_fallback() {
        tauri::async_runtime::block_on(async {
            let state = app_state(StreamSource::Auto);
            let dependencies = FakeDependencies::new();
            *dependencies.guest_result.lock().unwrap() =
                Some(Err(AUDIO_RESOLUTION_CANCELLED.into()));
            assert_eq!(
                prepare(&state, &dependencies).await.err().unwrap(),
                AUDIO_RESOLUTION_CANCELLED
            );
            assert_eq!(dependencies.calls(), ["cache", "guest"]);
            assert!(state.proxy.streams.read().await.is_empty());
            assert!(!state.resolver.is_current(0));
        });
    }

    async fn guest_failure_after_job_change(supersede: bool) {
        let state = app_state(StreamSource::Auto);
        let mut dependencies = FakeDependencies::new();
        *dependencies.guest_result.lock().unwrap() = Some(Err("guest failed".into()));
        let (gate, ready, release) = Gate::new();
        dependencies.guest_gate = Some(gate);
        let dependencies = Arc::new(dependencies);
        let worker_state = state.clone();
        let worker_dependencies = dependencies.clone();
        let task = tauri::async_runtime::spawn(async move {
            prepare(&worker_state, &worker_dependencies).await
        });
        ready.await.unwrap();
        assert!(state.resolver.is_current(0));
        let new_job = if supersede {
            Some(state.resolver.begin())
        } else {
            state.resolver.cancel_current();
            None
        };
        release.send(()).unwrap();
        assert_eq!(
            task.await.unwrap().err().unwrap(),
            AUDIO_RESOLUTION_CANCELLED
        );
        assert_eq!(dependencies.calls(), ["cache", "guest"]);
        assert!(state.proxy.streams.read().await.is_empty());
        assert!(!state.resolver.is_current(0));
        if let Some(job) = new_job {
            assert!(state.resolver.is_current(job.id));
        }
    }

    #[test]
    fn prepare_auto_cancelled_job_does_not_fallback() {
        tauri::async_runtime::block_on(guest_failure_after_job_change(false));
    }

    #[test]
    fn prepare_auto_superseded_job_does_not_fallback() {
        tauri::async_runtime::block_on(guest_failure_after_job_change(true));
    }

    #[test]
    fn prepare_rejected_cdn_does_not_register_token() {
        tauri::async_runtime::block_on(async {
            let state = app_state(StreamSource::Guest);
            let dependencies = FakeDependencies::new();
            let mut info = stream_info();
            info.audio_url = "http://127.0.0.1/audio.m4s".into();
            *dependencies.guest_result.lock().unwrap() = Some(Ok(info));
            assert_eq!(
                prepare(&state, &dependencies).await.err().unwrap(),
                "audio CDN host is not allowed: 127.0.0.1"
            );
            assert_eq!(dependencies.calls(), ["cache", "guest"]);
            assert!(state.proxy.streams.read().await.is_empty());
            assert!(!state.resolver.is_current(0));
        });
    }

    async fn replacement_between_registration_checks(cached: bool) {
        let state = app_state(StreamSource::Guest);
        let mut dependencies = FakeDependencies::new();
        if cached {
            *dependencies.cached.lock().unwrap() = Some(Ok(Some(cached_audio())));
        }
        let (gate, ready, release) = Gate::new();
        dependencies.streams_gate = Some(gate);
        let dependencies = Arc::new(dependencies);
        let streams = state.proxy.streams.write().await;
        let worker_state = state.clone();
        let worker_dependencies = dependencies.clone();
        let task = tauri::async_runtime::spawn(async move {
            prepare(&worker_state, &worker_dependencies).await
        });
        // 钩子到达证明第一遍核验已通过；持有 streams 写锁，直到新 job 替换旧 job。
        ready.await.unwrap();
        assert!(state.resolver.is_current(0));
        let new_job = state.resolver.begin();
        release.send(()).unwrap();
        drop(streams);
        assert_eq!(
            task.await.unwrap().err().unwrap(),
            AUDIO_RESOLUTION_CANCELLED
        );
        assert!(state.proxy.streams.read().await.is_empty());
        assert!(state.resolver.is_current(new_job.id));
        assert_eq!(
            dependencies.calls(),
            if cached {
                vec!["cache"]
            } else {
                vec!["cache", "guest"]
            }
        );
    }

    #[test]
    fn prepare_cached_job_replaced_between_checks_does_not_register_token() {
        tauri::async_runtime::block_on(replacement_between_registration_checks(true));
    }

    #[test]
    fn prepare_remote_job_replaced_between_checks_does_not_register_token() {
        tauri::async_runtime::block_on(replacement_between_registration_checks(false));
    }

    #[test]
    fn prepare_old_finish_after_guest_success_keeps_new_job() {
        tauri::async_runtime::block_on(async {
            let state = app_state(StreamSource::Guest);
            let mut dependencies = FakeDependencies::new();
            let (gate, ready, release) = Gate::new();
            dependencies.guest_gate = Some(gate);
            let worker_state = state.clone();
            let task =
                tauri::async_runtime::spawn(
                    async move { prepare(&worker_state, &dependencies).await },
                );
            ready.await.unwrap();
            assert!(state.resolver.is_current(0));
            let new_job = state.resolver.begin();
            release.send(()).unwrap();
            assert_eq!(
                task.await.unwrap().err().unwrap(),
                AUDIO_RESOLUTION_CANCELLED
            );
            assert!(state.resolver.is_current(new_job.id));
            assert!(!new_job.cancellation.load(Ordering::Acquire));
            assert!(state.proxy.streams.read().await.is_empty());
        });
    }
}
