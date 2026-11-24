use crate::guest_playurl::GuestPlayurlClient;
use bilibili_music_core::{BILIBILI_REFERER, DESKTOP_USER_AGENT};
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

const RANKING_V2_MUSIC_URL: &str =
    "https://api.bilibili.com/x/web-interface/ranking/v2?rid=1003&type=all";
const NEW_MUSIC_URL: &str = "https://api.bilibili.com/x/centralization/interface/new/music";

const MIN_SECONDS: u64 = 60;
const MAX_SECONDS: u64 = 600;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankingTrack {
    pub bvid: String,
    pub title: String,
    pub uploader: String,
    pub thumbnail_url: String,
    pub duration_seconds: u64,
    pub play_count: Option<u64>,
}

#[derive(Clone)]
pub struct RankingClient {
    client: reqwest::Client,
    guest: Arc<GuestPlayurlClient>,
    identity_gate: Arc<tokio::sync::Mutex<()>>,
}

impl RankingClient {
    pub fn new(guest: Arc<GuestPlayurlClient>) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| format!("failed to create Bilibili ranking client: {error}"))?;
        Ok(Self {
            client,
            guest,
            identity_gate: Default::default(),
        })
    }

    async fn cookie(&self) -> Result<String, String> {
        let _gate = self.identity_gate.lock().await;
        self.guest.guest_cookie_header().await
    }

    pub async fn music_ranking(&self) -> Result<Vec<RankingTrack>, String> {
        let cookie_header = self.cookie().await?;
        let data = self.fetch(RANKING_V2_MUSIC_URL, &cookie_header).await?;
        let raw: RankingV2Data =
            serde_json::from_value(data).map_err(|_| "音乐热门响应格式错误")?;
        Ok(popular_tracks(raw.list))
    }

    pub async fn new_songs(&self) -> Result<Vec<RankingTrack>, String> {
        let cookie = self.cookie().await?;
        let data = self.fetch(NEW_MUSIC_URL, &cookie).await?;
        let raw: NewMusicData = serde_json::from_value(data).map_err(|_| "新歌速递响应格式错误")?;
        Ok(raw.list.into_iter().filter_map(new_track).collect())
    }

    async fn fetch(&self, url: &str, cookie: &str) -> Result<serde_json::Value, String> {
        let response = self
            .client
            .get(url)
            .header(USER_AGENT, DESKTOP_USER_AGENT)
            .header(REFERER, BILIBILI_REFERER)
            .header(COOKIE, cookie)
            .send()
            .await
            .map_err(|_| "首页网络请求失败")?;
        if response.status().as_u16() == 412 {
            return Err("首页请求受限".into());
        }
        let success = response.status().is_success();
        let body = response.text().await.map_err(|_| "首页响应读取失败")?;
        parse_feed_body(success, &body)
    }
}

fn parse_feed_body(success: bool, body: &str) -> Result<serde_json::Value, String> {
    let parsed = serde_json::from_str::<serde_json::Value>(body);
    if let Ok(v) = &parsed {
        let msg = v["message"].as_str().unwrap_or_default();
        if matches!(v["code"].as_i64(), Some(-412 | -352))
            || v.get("v_voucher").is_some()
            || v["data"].get("v_voucher").is_some()
            || msg.contains("验证码")
            || msg.to_ascii_lowercase().contains("captcha")
        {
            return Err("首页请求受限".into());
        }
    } else if body.contains("验证码") || body.to_ascii_lowercase().contains("captcha") {
        return Err("首页请求受限".into());
    }
    let v = parsed.map_err(|_| "首页响应格式错误")?;
    if !success || v["code"].as_i64() != Some(0) {
        return Err("首页请求失败".into());
    }
    Ok(v["data"].clone())
}

fn popular_tracks(rows: Vec<RankingV2Item>) -> Vec<RankingTrack> {
    let mut seen = std::collections::HashSet::new();
    rows.into_iter()
        .filter(|r| {
            r.pid_v2 == Some(1003)
                && (MIN_SECONDS..=MAX_SECONDS).contains(&r.duration.unwrap_or(0))
                && ![r.tname.as_deref(), r.tnamev2.as_deref()]
                    .into_iter()
                    .flatten()
                    .any(|name| matches!(name, "乐评盘点" | "音乐教学"))
                && !crate::search::NEGATIVE_TITLE_WORDS
                    .iter()
                    .any(|word| r.title.as_deref().unwrap_or_default().contains(word))
        })
        .filter_map(RankingTrack::from_v2)
        .filter(|r| seen.insert(r.bvid.clone()))
        .take(12)
        .collect()
}

#[derive(Deserialize)]
struct NewMusicData {
    list: Vec<NewSong>,
}
#[derive(Deserialize)]
struct NewSong {
    bvid: Option<String>,
    music_title: Option<String>,
    author: Option<String>,
    cover: Option<String>,
    duration: Option<u64>,
}
fn new_track(row: NewSong) -> Option<RankingTrack> {
    Some(RankingTrack {
        bvid: clean_required(row.bvid)?,
        title: clean_required(row.music_title).unwrap_or_else(|| "未命名视频".into()),
        uploader: clean_required(row.author).unwrap_or_else(|| "未知 UP 主".into()),
        thumbnail_url: normalize_url(row.cover),
        duration_seconds: row.duration.unwrap_or_default(),
        play_count: None,
    })
}

