use crate::guest_playurl::GuestPlayurlClient;
use bilibili_music_core::{BILIBILI_REFERER, DESKTOP_USER_AGENT};
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use reqwest::redirect::Policy;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

const SPI_URL: &str = "https://api.bilibili.com/x/frontend/finger/spi";
const SEARCH_URL: &str = "https://api.bilibili.com/x/web-interface/wbi/search/type";

#[derive(Clone)]
pub struct SearchClient {
    client: reqwest::Client,
    cookie_path: PathBuf,
    guest: Arc<GuestPlayurlClient>,
    wbi_cache: Arc<RwLock<Option<CachedWbiKey>>>,
}

#[derive(Clone)]
struct CachedWbiKey {
    mixin_key: String,
    fetched_at: Instant,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchVideo {
    pub bvid: String,
    pub title: String,
    pub uploader: String,
    pub thumbnail_url: String,
    pub duration_seconds: u64,
    pub play_count: Option<u64>,
    pub pubdate: Option<u64>,
}

enum SearchAttemptError {
    RefreshWbi(String),
    Fatal(String),
}

impl SearchClient {
    pub fn new(cookie_path: PathBuf, guest: Arc<GuestPlayurlClient>) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .redirect(Policy::none())
            .build()
            .map_err(|error| format!("failed to create Bilibili search client: {error}"))?;

        Ok(Self {
            client,
            cookie_path,
            guest,
            wbi_cache: Arc::new(RwLock::new(None)),
        })
    }

    #[allow(dead_code)]
    pub async fn search_videos(&self, keyword: &str) -> Result<Vec<SearchVideo>, String> {
        self.search_videos_page(keyword, 1, None, None).await
    }

    pub async fn search_videos_page(
        &self,
        keyword: &str,
        page: u32,
        tids: Option<u32>,
        order: Option<&str>,
    ) -> Result<Vec<SearchVideo>, String> {
        let keyword = keyword.trim();
        if keyword.is_empty() {
            return Err("search keyword cannot be empty".to_owned());
        }
        if keyword.chars().count() > 100 {
            return Err("search keyword is too long (maximum 100 characters)".to_owned());
        }
        if page == 0 {
            return Err("search page must be greater than 0".to_owned());
        }
        let order = normalize_search_order(order)?;
        let rerank_enabled = order != "click";

        let first_keys = self.wbi_key(false).await?;
        match self
            .search_once(keyword, page, tids, order, &first_keys)
            .await
        {
            Ok(results) => Ok(rerank_search_results(keyword, results, rerank_enabled)),
            Err(SearchAttemptError::Fatal(error)) => Err(error),
            Err(SearchAttemptError::RefreshWbi(first_error)) => {
                let refreshed_keys = self.wbi_key(true).await?;
                self.search_once(keyword, page, tids, order, &refreshed_keys)
                    .await
                    .map(|results| rerank_search_results(keyword, results, rerank_enabled))
                    .map_err(|error| match error {
                        SearchAttemptError::RefreshWbi(second_error) => format!(
                            "Bilibili rejected the refreshed WBI signature: {second_error}; first error: {first_error}"
                        ),
                        SearchAttemptError::Fatal(error) => error,
                    })
            }
        }
    }

