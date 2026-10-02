use crate::guest_playurl::GuestPlayurlClient;
use crate::library::{snapshot_from_input, TrackSnapshot, TrackSnapshotInput};
use bilibili_music_core::{BILIBILI_REFERER, DESKTOP_USER_AGENT};
use reqwest::{
    header::{COOKIE, REFERER, USER_AGENT},
    redirect::Policy,
    Url,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Arc, time::Duration};
use tokio::{sync::Mutex, time::Instant};

const LIMIT: usize = 200;
const PAGE_SIZE: usize = 20;
const INTERVAL: Duration = Duration::from_millis(300);

pub struct FavoriteImportClient {
    client: reqwest::Client,
    guest: Arc<GuestPlayurlClient>,
    next_request: Mutex<Instant>,
}

#[derive(Deserialize)]
struct Envelope {
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<PageData>,
}

#[derive(Deserialize)]
struct PageData {
    info: FolderInfo,
    medias: Option<Vec<Media>>,
    has_more: bool,
}

#[derive(Deserialize)]
struct FolderInfo {
    title: String,
    media_count: u64,
}

#[derive(Default, Deserialize)]
struct Media {
    attr: Option<i64>,
    #[serde(rename = "type")]
    kind: Option<u32>,
    bvid: Option<String>,
    bv_id: Option<String>,
    title: Option<String>,
    cover: Option<String>,
    duration: Option<u64>,
    upper: Option<Upper>,
}

#[derive(Deserialize)]
struct Upper {
    name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPage {
    media_id: String,
    title: String,
    total: u64,
    items: Vec<TrackSnapshot>,
    skipped: usize,
    duplicates: usize,
    scanned: usize,
    has_more: bool,
    truncated: bool,
}

impl FavoriteImportClient {
    pub fn new(guest: Arc<GuestPlayurlClient>) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .redirect(Policy::none())
            .build()
            .map_err(|e| format!("无法创建收藏夹客户端：{e}"))?;
        Ok(Self {
            client,
            guest,
            next_request: Mutex::new(Instant::now()),
        })
    }

    pub async fn page(
        &self,
        link: &str,
        page: u32,
        existing: Vec<String>,
    ) -> Result<ImportPage, String> {
        let media_id = parse_media_id(link)?;
        if page == 0 || existing.len() >= LIMIT {
            return Err("收藏夹分页参数错误或已达到 200 条上限。".into());
        }
        // Serialize requests and leave 300ms after each response, including failures.
        let mut next = self.next_request.lock().await;
        tokio::time::sleep_until(*next).await;
        let result = self.fetch(&media_id, page).await;
        *next = Instant::now() + INTERVAL;
        let data = result?;
        collect_page(media_id, data, &existing)
    }

    async fn fetch(&self, media_id: &str, page: u32) -> Result<PageData, String> {
        let cookie = self
            .guest
            .guest_cookie_header()
            .await
            .map_err(|e| format!("收藏夹游客身份获取失败：{e}"))?;
        let mut url = Url::parse("https://api.bilibili.com/x/v3/fav/resource/list").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("media_id", media_id.to_owned()),
            ("pn", page.to_string()),
            ("ps", PAGE_SIZE.to_string()),
            ("platform", "web".into()),
            ("order", "mtime".into()),
            ("type", "0".into()),
        ]);
        let response = self
            .client
            .get(url)
            .header(USER_AGENT, DESKTOP_USER_AGENT)
            .header(REFERER, BILIBILI_REFERER)
            .header(COOKIE, cookie)
            .send()
            .await
            .map_err(|e| format!("收藏夹网络请求失败：{e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "收藏夹网络请求失败（HTTP {}），请稍后重试。",
                response.status()
            ));
        }
        let envelope: Envelope = response
            .json()
            .await
            .map_err(|e| format!("收藏夹响应格式异常：{e}"))?;
        if envelope.code != 0 {
            return Err(api_error(envelope.code, &envelope.message));
        }
        envelope
            .data
            .ok_or_else(|| "收藏夹响应缺少数据，无法确认内容。".into())
    }
}

fn api_error(code: i64, message: &str) -> String {
    match code {
        -403 | -101 => format!(
            "无权访问该收藏夹（可能为私密收藏夹），仅支持公开收藏夹。代码 {code}：{message}"
        ),
        -404 | 11010 => format!("收藏夹不存在或已被删除。代码 {code}：{message}"),
        _ => format!("收藏夹接口拒绝请求（代码 {code}）：{message}。请检查链接或稍后重试。"),
    }
}