impl RankingTrack {
    fn from_v2(raw: RankingV2Item) -> Option<Self> {
        let bvid = clean_required(raw.bvid)?;
        Some(Self {
            bvid,
            title: clean_required(raw.title).unwrap_or_else(|| "未命名视频".to_owned()),
            uploader: raw
                .owner
                .and_then(|owner| clean_required(owner.name))
                .unwrap_or_else(|| "未知 UP 主".to_owned()),
            thumbnail_url: normalize_url(raw.pic),
            duration_seconds: raw.duration.unwrap_or_default(),
            play_count: raw.stat.and_then(|stat| non_negative_i64_to_u64(stat.view)),
        })
    }
}

fn clean_required(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_owned())
        }
    })
}

fn normalize_url(value: Option<String>) -> String {
    let value = value.unwrap_or_default();
    let value = value.trim();
    if let Some(url) = value.strip_prefix("//") {
        return format!("https://{url}");
    }
    if let Some(url) = value.strip_prefix("http://") {
        return format!("https://{url}");
    }
    value.to_owned()
}

#[derive(Deserialize)]
struct RankingV2Data {
    list: Vec<RankingV2Item>,
}

#[derive(Deserialize)]
struct RankingV2Item {
    pid_v2: Option<u32>,
    tname: Option<String>,
    tnamev2: Option<String>,
    bvid: Option<String>,
    title: Option<String>,
    owner: Option<RankingOwner>,
    pic: Option<String>,
    duration: Option<u64>,
    stat: Option<RankingStat>,
}

#[derive(Deserialize)]
struct RankingOwner {
    name: Option<String>,
}

#[derive(Deserialize)]
struct RankingStat {
    view: Option<i64>,
}

fn non_negative_i64_to_u64(value: Option<i64>) -> Option<u64> {
    value.and_then(|value| u64::try_from(value).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_restrictions_before_decoding_items() {
        for body in [
            r#"{"code":-412}"#,
            r#"{"code":-352}"#,
            r#"{"code":0,"data":{"v_voucher":"synthetic"}}"#,
            r#"{"code":1,"message":"验证码"}"#,
            "<title>Captcha</title>",
        ] {
            assert_eq!(parse_feed_body(true, body).unwrap_err(), "首页请求受限");
        }
        assert_eq!(
            parse_feed_body(true, "broken").unwrap_err(),
            "首页响应格式错误"
        );
    }
    fn candidate(id: usize, edits: serde_json::Value) -> RankingV2Item {
        let mut value = serde_json::json!({"bvid":format!("BV{id:010}"),"pid_v2":1003,"duration":200,"title":"合成歌曲"});
        for (k, v) in edits.as_object().unwrap() {
            value[k] = v.clone();
        }
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn rejects_non_music_parent() {
        assert!(popular_tracks(vec![candidate(1, serde_json::json!({"pid_v2":1008}))]).is_empty());
    }
    #[test]
    fn filters_both_division_names() {
        for field in ["tname", "tnamev2"] {
            for name in ["乐评盘点", "音乐教学"] {
                assert!(
                    popular_tracks(vec![candidate(1, serde_json::json!({(field):name}))])
                        .is_empty()
                );
            }
        }
    }
    #[test]
    fn filters_negative_titles() {
        for word in crate::search::NEGATIVE_TITLE_WORDS {
            assert!(popular_tracks(vec![candidate(
                1,
                serde_json::json!({"title":format!("歌曲{word}")})
            )])
            .is_empty());
        }
    }
    #[test]
    fn duration_boundaries() {
        for (duration, count) in [(59, 0), (60, 1), (600, 1), (601, 0)] {
            assert_eq!(
                popular_tracks(vec![candidate(1, serde_json::json!({"duration":duration}))]).len(),
                count
            );
        }
    }
    #[test]
    fn keeps_first_twelve_distinct_in_order() {
        let tracks = popular_tracks(
            [0, 0]
                .into_iter()
                .chain(1..16)
                .map(|i| candidate(i, serde_json::json!({})))
                .collect(),
        );
        assert_eq!(tracks.len(), 12);
        assert_eq!(tracks[11].bvid, "BV0000000011");
    }
    #[test]
    fn maps_top_level_new_song() {
        let row = serde_json::json!({"bvid":"BV0000000001","related_archive":{"bvid":"BV0000000002"},"music_title":"曲目","author":"歌手"});
        let track = new_track(serde_json::from_value(row).unwrap()).unwrap();
        assert_eq!(
            (
                track.bvid.as_str(),
                track.title.as_str(),
                track.uploader.as_str(),
                track.duration_seconds
            ),
            ("BV0000000001", "曲目", "歌手", 0)
        );
        assert!(
            new_track(serde_json::from_value(serde_json::json!({"bvid":" "})).unwrap()).is_none()
        );
    }

    #[test]
    fn parses_v2_play_count_from_stat_view() {
        let raw: RankingV2Item = serde_json::from_str(
            r#"{
                "bvid": "BV1xx411c7mD",
                "title": "Song",
                "owner": { "name": "UP" },
                "pic": "//i0.hdslb.com/bfs/archive/cover.jpg",
                "duration": 187,
                "stat": { "view": 12345 }
            }"#,
        )
        .unwrap();
        let track = RankingTrack::from_v2(raw).unwrap();

        assert_eq!(track.play_count, Some(12_345));
    }

    #[test]
    fn parses_v2_without_stat_view() {
        let raw: RankingV2Item = serde_json::from_str(
            r#"{
                "bvid": "BV1xx411c7mD",
                "title": "Song",
                "owner": { "name": "UP" },
                "pic": "//i0.hdslb.com/bfs/archive/cover.jpg",
                "duration": 187
            }"#,
        )
        .unwrap();
        let track = RankingTrack::from_v2(raw).unwrap();

        assert_eq!(track.play_count, None);
    }
}