    async fn search_once(
        &self,
        keyword: &str,
        page: u32,
        tids: Option<u32>,
        order: &str,
        mixin_key: &str,
    ) -> Result<Vec<SearchVideo>, SearchAttemptError> {
        let mut params = BTreeMap::new();
        params.insert("duration".to_owned(), "0".to_owned());
        params.insert("keyword".to_owned(), keyword.to_owned());
        params.insert("order".to_owned(), order.to_owned());
        params.insert("page".to_owned(), page.to_string());
        params.insert("search_type".to_owned(), "video".to_owned());
        params.insert("tids".to_owned(), tids.unwrap_or(0).to_string());
        let wts = unix_timestamp();
        let signed_query = crate::wbi::sign_parameters(params, mixin_key, wts);
        eprintln!(
            "[search-diag] request keyword={keyword} page={page} order={order} tids={}",
            tids.unwrap_or(0)
        );
        let cookie_header = self
            .cookie_header()
            .await
            .map_err(SearchAttemptError::Fatal)?;

        let response = self
            .client
            .get(format!("{SEARCH_URL}?{signed_query}"))
            .header(USER_AGENT, DESKTOP_USER_AGENT)
            .header(REFERER, BILIBILI_REFERER)
            .header(COOKIE, cookie_header)
            .send()
            .await
            .map_err(|error| {
                SearchAttemptError::Fatal(format!("Bilibili search request failed: {error}"))
            })?;

        if response.status().as_u16() == 412 {
            return Err(SearchAttemptError::Fatal(
                "Bilibili search was rejected with HTTP 412. The guest buvid may be stale; retry later or check buvid issuance."
                    .to_owned(),
            ));
        }
        if !response.status().is_success() {
            return Err(SearchAttemptError::Fatal(format!(
                "Bilibili search returned HTTP {}",
                response.status()
            )));
        }

        let envelope: SearchEnvelope = response.json().await.map_err(|error| {
            SearchAttemptError::Fatal(format!("invalid Bilibili search response: {error}"))
        })?;
        eprintln!(
            "[search-diag] response code={} message={}",
            envelope.code, envelope.message
        );
        if envelope.code == -412 {
            return Err(SearchAttemptError::Fatal(
                "Bilibili search returned code -412. The guest buvid may be stale; retry later or check buvid issuance."
                    .to_owned(),
            ));
        }
        if envelope.code != 0 {
            let details = format!("code {}: {}", envelope.code, envelope.message);
            if envelope.message.to_ascii_lowercase().contains("wbi")
                || envelope.message.contains("签名")
            {
                return Err(SearchAttemptError::RefreshWbi(details));
            }
            return Err(SearchAttemptError::Fatal(format!(
                "Bilibili search failed with {details}"
            )));
        }

        let data = envelope.data.ok_or_else(|| {
            SearchAttemptError::Fatal("Bilibili search response has no data".to_owned())
        })?;
        if data.v_voucher.is_some() {
            return Err(SearchAttemptError::RefreshWbi(
                "the response contained v_voucher".to_owned(),
            ));
        }

        let raw_count = data.result.len();
        eprintln!("[search-diag] raw result count={raw_count}");
        for raw in &data.result {
            let drop_reason = if raw.kind.as_deref().is_some_and(|kind| kind != "video") {
                Some("kind不符")
            } else if raw.bvid.is_none() {
                Some("缺bvid")
            } else if !raw.bvid.as_deref().is_some_and(is_valid_bvid) {
                Some("bvid非法")
            } else if raw.title.is_none() {
                Some("缺title")
            } else if raw.author.is_none() {
                Some("缺author")
            } else if raw.pic.is_none() {
                Some("缺pic")
            } else if raw.duration.is_none() {
                Some("缺duration")
            } else if !raw
                .duration
                .as_deref()
                .is_some_and(|value| parse_duration(value).is_some())
            {
                Some("时长解析失败")
            } else {
                None
            };
            if let Some(reason) = drop_reason {
                eprintln!(
                    "[search-diag] dropped bvid={:?} title={:?} reason={reason}",
                    raw.bvid, raw.title
                );
            }
        }

        let results: Vec<_> = data
            .result
            .into_iter()
            .filter_map(SearchVideo::from_raw)
            .collect();
        eprintln!("[search-diag] filtered result count={}", results.len());
        Ok(results)
    }

    async fn wbi_key(&self, force_refresh: bool) -> Result<String, String> {
        if !force_refresh {
            let cache = self.wbi_cache.read().await;
            if let Some(cached) = cache.as_ref() {
                if cached.fetched_at.elapsed() < crate::wbi::WBI_CACHE_TTL {
                    return Ok(cached.mixin_key.clone());
                }
            }
        }

        let cookie_header = self.cookie_header().await?;
        let mixin_key = crate::wbi::fetch_mixin_key(&self.client, Some(&cookie_header)).await?;

        *self.wbi_cache.write().await = Some(CachedWbiKey {
            mixin_key: mixin_key.clone(),
            fetched_at: Instant::now(),
        });
        Ok(mixin_key)
    }