pub(crate) fn parse_media_id(input: &str) -> Result<String, String> {
    let invalid =
        || "收藏夹链接格式错误，请粘贴完整的 B站公开收藏夹链接（不是视频或合集链接）。".to_owned();
    let url = Url::parse(input.trim()).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(invalid());
    }
    let host = url.host_str().ok_or_else(invalid)?;
    if matches!(host, "b23.tv" | "bili2233.cn") {
        return Err("暂不支持短链接，请在浏览器打开后复制完整收藏夹链接。".into());
    }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    let params: Vec<_> = url.query_pairs().collect();
    let param = |key: &str| -> Result<Option<String>, String> {
        let values: Vec<_> = params
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.to_string())
            .collect();
        if values.len() > 1 {
            return Err(invalid());
        }
        Ok(values.into_iter().next())
    };
    let candidate = match (host, parts.as_slice()) {
        ("space.bilibili.com", [uid, "favlist"])
            if uid.bytes().all(|b| b.is_ascii_digit()) && !uid.is_empty() =>
        {
            param("fid")?
        }
        ("www.bilibili.com" | "bilibili.com", ["list", ml])
        | ("www.bilibili.com" | "bilibili.com", ["medialist", "detail" | "play", ml])
            if ml.starts_with("ml") =>
        {
            Some(ml[2..].to_owned())
        }
        ("www.bilibili.com" | "bilibili.com", ["medialist", "play", uid])
            if !uid.is_empty()
                && uid.bytes().all(|b| b.is_ascii_digit())
                && param("business")?.as_deref() == Some("space") =>
        {
            param("business_id")?
        }
        _ => None,
    }
    .ok_or_else(invalid)?;
    if candidate.is_empty() || !candidate.bytes().all(|b| b.is_ascii_digit()) {
        return Err(invalid());
    }
    let id = candidate.parse::<u64>().map_err(|_| invalid())?;
    if id == 0 {
        return Err(invalid());
    }
    for key in ["fid", "media_id", "business_id"] {
        if let Some(value) = param(key)? {
            if value.parse::<u64>().ok() != Some(id) {
                return Err(invalid());
            }
        }
    }
    Ok(id.to_string())
}

fn collect_page(
    media_id: String,
    data: PageData,
    existing: &[String],
) -> Result<ImportPage, String> {
    let mut seen: HashSet<String> = existing.iter().map(|s| s.to_ascii_lowercase()).collect();
    if seen.len() >= LIMIT {
        return Err("已达到 200 条上限。".into());
    }
    let medias = data.medias.unwrap_or_default();
    if medias.len() > PAGE_SIZE || (medias.is_empty() && data.has_more) {
        return Err("收藏夹分页响应异常，请稍后重新导入。".into());
    }
    let mut result = ImportPage {
        media_id,
        title: data.info.title,
        total: data.info.media_count,
        items: Vec::new(),
        skipped: 0,
        duplicates: 0,
        scanned: 0,
        has_more: data.has_more,
        truncated: false,
    };
    let count = medias.len();
    for raw in medias {
        if seen.len() == LIMIT {
            break;
        }
        result.scanned += 1;
        if raw.attr != Some(0) || raw.kind != Some(2) {
            result.skipped += 1;
            continue;
        }
        let input = TrackSnapshotInput {
            bvid: raw
                .bvid
                .filter(|s| !s.trim().is_empty())
                .or(raw.bv_id)
                .unwrap_or_default(),
            title: raw.title.unwrap_or_default(),
            uploader: raw.upper.and_then(|u| u.name).unwrap_or_default(),
            thumbnail_url: raw.cover.unwrap_or_default(),
            duration_seconds: raw.duration.unwrap_or_default(),
        };
        match snapshot_from_input(input) {
            Ok(track) => {
                if seen.insert(track.bvid.to_ascii_lowercase()) {
                    result.items.push(track);
                } else {
                    result.duplicates += 1;
                }
            }
            Err(_) => result.skipped += 1,
        }
    }
    result.truncated = seen.len() == LIMIT && (result.scanned < count || result.has_more);
    result.has_more = result.has_more && seen.len() < LIMIT;
    Ok(result)
}

