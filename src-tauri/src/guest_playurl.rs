#![allow(dead_code)]

use bilibili_music_core::{StreamAudioInfo, BILIBILI_REFERER, DESKTOP_USER_AGENT};
use reqwest::header::{ACCEPT_ENCODING, COOKIE, RANGE, REFERER, SET_COOKIE, USER_AGENT};
use reqwest::redirect::Policy;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

const HOME_URL: &str = "https://www.bilibili.com/";
const SPI_URL: &str = "https://api.bilibili.com/x/frontend/finger/spi";
const VIEW_URL: &str = "https://api.bilibili.com/x/web-interface/view";
const PLAYURL_URL: &str = "https://api.bilibili.com/x/player/wbi/playurl";
const AUDIO_PROBE_RANGE: &str = "bytes=0-4095";
const PREFERRED_AUDIO_IDS: [i64; 2] = [30232, 30216];
const SPECIAL_AUDIO_IDS: [i64; 2] = [30250, 30251];

#[derive(Debug)]
pub struct GuestAudioProbe {
    pub bvid: String,
    pub buvid3: String,
    pub b_nut: Option<String>,
    pub cid: u64,
    pub title: String,
    pub uploader: String,
    pub thumbnail_url: String,
    pub duration_seconds: u64,
    pub playurl_code: i64,
    pub selected_audio_id: i64,
    pub selected_audio_codecs: Option<String>,
    pub probe_status: u16,
    pub probe_bytes: usize,
}

#[derive(Clone, Debug, Default)]
pub struct GuestPageHint {
    pub cid: Option<u64>,
    pub page: Option<u32>,
    pub part: Option<String>,
    pub duration_seconds: Option<u64>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPage {
    pub page: u32,
    pub cid: u64,
    pub part: String,
    pub duration_seconds: u64,
}

pub struct GuestPlayurlClient {
    client: reqwest::Client,
    guest_identity: RwLock<Option<GuestIdentity>>,
    wbi_cache: RwLock<Option<CachedWbiKey>>,
}

#[derive(Clone)]
struct CachedWbiKey {
    mixin_key: String,
    fetched_at: Instant,
}

impl GuestPlayurlClient {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            client: build_client()?,
            guest_identity: RwLock::new(None),
            wbi_cache: RwLock::new(None),
        })
    }

    pub async fn resolve(
        &self,
        bvid: &str,
        page_hint: Option<GuestPageHint>,
        cancellation: &AtomicBool,
    ) -> Result<StreamAudioInfo, String> {
        let bvid = bvid.trim();
        if !is_valid_bvid(bvid) {
            return Err(format!("invalid Bilibili BV ID: {bvid}"));
        }

        ensure_not_cancelled(cancellation)?;
        #[cfg(debug_assertions)]
        if debug_force_guest_failure() {
            return Err("debug forced guest resolve failure".to_owned());
        }

        let guest = self.guest_identity(cancellation).await?;
        let cookie_header = guest.cookie_header();
        ensure_not_cancelled(cancellation)?;

        let view = fetch_view(&self.client, bvid, &cookie_header).await?;
        ensure_not_cancelled(cancellation)?;

        let mixin_key = self.wbi_key(&cookie_header, cancellation).await?;
        ensure_not_cancelled(cancellation)?;

        let target_cid = page_hint
            .as_ref()
            .and_then(|hint| hint.cid)
            .unwrap_or(view.cid);
        let playurl =
            fetch_playurl(&self.client, bvid, target_cid, &cookie_header, &mixin_key).await?;
        ensure_not_cancelled(cancellation)?;

        let audio = select_audio(playurl.data.as_ref())?;
        let audio_url = first_working_audio_url(&self.client, audio).await?;
        ensure_not_cancelled(cancellation)?;

        let title = page_hint
            .as_ref()
            .and_then(|hint| hint.part.as_deref())
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(str::to_owned)
            .unwrap_or(view.title);
        let duration_seconds = page_hint
            .as_ref()
            .and_then(|hint| hint.duration_seconds)
            .unwrap_or(view.duration_seconds);

        Ok(StreamAudioInfo {
            audio_url: audio_url.to_owned(),
            title,
            uploader: view.uploader,
            thumbnail_url: normalize_url(&view.thumbnail_url),
            duration_seconds: duration_seconds as f64,
        })
    }

    pub async fn pages(&self, bvid: &str) -> Result<Vec<VideoPage>, String> {
        let bvid = bvid.trim();
        if !is_valid_bvid(bvid) {
            return Err(format!("invalid Bilibili BV ID: {bvid}"));
        }

        let cancellation = AtomicBool::new(false);
        let guest = self.guest_identity(&cancellation).await?;
        let cookie_header = guest.cookie_header();
        let view = fetch_view(&self.client, bvid, &cookie_header).await?;
        Ok(view.pages)
    }

    pub async fn guest_cookie_header(&self) -> Result<String, String> {
        let cancellation = AtomicBool::new(false);
        let guest = self.guest_identity(&cancellation).await?;
        Ok(guest.cookie_header())
    }

    async fn guest_identity(&self, cancellation: &AtomicBool) -> Result<GuestIdentity, String> {
        if let Some(identity) = self.guest_identity.read().await.as_ref().cloned() {
            return Ok(identity);
        }

        ensure_not_cancelled(cancellation)?;
        let identity = issue_guest_identity(&self.client).await?;
        ensure_not_cancelled(cancellation)?;
        *self.guest_identity.write().await = Some(identity.clone());
        Ok(identity)
    }

    async fn wbi_key(
        &self,
        cookie_header: &str,
        cancellation: &AtomicBool,
    ) -> Result<String, String> {
        if let Some(cached) = self.wbi_cache.read().await.as_ref() {
            if cached.fetched_at.elapsed() < crate::wbi::WBI_CACHE_TTL {
                return Ok(cached.mixin_key.clone());
            }
        }

        ensure_not_cancelled(cancellation)?;
        let mixin_key = crate::wbi::fetch_mixin_key(&self.client, Some(cookie_header)).await?;
        ensure_not_cancelled(cancellation)?;
        *self.wbi_cache.write().await = Some(CachedWbiKey {
            mixin_key: mixin_key.clone(),
            fetched_at: Instant::now(),
        });
        Ok(mixin_key)
    }
}