    async fn cookie_header(&self) -> Result<String, String> {
        match self.guest.guest_cookie_header().await {
            Ok(header) if header.contains("buvid3=") => return Ok(header),
            Ok(header) => {
                eprintln!(
                    "[search] guest identity did not include buvid3; falling back to buvid-only cookies.txt/SPI"
                );
                if !header.trim().is_empty() {
                    eprintln!("[search] ignored guest cookie header without buvid3");
                }
            }
            Err(error) => {
                eprintln!(
                    "[search] failed to obtain guest identity for search; falling back to buvid-only cookies.txt/SPI: {error}"
                );
            }
        }

        let mut cookies = read_optional_buvid_cookies(&self.cookie_path, "api.bilibili.com");
        if !cookies.contains_key("buvid3") {
            let issued = self.issue_buvid(&cookies).await?;
            cookies.extend(issued);
        }
        if !cookies.contains_key("buvid3") {
            return Err(
                "Bilibili did not issue a guest buvid3 for search, and the buvid-only fallback also failed"
                    .to_owned(),
            );
        }

        Ok(cookies
            .into_iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; "))
    }

    async fn issue_buvid(
        &self,
        existing: &BTreeMap<String, String>,
    ) -> Result<BTreeMap<String, String>, String> {
        let mut request = self
            .client
            .get(SPI_URL)
            .header(USER_AGENT, DESKTOP_USER_AGENT)
            .header(REFERER, BILIBILI_REFERER);
        if !existing.is_empty() {
            let header = existing
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; ");
            request = request.header(COOKIE, header);
        }

        let response = request
            .send()
            .await
            .map_err(|error| format!("failed to request buvid3: {error}"))?;
        if response.status().as_u16() == 412 {
            return Err("Bilibili rejected the buvid3 request with HTTP 412".to_owned());
        }
        let envelope: SpiEnvelope = response
            .json()
            .await
            .map_err(|error| format!("invalid buvid3 response: {error}"))?;
        if envelope.code != 0 {
            return Err(format!(
                "failed to request buvid3 (code {}): {}",
                envelope.code, envelope.message
            ));
        }

        let mut issued = BTreeMap::new();
        issued.insert("buvid3".to_owned(), envelope.data.b_3);
        if !envelope.data.b_4.is_empty() {
            issued.insert("buvid4".to_owned(), envelope.data.b_4);
        }
        Ok(issued)
    }
}

impl SearchVideo {
    fn from_raw(raw: RawSearchVideo) -> Option<Self> {
        if raw.kind.as_deref().is_some_and(|kind| kind != "video") {
            return None;
        }
        let bvid = raw.bvid?;
        if !is_valid_bvid(&bvid) {
            return None;
        }

        Some(Self {
            bvid,
            title: clean_title(&raw.title?),
            uploader: raw.author?,
            thumbnail_url: normalize_thumbnail_url(&raw.pic?),
            duration_seconds: parse_duration(&raw.duration?)?,
            play_count: raw.play,
            pubdate: raw.pubdate,
        })
    }
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

#[derive(Deserialize)]
struct SearchEnvelope {
    code: i64,
    message: String,
    data: Option<SearchData>,
}

#[derive(Deserialize)]
struct SearchData {
    #[serde(default)]
    result: Vec<RawSearchVideo>,
    #[serde(default)]
    v_voucher: Option<String>,
}

#[derive(Deserialize)]
struct RawSearchVideo {
    #[serde(rename = "type")]
    kind: Option<String>,
    bvid: Option<String>,
    title: Option<String>,
    author: Option<String>,
    pic: Option<String>,
    duration: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_u64_lossy")]
    play: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u64_lossy")]
    pubdate: Option<u64>,
}

fn deserialize_optional_u64_lossy<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    let Some(value) = value else {
        return Ok(None);
    };
    let parsed = match value {
        serde_json::Value::Number(number) => number
            .as_u64()
            .or_else(|| number.as_i64().and_then(|value| u64::try_from(value).ok())),
        serde_json::Value::String(value) => value
            .trim()
            .parse::<i64>()
            .ok()
            .and_then(|value| u64::try_from(value).ok()),
        _ => None,
    };
    Ok(parsed)
}

fn read_netscape_cookies(path: &Path, host: &str) -> Result<BTreeMap<String, String>, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let now = unix_timestamp();
    let mut cookies = BTreeMap::new();