#[tauri::command]
pub async fn read_public_favorite_page(
    state: tauri::State<'_, crate::AppState>,
    link: String,
    page: u32,
    existing: Vec<String>,
) -> Result<ImportPage, String> {
    state.favorite_import.page(&link, page, existing).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_links() {
        for link in [
            " https://space.bilibili.com/12/favlist?ftype=create&fid=123#x ",
            "http://www.bilibili.com/medialist/detail/ml123/",
            "https://www.bilibili.com/medialist/play/ml123?bvid=BV1rW4y1Q7o7",
            "https://www.bilibili.com/list/ml123?foo=bar",
            "https://bilibili.com/list/ml000123",
            "https://www.bilibili.com/medialist/play/12?business_id=123&business=space",
            "https://space.bilibili.com/12/favlist?fid=%31%32%33",
        ] {
            assert_eq!(parse_media_id(link).unwrap(), "123", "{link}");
        }
        assert_eq!(
            parse_media_id("https://www.bilibili.com/list/ml18446744073709551615").unwrap(),
            u64::MAX.to_string()
        );
    }

    #[test]
    fn rejects_invalid_and_ambiguous_links() {
        for link in [
            "",
            "123",
            "ml123",
            "https://evil.com/list/ml123",
            "https://www.bilibili.com.evil.com/list/ml123",
            "https://space.bilibili.com/12/favlist",
            "https://www.bilibili.com/video/BV1rW4y1Q7o7",
            "https://www.bilibili.com/list/123?sid=123",
            "https://www.bilibili.com/list/ml0",
            "https://www.bilibili.com/list/ml-1",
            "https://www.bilibili.com/list/ml1.5",
            "https://www.bilibili.com/list/ml18446744073709551616",
            "https://www.bilibili.com/list/ml",
            "https://space.bilibili.com/12/favlist?fid=1&fid=2",
            "https://www.bilibili.com/list/ml123?media_id=456",
            "https://www.bilibili.com/medialist/play/12?business=space_series&business_id=123",
            "ftp://www.bilibili.com/list/ml123",
            "https://user@www.bilibili.com/list/ml123",
            "https://b23.tv/abc",
        ] {
            assert!(parse_media_id(link).is_err(), "{link}");
        }
    }

    fn media(n: usize, attr: Option<i64>) -> Media {
        Media {
            bvid: Some(format!("BV{n:010}")),
            attr,
            kind: Some(2),
            ..Default::default()
        }
    }
    fn data(medias: Vec<Media>, has_more: bool) -> PageData {
        PageData {
            info: FolderInfo {
                title: "测试".into(),
                media_count: 240,
            },
            medias: Some(medias),
            has_more,
        }
    }

    #[test]
    fn whitelist_skip_and_cross_page_limit() {
        let existing: Vec<_> = (0..198).map(|n| format!("BV{n:010}")).collect();
        let page = collect_page(
            "1".into(),
            data(
                vec![
                    media(198, Some(1)),
                    media(199, Some(9)),
                    media(200, Some(99)),
                    media(201, None),
                    media(202, Some(0)),
                    media(203, Some(0)),
                    media(204, Some(0)),
                ],
                true,
            ),
            &existing,
        )
        .unwrap();
        assert_eq!(page.skipped, 4);
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.scanned, 6);
        assert!(page.truncated);
        assert!(!page.has_more);
    }

    #[test]
    fn duplicates_normalization_and_invalid_bvid() {
        let mut invalid = media(3, Some(0));
        invalid.bvid = Some("deleted".into());
        let mut audio = media(4, Some(0));
        audio.kind = Some(12);
        let page = collect_page(
            "1".into(),
            data(
                vec![
                    media(1, Some(0)),
                    media(2, Some(0)),
                    media(2, Some(0)),
                    invalid,
                    audio,
                ],
                false,
            ),
            &["bv0000000001".into()],
        )
        .unwrap();
        assert_eq!(page.duplicates, 2);
        assert_eq!(page.skipped, 2);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].title, "未命名视频");
        assert_eq!(page.items[0].uploader, "未知 UP 主");
        assert!(!page.truncated);
    }

    #[test]
    fn empty_pages_and_exact_limit() {
        assert!(collect_page("1".into(), data(vec![], true), &[]).is_err());
        assert!(collect_page("1".into(), data(vec![], false), &[])
            .unwrap()
            .items
            .is_empty());
        let existing: Vec<_> = (0..180).map(|n| format!("BV{n:010}")).collect();
        let page = collect_page(
            "1".into(),
            data((180..200).map(|n| media(n, Some(0))).collect(), false),
            &existing,
        )
        .unwrap();
        assert_eq!(page.items.len(), 20);
        assert!(!page.truncated);
        assert!(!page.has_more);
    }

    #[test]
    fn errors_remain_distinct() {
        assert!(api_error(-403, "denied").contains("无权访问"));
        assert!(api_error(11010, "gone").contains("不存在"));
        assert!(api_error(-352, "risk").contains("-352"));
        assert!(!api_error(-400, "bad request").contains("私密"));
    }

    #[test]
    fn invalid_entries_do_not_consume_slots_after_ten_pages() {
        let mut existing = Vec::new();
        let mut skipped = 0;
        for page in 0..20 {
            let result = collect_page(
                "1".into(),
                data(
                    (0..20)
                        .map(|i| media(page * 20 + i, Some(if i < 10 { 0 } else { 9 })))
                        .collect(),
                    true,
                ),
                &existing,
            )
            .unwrap();
            existing.extend(result.items.iter().map(|t| t.bvid.clone()));
            skipped += result.skipped;
            if page < 19 {
                assert!(result.has_more);
            } else {
                assert!(result.truncated);
                assert!(!result.has_more);
            }
        }
        assert_eq!(existing.len(), 200);
        // The final page stops as soon as the 200th valid video is collected.
        assert_eq!(skipped, 190);
    }

    #[test]
    fn import_page_contract_fixture() {
        crate::contract_tests::assert_fixture(
            "import-page",
            &super::ImportPage {
                media_id: "123".into(),
                title: "收藏夹".into(),
                total: 1,
                items: vec![crate::library::TrackSnapshot {
                    bvid: "BV1234567890".into(),
                    title: "曲目".into(),
                    uploader: "作者".into(),
                    thumbnail_url: "https://example.com/cover.jpg".into(),
                    duration_seconds: 120,
                    added_at: "1700000000000".into(),
                }],
                skipped: 0,
                duplicates: 0,
                scanned: 1,
                has_more: false,
                truncated: false,
            },
        );
    }
}