pub async fn verify_guest_audio_playurl(bvid: &str) -> Result<GuestAudioProbe, String> {
    let bvid = bvid.trim();
    if !is_valid_bvid(bvid) {
        return Err(format!("invalid Bilibili BV ID: {bvid}"));
    }

    let client = build_client()?;
    let guest = issue_guest_identity(&client).await?;
    let cookie_header = guest.cookie_header();
    let view = fetch_view(&client, bvid, &cookie_header).await?;
    let mixin_key = crate::wbi::fetch_mixin_key(&client, Some(&cookie_header)).await?;
    let playurl = fetch_playurl(&client, bvid, view.cid, &cookie_header, &mixin_key).await?;
    let audio = select_audio(playurl.data.as_ref())?;
    let audio_url = audio
        .base_url()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("selected audio id {} has no baseUrl/base_url", audio.id))?;
    let probe = probe_audio_url(&client, audio_url).await?;

    Ok(GuestAudioProbe {
        bvid: bvid.to_owned(),
        buvid3: guest
            .cookies
            .get("buvid3")
            .cloned()
            .ok_or_else(|| "guest identity has no buvid3 after issuing".to_owned())?,
        b_nut: guest.cookies.get("b_nut").cloned(),
        cid: view.cid,
        title: view.title,
        uploader: view.uploader,
        thumbnail_url: normalize_url(&view.thumbnail_url),
        duration_seconds: view.duration_seconds,
        playurl_code: playurl.code,
        selected_audio_id: audio.id,
        selected_audio_codecs: audio.codecs.clone(),
        probe_status: probe.status,
        probe_bytes: probe.bytes,
    })
}