    for original_line in contents.lines() {
        let line = if let Some(line) = original_line.strip_prefix("#HttpOnly_") {
            line
        } else if original_line.starts_with('#') || original_line.trim().is_empty() {
            continue;
        } else {
            original_line
        };
        let fields: Vec<&str> = line.splitn(7, '\t').collect();
        if fields.len() != 7 {
            continue;
        }

        let domain = fields[0].trim_start_matches('.').to_ascii_lowercase();
        let domain_matches = host == domain || host.ends_with(&format!(".{domain}"));
        let expires_at = fields[4].parse::<u64>().unwrap_or(0);
        if !domain_matches || (expires_at != 0 && expires_at <= now) || fields[5].is_empty() {
            continue;
        }
        cookies.insert(fields[5].to_owned(), fields[6].to_owned());
    }

    Ok(cookies)
}

fn read_optional_buvid_cookies(path: &Path, host: &str) -> BTreeMap<String, String> {
    match read_netscape_cookies(path, host) {
        Ok(cookies) => cookies
            .into_iter()
            .filter(|(name, _)| is_buvid_cookie(name))
            .collect(),
        Err(error) => {
            eprintln!(
                "[search] ignoring optional buvid-only cookies fallback at {}: {error}",
                path.display()
            );
            BTreeMap::new()
        }
    }
}

fn is_buvid_cookie(name: &str) -> bool {
    matches!(name, "buvid3" | "buvid4" | "b_nut")
}

fn clean_title(value: &str) -> String {
    let without_highlights = value
        .replace("<em class=\"keyword\">", "")
        .replace("<em class='keyword'>", "")
        .replace("</em>", "");
    html_escape::decode_html_entities(&without_highlights).into_owned()
}

fn normalize_thumbnail_url(value: &str) -> String {
    if value.starts_with("//") {
        format!("https:{value}")
    } else if let Some(value) = value.strip_prefix("http://") {
        format!("https://{value}")
    } else {
        value.to_owned()
    }
}

fn parse_duration(value: &str) -> Option<u64> {
    let parts: Vec<u64> = value
        .split(':')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    if parts.is_empty() || parts.len() > 3 || parts.iter().skip(1).any(|part| *part >= 60) {
        return None;
    }
    Some(parts.into_iter().fold(0, |total, part| total * 60 + part))
}

fn is_valid_bvid(value: &str) -> bool {
    value.len() == 12
        && value.starts_with("BV")
        && value[2..].bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn normalize_search_order(order: Option<&str>) -> Result<&'static str, String> {
    match order.unwrap_or("totalrank") {
        "totalrank" => Ok("totalrank"),
        "click" => Ok("click"),
        other => Err(format!("unsupported Bilibili search order: {other}")),
    }
}

#[derive(Clone, Copy)]
struct SearchScore {
    total: f64,
    containment: f64,
    duration: f64,
    phrase_match: f64,
    original_position: f64,
}

struct ScoredSearchVideo {
    original_index: usize,
    score: SearchScore,
    item: SearchVideo,
}

fn rerank_search_results(
    keyword: &str,
    items: Vec<SearchVideo>,
    enabled: bool,
) -> Vec<SearchVideo> {
    if !enabled {
        return items;
    }

    let normalized_keyword = normalize_search_text(keyword);
    let long_audio_intent = ["合集", "歌单", "playlist", "纯音乐", "小时", "循环"]
        .iter()
        .any(|marker| normalized_keyword.contains(marker));
    let total_items = items.len();
    let mut scored: Vec<_> = items
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            let normalized_title = normalize_search_text(&item.title);
            let containment = keyword_containment(&normalized_keyword, &normalized_title);
            let duration = duration_score(item.duration_seconds, long_audio_intent);
            let phrase_match = exact_phrase_match_score(keyword, &normalized_title);
            let original_position = 1.0 - index as f64 / total_items as f64;
            ScoredSearchVideo {
                original_index: index,
                score: SearchScore {
                    total: containment * 0.60
                        + duration * 0.20
                        + phrase_match * 0.10
                        + original_position * 0.10,
                    containment,
                    duration,
                    phrase_match,
                    original_position,
                },
                item,
            }
        })
        .collect();

    stable_sort_scored_results(&mut scored);
    for (final_index, entry) in scored.iter().enumerate() {
        let title_preview: String = entry.item.title.chars().take(20).collect();
        eprintln!(
            "[search-diag] rerank final={} original={} score={:.6} containment={:.6} duration={:.6} phrase_match={:.6} position={:.6} title={:?}",
            final_index + 1,
            entry.original_index + 1,
            entry.score.total,
            entry.score.containment,
            entry.score.duration,
            entry.score.phrase_match,
            entry.score.original_position,
            title_preview
        );
    }

    scored.into_iter().map(|entry| entry.item).collect()
}

