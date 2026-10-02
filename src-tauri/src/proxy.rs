use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::header::{
    ACCEPT_ENCODING, ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_EXPOSE_HEADERS,
    CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_RANGE, LAST_MODIFIED,
    RANGE, REFERER, USER_AGENT,
};
use axum::http::{HeaderMap, Method, Request, Response, StatusCode};
use bilibili_music_core::{BILIBILI_REFERER, DESKTOP_USER_AGENT};
use reqwest::redirect::Policy;
use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::{Path as FilePath, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt, ReadBuf};
use tokio::sync::RwLock;
use tokio_util::io::ReaderStream;

pub(crate) const STREAM_SESSION_TTL: Duration = Duration::from_secs(60 * 60);

#[derive(Clone)]
pub(crate) struct ProxyState {
    pub(crate) client: reqwest::Client,
    pub(crate) streams: Arc<RwLock<HashMap<String, StreamEntry>>>,
}

#[derive(Clone)]
pub(crate) struct StreamEntry {
    pub(crate) source: StreamLocation,
    pub(crate) expires_at: Instant,
}

#[derive(Clone)]
pub(crate) enum StreamLocation {
    Remote(reqwest::Url),
    Local(PathBuf),
}

pub(crate) async fn proxy_audio(
    State(state): State<ProxyState>,
    Path(token): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let method = request.method().clone();
    if method != Method::GET && method != Method::HEAD {
        return empty_response(StatusCode::METHOD_NOT_ALLOWED);
    }
    #[cfg(debug_assertions)]
    let token_tail = token.get(token.len().saturating_sub(8)..).unwrap_or("?");

    let entry = {
        let streams = state.streams.read().await;
        streams.get(&token).cloned()
    };
    let Some(entry) = entry else {
        #[cfg(debug_assertions)]
        eprintln!("[audio-proxy] token=...{token_tail} status=404");
        return empty_response(StatusCode::NOT_FOUND);
    };
    if entry.expires_at <= Instant::now() {
        #[cfg(debug_assertions)]
        eprintln!(
            "[audio-proxy] token=...{token_tail} status=410 registered_for_ms={}",
            Instant::now()
                .saturating_duration_since(entry.expires_at - STREAM_SESSION_TTL)
                .as_millis()
        );
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
            let response = proxy_local_audio(&path, method, range.as_deref()).await;
            #[cfg(debug_assertions)]
            if response.status() == StatusCode::NOT_FOUND {
                eprintln!("[audio-proxy] token=...{token_tail} status=404");
            }
            return response;
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
    #[cfg(debug_assertions)]
    if status == StatusCode::NOT_FOUND {
        eprintln!("[audio-proxy] token=...{token_tail} status=404");
    } else if status == StatusCode::GONE {
        eprintln!(
            "[audio-proxy] token=...{token_tail} status=410 registered_for_ms={}",
            Instant::now()
                .saturating_duration_since(entry.expires_at - STREAM_SESSION_TTL)
                .as_millis()
        );
    }
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
        Ok(_) => {
            #[cfg(debug_assertions)]
            eprintln!(
                "[audio-proxy] local stream is not a file: {}",
                path.display()
            );
            return empty_response(StatusCode::NOT_FOUND);
        }
        Err(error) => {
            #[cfg(debug_assertions)]
            eprintln!(
                "[audio-proxy] failed to read local stream metadata {}: {error}",
                path.display()
            );
            return empty_response(local_file_error_status(&error));
        }
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
pub(crate) fn validate_cdn_url(url: &reqwest::Url) -> Result<(), String> {
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

pub(crate) fn build_proxy_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .redirect(Policy::none())
        .build()
}

#[cfg(test)]
mod tests {
    use super::{
        local_content_range, parse_local_range, proxy_local_audio, validate_cdn_url,
        LocalByteRange, StreamEntry, StreamLocation,
    };
    use axum::http::{header, Method, StatusCode};
    use std::path::PathBuf;
    use std::time::{Duration, Instant};
    use uuid::Uuid;

    #[test]
    fn cdn_hosts_match_shared_fixture() {
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../tests/fixtures/cdn-hosts.json")).unwrap();
        for case in cases {
            let host = case["host"].as_str().unwrap();
            let url = reqwest::Url::parse(&format!("https://{host}/audio.m4s")).unwrap();
            assert_eq!(
                validate_cdn_url(&url).is_ok(),
                case["allowed"].as_bool().unwrap(),
                "{host}"
            );
        }
    }

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
    fn proxy_http_missing_and_expired_tokens_have_empty_bodies() {
        tauri::async_runtime::block_on(async {
            let state = test_proxy_state("http://127.0.0.1:1/audio.m4s", true);
            let (status, headers, body) =
                test_proxy_request(state.clone(), Method::GET, "missing", Default::default()).await;
            assert_eq!(status, StatusCode::NOT_FOUND);
            assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
            assert!(body.is_empty());
            let (status, _, body) =
                test_proxy_request(state.clone(), Method::GET, "test-token", Default::default())
                    .await;
            assert_eq!(status, StatusCode::GONE);
            assert!(body.is_empty());
            assert!(state.streams.read().await.is_empty());
        });
    }

    #[test]
    fn proxy_http_get_forwards_request_and_response_headers_and_body() {
        let response = b"HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mp4\r\nContent-Length: 2\r\nContent-Range: bytes 1-2/4\r\nETag: \"sample\"\r\nLast-Modified: Wed, 01 Jan 2025 00:00:00 GMT\r\nCache-Control: max-age=60\r\nConnection: close\r\n\r\nbc".to_vec();
        let (url, request, upstream) = test_upstream(response);
        tauri::async_runtime::block_on(async {
            let mut headers = axum::http::HeaderMap::new();
            headers.insert(header::RANGE, "bytes=1-2".parse().unwrap());
            headers.insert(header::IF_RANGE, "\"sample\"".parse().unwrap());
            let (status, headers, body) = test_proxy_request(
                test_proxy_state(&url, false),
                Method::GET,
                "test-token",
                headers,
            )
            .await;
            assert_eq!(status, StatusCode::PARTIAL_CONTENT);
            assert_eq!(body, b"bc");
            assert_eq!(headers[header::CONTENT_TYPE], "audio/mp4");
            assert_eq!(headers[header::CONTENT_LENGTH], "2");
            assert_eq!(headers[header::CONTENT_RANGE], "bytes 1-2/4");
            assert_eq!(headers[header::ETAG], "\"sample\"");
            assert_eq!(
                headers[header::LAST_MODIFIED],
                "Wed, 01 Jan 2025 00:00:00 GMT"
            );
            assert_eq!(headers[header::CACHE_CONTROL], "max-age=60");
            assert_eq!(headers[header::ACCEPT_RANGES], "bytes");
            assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
            assert_eq!(
                headers[header::ACCESS_CONTROL_EXPOSE_HEADERS],
                "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified"
            );
        });
        let request = request.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(request.starts_with("GET /audio.m4s HTTP/1.1\r\n"));
        let headers = request.to_ascii_lowercase();
        assert!(headers.contains("\r\nrange: bytes=1-2\r\n"));
        assert!(headers.contains("\r\nif-range: \"sample\"\r\n"));
        assert!(headers.contains(&format!(
            "\r\nreferer: {}\r\n",
            bilibili_music_core::BILIBILI_REFERER
        )));
        assert!(headers.contains(&format!(
            "\r\nuser-agent: {}\r\n",
            bilibili_music_core::DESKTOP_USER_AGENT.to_ascii_lowercase()
        )));
        assert!(headers.contains("\r\naccept-encoding: identity\r\n"));
        upstream.join().unwrap();
    }

    #[test]
    fn proxy_http_head_forwards_method_and_keeps_body_empty() {
        let (url, request, upstream) = test_upstream(b"HTTP/1.1 200 OK\r\nContent-Type: audio/mp4\r\nContent-Length: 4\r\nConnection: close\r\n\r\n".to_vec());
        tauri::async_runtime::block_on(async {
            let (status, headers, body) = test_proxy_request(
                test_proxy_state(&url, false),
                Method::HEAD,
                "test-token",
                Default::default(),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(headers[header::CONTENT_LENGTH], "4");
            assert!(body.is_empty());
        });
        assert!(request
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .starts_with("HEAD /audio.m4s HTTP/1.1\r\n"));
        upstream.join().unwrap();
    }

    #[test]
    fn proxy_http_normalizes_octet_stream_and_missing_mime() {
        for content_type in ["Content-Type: application/octet-stream\r\n", ""] {
            let response = format!("HTTP/1.1 200 OK\r\n{content_type}Content-Length: 4\r\nConnection: close\r\n\r\ndata");
            let (url, request, upstream) = test_upstream(response.into_bytes());
            tauri::async_runtime::block_on(async {
                let (status, headers, body) = test_proxy_request(
                    test_proxy_state(&url, false),
                    Method::GET,
                    "test-token",
                    Default::default(),
                )
                .await;
                assert_eq!(status, StatusCode::OK);
                assert_eq!(headers[header::CONTENT_TYPE], "audio/mp4");
                assert_eq!(body, b"data");
            });
            request.recv_timeout(Duration::from_secs(5)).unwrap();
            upstream.join().unwrap();
        }
    }

    #[test]
    fn proxy_http_preserves_upstream_failure_status_and_body() {
        for (code, reason) in [(404, "Not Found"), (502, "Bad Gateway")] {
            let response = format!("HTTP/1.1 {code} {reason}\r\nContent-Type: text/plain\r\nContent-Length: 4\r\nConnection: close\r\n\r\noops");
            let (url, request, upstream) = test_upstream(response.into_bytes());
            tauri::async_runtime::block_on(async {
                let (status, headers, body) = test_proxy_request(
                    test_proxy_state(&url, false),
                    Method::GET,
                    "test-token",
                    Default::default(),
                )
                .await;
                assert_eq!(status.as_u16(), code);
                assert_eq!(headers[header::CONTENT_TYPE], "text/plain");
                assert_eq!(body, b"oops");
            });
            request.recv_timeout(Duration::from_secs(5)).unwrap();
            upstream.join().unwrap();
        }
    }

    #[test]
    fn proxy_http_connection_failure_maps_to_bad_gateway() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/audio.m4s", listener.local_addr().unwrap());
        drop(listener);
        tauri::async_runtime::block_on(async {
            let (status, _, body) = test_proxy_request(
                test_proxy_state(&url, false),
                Method::GET,
                "test-token",
                Default::default(),
            )
            .await;
            assert_eq!(status, StatusCode::BAD_GATEWAY);
            assert!(body.is_empty());
        });
    }

    #[test]
    fn local_stream_bodies_match_full_partial_head_and_unsatisfiable_ranges() {
        let path = std::env::temp_dir().join(format!("local-bodies-{}.m4a", Uuid::new_v4()));
        std::fs::write(&path, b"abcd").unwrap();
        tauri::async_runtime::block_on(async {
            for (method, range, expected_status, expected_body) in [
                (Method::GET, None, StatusCode::OK, &b"abcd"[..]),
                (
                    Method::GET,
                    Some("bytes=1-2"),
                    StatusCode::PARTIAL_CONTENT,
                    &b"bc"[..],
                ),
                (Method::HEAD, None, StatusCode::OK, &b""[..]),
                (
                    Method::HEAD,
                    Some("bytes=1-2"),
                    StatusCode::PARTIAL_CONTENT,
                    &b""[..],
                ),
                (
                    Method::GET,
                    Some("bytes=4-"),
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    &b""[..],
                ),
            ] {
                let response = proxy_local_audio(&path, method, range).await;
                assert_eq!(response.status(), expected_status);
                let body = axum::body::to_bytes(response.into_body(), 1024)
                    .await
                    .unwrap();
                assert_eq!(body.as_ref(), expected_body);
            }
        });
        std::fs::remove_file(path).unwrap();
    }

    async fn test_proxy_request(
        state: super::ProxyState,
        method: Method,
        token: &str,
        headers: axum::http::HeaderMap,
    ) -> (StatusCode, reqwest::header::HeaderMap, Vec<u8>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = axum::Router::new()
            .route(
                "/audio/{token}",
                axum::routing::get(super::proxy_audio).head(super::proxy_audio),
            )
            .with_state(state);
        let server = tauri::async_runtime::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let response = reqwest::Client::new()
            .request(method, format!("http://{address}/audio/{token}"))
            .headers(headers)
            .send()
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.bytes().await.unwrap().to_vec();
        server.abort();
        (status, headers, body)
    }

    fn test_proxy_state(url: &str, expired: bool) -> super::ProxyState {
        let entry = StreamEntry {
            source: StreamLocation::Remote(reqwest::Url::parse(url).unwrap()),
            expires_at: if expired {
                Instant::now() - Duration::from_secs(1)
            } else {
                Instant::now() + Duration::from_secs(60)
            },
        };
        super::ProxyState {
            client: super::build_proxy_client().unwrap(),
            streams: std::sync::Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::from([("test-token".to_owned(), entry)]),
            )),
        }
    }

    fn test_upstream(
        response: Vec<u8>,
    ) -> (
        String,
        std::sync::mpsc::Receiver<String>,
        std::thread::JoinHandle<()>,
    ) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/audio.m4s", listener.local_addr().unwrap());
        let (sender, receiver) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            sender.send(String::from_utf8(request).unwrap()).unwrap();
            stream.write_all(&response).unwrap();
        });
        (url, receiver, thread)
    }
}