async fn first_working_audio_url<'a>(
    client: &reqwest::Client,
    audio: &'a AudioStream,
) -> Result<&'a str, String> {
    let candidates = audio.url_candidates();
    if candidates.is_empty() {
        return Err(format!(
            "selected audio id {} has no baseUrl/base_url or backup URLs",
            audio.id
        ));
    }

    let mut last_error = None;
    for candidate in candidates {
        match probe_audio_url(client, candidate).await {
            Ok(_) => return Ok(candidate),
            Err(error) => last_error = Some(error),
        }
    }
    Err(format!(
        "all audio URLs for id {} failed probe: {}",
        audio.id,
        last_error.unwrap_or_else(|| "unknown probe failure".to_owned())
    ))
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("failed to create guest playurl client: {error}"))
}

#[derive(Clone, Debug)]
struct GuestIdentity {
    cookies: BTreeMap<String, String>,
}

fn ensure_not_cancelled(cancellation: &AtomicBool) -> Result<(), String> {
    if cancellation.load(Ordering::Acquire) {
        Err("audio resolution was cancelled".to_owned())
    } else {
        Ok(())
    }
}

#[cfg(debug_assertions)]
fn debug_force_guest_failure() -> bool {
    matches!(
        std::env::var("BILIBILI_MUSIC_FORCE_GUEST_FAILURE")
            .ok()
            .as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

impl GuestIdentity {
    fn cookie_header(&self) -> String {
        self.cookies
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; ")
    }
}

async fn issue_guest_identity(client: &reqwest::Client) -> Result<GuestIdentity, String> {
    let mut cookies = BTreeMap::new();
    let response = client
        .get(HOME_URL)
        .header(ACCEPT_ENCODING, "identity")
        .header(USER_AGENT, DESKTOP_USER_AGENT)
        .header(REFERER, BILIBILI_REFERER)
        .send()
        .await
        .map_err(|error| format!("failed to request Bilibili homepage for buvid: {error}"))?;
    if response.status().as_u16() == 412 {
        return Err("Bilibili homepage returned HTTP 412 while issuing guest buvid".to_owned());
    }

    for value in response.headers().get_all(SET_COOKIE) {
        if let Ok(value) = value.to_str() {
            if let Some((name, value)) = parse_set_cookie(value) {
                if matches!(name.as_str(), "buvid3" | "buvid4" | "b_nut") {
                    cookies.insert(name, value);
                }
            }
        }
    }

    if !cookies.contains_key("buvid3") || !cookies.contains_key("buvid4") {
        for (name, value) in issue_spi_buvid(client, &cookies).await? {
            cookies.entry(name).or_insert(value);
        }
    }

    if !cookies.contains_key("buvid3") {
        return Err("Bilibili did not issue buvid3 from homepage or SPI".to_owned());
    }
    Ok(GuestIdentity { cookies })
}

async fn issue_spi_buvid(
    client: &reqwest::Client,
    existing: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    let mut request = client
        .get(SPI_URL)
        .header(ACCEPT_ENCODING, "identity")
        .header(USER_AGENT, DESKTOP_USER_AGENT)
        .header(REFERER, BILIBILI_REFERER);
    if !existing.is_empty() {
        request = request.header(
            COOKIE,
            existing
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; "),
        );
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("failed to request SPI buvid: {error}"))?;
    if response.status().as_u16() == 412 {
        return Err("Bilibili SPI returned HTTP 412 while issuing buvid".to_owned());
    }
    let envelope: SpiEnvelope = response
        .json()
        .await
        .map_err(|error| format!("invalid SPI buvid response: {error}"))?;
    if envelope.code != 0 {
        return Err(format!(
            "SPI buvid failed with code {}: {}",
            envelope.code, envelope.message
        ));
    }

    let mut issued = BTreeMap::new();
    if !envelope.data.b_3.is_empty() {
        issued.insert("buvid3".to_owned(), envelope.data.b_3);
    }
    if !envelope.data.b_4.is_empty() {
        issued.insert("buvid4".to_owned(), envelope.data.b_4);
    }
    Ok(issued)
}

async fn fetch_view(
    client: &reqwest::Client,
    bvid: &str,
    cookie_header: &str,
) -> Result<ViewData, String> {
    let response = client
        .get(format!("{VIEW_URL}?bvid={bvid}"))
        .header(ACCEPT_ENCODING, "identity")
        .header(USER_AGENT, DESKTOP_USER_AGENT)
        .header(REFERER, BILIBILI_REFERER)
        .header(COOKIE, cookie_header)
        .send()
        .await
        .map_err(|error| format!("Bilibili view request failed: {error}"))?;
    if response.status().as_u16() == 412 {
        return Err("Bilibili view returned HTTP 412".to_owned());
    }
    if !response.status().is_success() {
        return Err(format!("Bilibili view returned HTTP {}", response.status()));
    }

    let envelope: ViewEnvelope = response
        .json()
        .await
        .map_err(|error| format!("invalid Bilibili view response: {error}"))?;
    if envelope.code != 0 {
        return Err(format!(
            "Bilibili view failed with code {}: {}",
            envelope.code, envelope.message
        ));
    }
    let data = envelope
        .data
        .ok_or_else(|| "Bilibili view response has no data".to_owned())?;
    let cid = data
        .cid
        .or_else(|| data.pages.first().map(|page| page.cid))
        .ok_or_else(|| "Bilibili view response has no cid".to_owned())?;
    let pages = normalize_view_pages(&data.pages, cid, &data.title, data.duration);
    Ok(ViewData {
        cid,
        title: data.title,
        uploader: data.owner.name,
        thumbnail_url: data.pic,
        duration_seconds: data.duration,
        pages,
    })
}

fn normalize_view_pages(
    pages: &[ViewPage],
    fallback_cid: u64,
    fallback_title: &str,
    fallback_duration: u64,
) -> Vec<VideoPage> {
    if pages.is_empty() {
        return vec![VideoPage {
            page: 1,
            cid: fallback_cid,
            part: fallback_title.to_owned(),
            duration_seconds: fallback_duration,
        }];
    }

    pages
        .iter()
        .enumerate()
        .map(|(index, page)| VideoPage {
            page: if page.page == 0 {
                (index + 1) as u32
            } else {
                page.page
            },
            cid: page.cid,
            part: if page.part.trim().is_empty() {
                fallback_title.to_owned()
            } else {
                page.part.clone()
            },
            duration_seconds: page.duration.unwrap_or(fallback_duration),
        })
        .collect()
}

async fn fetch_playurl(
    client: &reqwest::Client,
    bvid: &str,
    cid: u64,
    cookie_header: &str,
    mixin_key: &str,
) -> Result<PlayurlEnvelope, String> {
    let mut params = BTreeMap::new();
    params.insert("bvid".to_owned(), bvid.to_owned());
    params.insert("cid".to_owned(), cid.to_string());
    params.insert("fnval".to_owned(), "4048".to_owned());
    params.insert("fnver".to_owned(), "0".to_owned());
    params.insert("qn".to_owned(), "0".to_owned());
    let signed_query = crate::wbi::sign_parameters(params, mixin_key, unix_timestamp());

    let response = client
        .get(format!("{PLAYURL_URL}?{signed_query}"))
        .header(ACCEPT_ENCODING, "identity")
        .header(USER_AGENT, DESKTOP_USER_AGENT)
        .header(REFERER, BILIBILI_REFERER)
        .header(COOKIE, cookie_header)
        .send()
        .await
        .map_err(|error| format!("Bilibili playurl request failed: {error}"))?;
    if response.status().as_u16() == 412 {
        return Err("Bilibili playurl returned HTTP 412".to_owned());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Bilibili playurl returned HTTP {}",
            response.status()
        ));
    }

    let content_encoding = response
        .headers()
        .get(reqwest::header::CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read Bilibili playurl response body: {error}"))?;
    let envelope: PlayurlEnvelope = serde_json::from_slice(&body).map_err(|error| {
        format!(
            "invalid Bilibili playurl response: {error}; content-encoding={}; first-bytes-hex={}; first-text={}",
            content_encoding.as_deref().unwrap_or("<none>"),
            first_bytes_hex(&body),
            first_text_lossy(&body)
        )
    })?;
    if envelope.code != 0 {
        return Err(format!(
            "Bilibili playurl failed with code {}: {}",
            envelope.code, envelope.message
        ));
    }
    Ok(envelope)
}

fn select_audio(data: Option<&PlayurlData>) -> Result<&AudioStream, String> {
    let audio = data
        .and_then(|data| data.dash.as_ref())
        .map(|dash| dash.audio.as_slice())
        .ok_or_else(|| "Bilibili playurl response has no data.dash.audio".to_owned())?;
    if audio.is_empty() {
        return Err("Bilibili playurl response data.dash.audio is empty".to_owned());
    }

    for preferred_id in PREFERRED_AUDIO_IDS {
        if let Some(stream) = audio.iter().find(|stream| stream.id == preferred_id) {
            return Ok(stream);
        }
    }

    audio
        .iter()
        .filter(|stream| !SPECIAL_AUDIO_IDS.contains(&stream.id))
        .find(|stream| stream.looks_browser_playable())
        .ok_or_else(|| {
            let ids = audio
                .iter()
                .map(|stream| stream.id.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            format!("no browser-playable AAC audio stream found in data.dash.audio; ids: {ids}")
        })
}

async fn probe_audio_url(client: &reqwest::Client, audio_url: &str) -> Result<ProbeResult, String> {
    let response = client
        .get(audio_url)
        .header(ACCEPT_ENCODING, "identity")
        .header(USER_AGENT, DESKTOP_USER_AGENT)
        .header(REFERER, BILIBILI_REFERER)
        .header(RANGE, AUDIO_PROBE_RANGE)
        .send()
        .await
        .map_err(|error| format!("audio URL probe request failed: {error}"))?;
    let status = response.status();
    if status.as_u16() != 200 && status.as_u16() != 206 {
        return Err(format!("audio URL probe returned HTTP {status}"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read audio probe bytes: {error}"))?
        .len();
    if bytes == 0 {
        return Err("audio URL probe returned zero bytes".to_owned());
    }
    Ok(ProbeResult {
        status: status.as_u16(),
        bytes,
    })
}

fn parse_set_cookie(value: &str) -> Option<(String, String)> {
    let first = value.split(';').next()?;
    let (name, value) = first.split_once('=')?;
    if name.is_empty() || value.is_empty() {
        return None;
    }
    Some((name.to_owned(), value.to_owned()))
}

fn first_bytes_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take(32)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn first_text_lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[..bytes.len().min(120)])
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn normalize_url(value: &str) -> String {
    if value.starts_with("//") {
        format!("https:{value}")
    } else if let Some(value) = value.strip_prefix("http://") {
        format!("https://{value}")
    } else {
        value.to_owned()
    }
}

fn is_valid_bvid(value: &str) -> bool {
    value.len() == 12
        && value.starts_with("BV")
        && value[2..].bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

struct ProbeResult {
    status: u16,
    bytes: usize,
}

#[derive(Deserialize)]
struct SpiEnvelope {
    code: i64,
    message: String,
    data: SpiData,
}

#[derive(Deserialize)]
struct SpiData {
    b_3: String,
    b_4: String,
}

struct ViewData {
    cid: u64,
    title: String,
    uploader: String,
    thumbnail_url: String,
    duration_seconds: u64,
    pages: Vec<VideoPage>,
}

#[derive(Deserialize)]
struct ViewEnvelope {
    code: i64,
    message: String,
    data: Option<RawViewData>,
}

#[derive(Deserialize)]
struct RawViewData {
    cid: Option<u64>,
    title: String,
    owner: ViewOwner,
    pic: String,
    duration: u64,
    #[serde(default)]
    pages: Vec<ViewPage>,
}

#[derive(Deserialize)]
struct ViewOwner {
    name: String,
}

#[derive(Deserialize)]
struct ViewPage {
    #[serde(default)]
    page: u32,
    cid: u64,
    #[serde(default)]
    part: String,
    #[serde(default)]
    duration: Option<u64>,
}

#[derive(Deserialize)]
struct PlayurlEnvelope {
    code: i64,
    message: String,
    data: Option<PlayurlData>,
}

#[derive(Deserialize)]
struct PlayurlData {
    dash: Option<DashData>,
}

#[derive(Deserialize)]
struct DashData {
    #[serde(default)]
    audio: Vec<AudioStream>,
}

#[derive(Debug, Deserialize)]
struct AudioStream {
    id: i64,
    #[serde(default, rename = "baseUrl")]
    base_url_camel: Option<String>,
    #[serde(default, rename = "base_url")]
    base_url_snake: Option<String>,
    #[serde(default, rename = "backupUrl")]
    backup_url_camel: Vec<String>,
    #[serde(default, rename = "backup_url")]
    backup_url_snake: Vec<String>,
    #[serde(default)]
    codecs: Option<String>,
    #[serde(default, rename = "mimeType")]
    mime_type_camel: Option<String>,
    #[serde(default, rename = "mime_type")]
    mime_type_snake: Option<String>,
}

impl AudioStream {
    fn base_url(&self) -> Option<&str> {
        self.base_url_camel
            .as_deref()
            .or(self.base_url_snake.as_deref())
    }

    fn mime_type(&self) -> Option<&str> {
        self.mime_type_camel
            .as_deref()
            .or(self.mime_type_snake.as_deref())
    }

    fn url_candidates(&self) -> Vec<&str> {
        let mut candidates = Vec::new();
        if let Some(url) = self.base_url() {
            candidates.push(url);
        }
        candidates.extend(
            self.backup_url_camel
                .iter()
                .chain(self.backup_url_snake.iter())
                .map(String::as_str)
                .filter(|url| !url.trim().is_empty()),
        );
        candidates
    }

    fn looks_browser_playable(&self) -> bool {
        let codecs = self
            .codecs
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let mime_type = self.mime_type().unwrap_or_default().to_ascii_lowercase();
        codecs.contains("mp4a") || mime_type.contains("audio/mp4")
    }
}

#[cfg(test)]
mod tests {
    use super::{select_audio, AudioStream, DashData, PlayurlData};

    #[test]
    fn prefers_medium_aac_then_low_aac() {
        let low = AudioStream {
            id: 30216,
            base_url_camel: Some("low".to_owned()),
            base_url_snake: None,
            backup_url_camel: vec![],
            backup_url_snake: vec![],
            codecs: Some("mp4a.40.2".to_owned()),
            mime_type_camel: Some("audio/mp4".to_owned()),
            mime_type_snake: None,
        };
        let medium = AudioStream {
            id: 30232,
            base_url_camel: Some("medium".to_owned()),
            base_url_snake: None,
            backup_url_camel: vec![],
            backup_url_snake: vec![],
            codecs: Some("mp4a.40.2".to_owned()),
            mime_type_camel: Some("audio/mp4".to_owned()),
            mime_type_snake: None,
        };
        let data = PlayurlData {
            dash: Some(DashData {
                audio: vec![low, medium],
            }),
        };

        assert_eq!(select_audio(Some(&data)).unwrap().id, 30232);
    }

    #[test]
    fn rejects_missing_audio_streams_clearly() {
        let data = PlayurlData {
            dash: Some(DashData { audio: vec![] }),
        };

        assert!(select_audio(Some(&data))
            .unwrap_err()
            .contains("data.dash.audio is empty"));
        assert!(select_audio(None)
            .unwrap_err()
            .contains("no data.dash.audio"));
    }
}