fn stable_sort_scored_results(items: &mut [ScoredSearchVideo]) {
    items.sort_by(|left, right| right.score.total.total_cmp(&left.score.total));
}

fn normalize_search_text(value: &str) -> String {
    value
        .chars()
        .map(search_to_halfwidth)
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn search_to_halfwidth(character: char) -> char {
    match character {
        '\u{3000}' => ' ',
        '\u{FF01}'..='\u{FF5E}' => char::from_u32(character as u32 - 0xFEE0).unwrap_or(character),
        _ => character,
    }
}

fn keyword_containment(keyword: &str, title: &str) -> f64 {
    let keyword: Vec<_> = keyword.chars().collect();
    if keyword.len() < 2 {
        return if keyword
            .first()
            .is_some_and(|character| title.contains(*character))
        {
            1.0
        } else {
            0.0
        };
    }

    let title: Vec<_> = title.chars().collect();
    let keyword_bigrams: HashSet<_> = keyword.windows(2).map(|pair| (pair[0], pair[1])).collect();
    let title_bigrams: HashSet<_> = title.windows(2).map(|pair| (pair[0], pair[1])).collect();
    keyword_bigrams.intersection(&title_bigrams).count() as f64 / keyword_bigrams.len() as f64
}

fn duration_score(duration_seconds: u64, long_audio_intent: bool) -> f64 {
    if long_audio_intent {
        return 1.0;
    }
    match duration_seconds {
        0..60 => 0.2,
        60..150 => 0.7,
        150..=420 => 1.0,
        421..=900 => 0.5,
        _ => 0.15,
    }
}

fn exact_phrase_match_score(keyword: &str, normalized_title: &str) -> f64 {
    let terms: Vec<_> = keyword
        .split_whitespace()
        .map(normalize_search_text)
        .filter(|term| !term.is_empty())
        .collect();
    if terms.is_empty() {
        return 0.0;
    }
    terms
        .iter()
        .filter(|term| normalized_title.contains(term.as_str()))
        .count() as f64
        / terms.len() as f64
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::{
        clean_title, duration_score, exact_phrase_match_score, normalize_search_text,
        parse_duration, read_optional_buvid_cookies, rerank_search_results,
        stable_sort_scored_results, RawSearchVideo, ScoredSearchVideo, SearchScore, SearchVideo,
    };
    use crate::wbi::{gen_mixin_key, sign_parameters};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn generates_documented_mixin_key() {
        let raw = "7cd084941338484aae1ad9425b84077c4932caff0ff746eab6f01bf08b70ac45";
        assert_eq!(
            gen_mixin_key(raw).unwrap(),
            "ea1db124af3c7062474693fa704f4ff8"
        );
    }

    #[test]
    fn generates_documented_wbi_signature() {
        let mut params = BTreeMap::new();
        params.insert("foo".to_owned(), "114".to_owned());
        params.insert("bar".to_owned(), "514".to_owned());
        params.insert("zab".to_owned(), "1919810".to_owned());
        let signed = sign_parameters(params, "ea1db124af3c7062474693fa704f4ff8", 1_702_204_169);
        assert_eq!(
            signed,
            "bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4"
        );
    }

    #[test]
    fn encodes_spaces_and_unicode_like_encode_uri_component() {
        let mut params = BTreeMap::new();
        params.insert("bar".to_owned(), "五一四".to_owned());
        params.insert("foo".to_owned(), "one one four".to_owned());
        let signed = sign_parameters(params, "mixin", 1);
        assert!(signed.starts_with("bar=%E4%BA%94%E4%B8%80%E5%9B%9B&foo=one%20one%20four&wts=1&"));
    }

    #[test]
    fn cleans_search_titles_and_parses_durations() {
        assert_eq!(clean_title("A <em class=\"keyword\">B&amp;C</em>"), "A B&C");
        assert_eq!(parse_duration("03:07"), Some(187));
        assert_eq!(parse_duration("1:02:03"), Some(3723));
        assert_eq!(parse_duration("1:99"), None);
    }

    #[test]
    fn parses_search_video_play_count_and_pubdate() {
        let raw: RawSearchVideo = serde_json::from_str(
            r#"{
                "type": "video",
                "bvid": "BV1xx411c7mD",
                "title": "Song",
                "author": "UP",
                "pic": "//i0.hdslb.com/bfs/archive/cover.jpg",
                "duration": "03:07",
                "play": 12345,
                "pubdate": "1712345678"
            }"#,
        )
        .unwrap();
        let video = SearchVideo::from_raw(raw).unwrap();

        assert_eq!(video.play_count, Some(12_345));
        assert_eq!(video.pubdate, Some(1_712_345_678));
    }

    #[test]
    fn parses_search_video_without_play_count_and_pubdate() {
        let raw: RawSearchVideo = serde_json::from_str(
            r#"{
                "type": "video",
                "bvid": "BV1xx411c7mD",
                "title": "Song",
                "author": "UP",
                "pic": "//i0.hdslb.com/bfs/archive/cover.jpg",
                "duration": "03:07"
            }"#,
        )
        .unwrap();
        let video = SearchVideo::from_raw(raw).unwrap();

        assert_eq!(video.play_count, None);
        assert_eq!(video.pubdate, None);
    }

    #[test]
    fn rerank_places_exact_match_before_generic_match() {
        let items = vec![
            test_video("BV1aa411c7mD", "热门日语歌曲推荐", 180),
            test_video("BV1bb411c7mD", "night【音乐】完整版", 180),
        ];

        let reranked = rerank_search_results("ＮＩＧＨＴ 音乐", items, true);

        assert_eq!(reranked[0].bvid, "BV1bb411c7mD");
        assert_eq!(reranked[1].bvid, "BV1aa411c7mD");
    }

    #[test]
    fn rerank_places_three_minute_track_before_long_compilation() {
        let items = vec![
            test_video("BV1aa411c7mD", "夜曲", 901),
            test_video("BV1bb411c7mD", "夜曲", 180),
        ];

        let reranked = rerank_search_results("夜曲", items, true);

        assert_eq!(reranked[0].bvid, "BV1bb411c7mD");
        assert_eq!(reranked[1].bvid, "BV1aa411c7mD");
    }

    #[test]
    fn rerank_does_not_penalize_long_audio_for_compilation_keyword() {
        let items = vec![
            test_video("BV1aa411c7mD", "夜曲合集", 3_600),
            test_video("BV1bb411c7mD", "夜曲合集", 180),
        ];

        let reranked = rerank_search_results("夜曲合集", items, true);

        assert_eq!(duration_score(3_600, true), 1.0);
        assert_eq!(reranked[0].bvid, "BV1aa411c7mD");
        assert_eq!(reranked[1].bvid, "BV1bb411c7mD");
    }

    #[test]
    fn rerank_disabled_preserves_input_order() {
        let items = vec![
            test_video("BV1aa411c7mD", "泛匹配", 3_600),
            test_video("BV1bb411c7mD", "夜曲", 180),
        ];

        let reranked = rerank_search_results("夜曲", items, false);

        assert_eq!(reranked[0].bvid, "BV1aa411c7mD");
        assert_eq!(reranked[1].bvid, "BV1bb411c7mD");
    }

    #[test]
    fn stable_sort_preserves_order_when_all_scores_are_equal() {
        let equal_score = SearchScore {
            total: 0.5,
            containment: 0.5,
            duration: 0.5,
            phrase_match: 0.5,
            original_position: 0.5,
        };
        let mut items = vec![
            ScoredSearchVideo {
                original_index: 0,
                score: equal_score,
                item: test_video("BV1aa411c7mD", "第一首", 180),
            },
            ScoredSearchVideo {
                original_index: 1,
                score: equal_score,
                item: test_video("BV1bb411c7mD", "第二首", 180),
            },
            ScoredSearchVideo {
                original_index: 2,
                score: equal_score,
                item: test_video("BV1cc411c7mD", "第三首", 180),
            },
        ];

        stable_sort_scored_results(&mut items);

        assert_eq!(items[0].original_index, 0);
        assert_eq!(items[1].original_index, 1);
        assert_eq!(items[2].original_index, 2);
    }

    #[test]
    fn rerank_preserves_result_count() {
        let items = vec![
            test_video("BV1aa411c7mD", "泛匹配", 3_600),
            test_video("BV1bb411c7mD", "夜曲", 180),
            test_video("BV1cc411c7mD", "夜曲现场", 240),
        ];
        let original_count = items.len();

        let reranked = rerank_search_results("夜曲", items, true);

        assert_eq!(reranked.len(), original_count);
    }

    #[test]
    fn phrase_match_does_not_penalize_long_title_suffixes() {
        let keyword = "青花瓷";
        let short_title = normalize_search_text("青花瓷");
        let long_title =
            normalize_search_text("青花瓷《素胚勾勒出青花笔锋浓转淡》周杰伦原唱完整版现场");

        assert_eq!(exact_phrase_match_score(keyword, &short_title), 1.0);
        assert_eq!(exact_phrase_match_score(keyword, &long_title), 1.0);
    }

    #[test]
    fn phrase_match_rejects_keyword_characters_scattered_across_title() {
        let title = normalize_search_text("青色花开瓷器");

        assert_eq!(exact_phrase_match_score("青花瓷", &title), 0.0);
    }

    #[test]
    fn phrase_match_scores_partial_multi_term_matches_proportionally() {
        let title = normalize_search_text("助眠纯音乐放松版");

        assert_eq!(exact_phrase_match_score("纯音乐 合集", &title), 0.5);
    }

    #[test]
    fn missing_optional_cookie_file_does_not_fail_search_identity_fallback() {
        let missing = unique_temp_cookie_path("missing");
        let cookies = read_optional_buvid_cookies(&missing, "api.bilibili.com");
        assert!(cookies.is_empty());
    }

    #[test]
    fn optional_cookie_fallback_keeps_only_buvid_cookies() {
        let path = unique_temp_cookie_path("buvid-only");
        let future = 4_102_444_800_u64;
        let contents = format!(
            ".bilibili.com\tTRUE\t/\tFALSE\t{future}\tbuvid3\tBUVID3_VALUE\n\
             .bilibili.com\tTRUE\t/\tFALSE\t{future}\tbuvid4\tBUVID4_VALUE\n\
             .bilibili.com\tTRUE\t/\tFALSE\t{future}\tb_nut\tBNUT_VALUE\n\
             .bilibili.com\tTRUE\t/\tFALSE\t{future}\tSESSDATA\tLOGIN_VALUE\n"
        );
        fs::write(&path, contents).unwrap();

        let cookies = read_optional_buvid_cookies(&path, "api.bilibili.com");
        let _ = fs::remove_file(&path);

        assert_eq!(
            cookies.get("buvid3").map(String::as_str),
            Some("BUVID3_VALUE")
        );
        assert_eq!(
            cookies.get("buvid4").map(String::as_str),
            Some("BUVID4_VALUE")
        );
        assert_eq!(cookies.get("b_nut").map(String::as_str), Some("BNUT_VALUE"));
        assert!(!cookies.contains_key("SESSDATA"));
    }

    fn unique_temp_cookie_path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "bilibili-music-search-{label}-{}-{nanos}.txt",
            std::process::id()
        ))
    }

    fn test_video(bvid: &str, title: &str, duration_seconds: u64) -> SearchVideo {
        SearchVideo {
            bvid: bvid.to_owned(),
            title: title.to_owned(),
            uploader: "tester".to_owned(),
            thumbnail_url: "https://example.com/cover.jpg".to_owned(),
            duration_seconds,
            play_count: None,
            pubdate: None,
        }
    }
}
