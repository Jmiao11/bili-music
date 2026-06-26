use crate::guest_playurl::GuestPlayurlClient;
use bilibili_music_core::{BILIBILI_REFERER, DESKTOP_USER_AGENT};
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

const RANKING_V2_MUSIC_URL: &str =
    "https://api.bilibili.com/x/web-interface/ranking/v2?rid=3&type=all";
const RANKING_REGION_MUSIC_URL: &str =
    "https://api.bilibili.com/x/web-interface/ranking/region?rid=3&day=3";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankingTrack {
    pub bvid: String,
    pub title: String,
    pub uploader: String,
    pub thumbnail_url: String,
    pub duration_seconds: u64,
}

#[derive(Clone)]
pub struct RankingClient {
    client: reqwest::Client,
    guest: Arc<GuestPlayurlClient>,
}

impl RankingClient {
    pub fn new(guest: Arc<GuestPlayurlClient>) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| format!("failed to create Bilibili ranking client: {error}"))?;
        Ok(Self { client, guest })
    }

    pub async fn music_ranking(&self) -> Result<Vec<RankingTrack>, String> {
        let cookie_header = self.guest.guest_cookie_header().await?;
        match self.fetch_v2_music_ranking(&cookie_header).await {
            Ok(tracks) if !tracks.is_empty() => Ok(tracks),
            Ok(_) => {
                eprintln!(
                    "[ranking] v2 music ranking returned no valid tracks; trying region fallback"
                );
                self.fetch_region_music_ranking(&cookie_header).await
            }
            Err(error) => {
                eprintln!("[ranking] v2 music ranking failed: {error}; trying region fallback");
                self.fetch_region_music_ranking(&cookie_header).await
            }
        }
    }

    async fn fetch_v2_music_ranking(
        &self,
        cookie_header: &str,
    ) -> Result<Vec<RankingTrack>, String> {
        let envelope: RankingV2Envelope = self
            .client
            .get(RANKING_V2_MUSIC_URL)
            .header(USER_AGENT, DESKTOP_USER_AGENT)
            .header(REFERER, BILIBILI_REFERER)
            .header(COOKIE, cookie_header)
            .send()
            .await
            .map_err(|error| format!("Bilibili music ranking request failed: {error}"))?
            .json()
            .await
            .map_err(|error| format!("invalid Bilibili music ranking response: {error}"))?;
        if envelope.code != 0 {
            return Err(format!(
                "Bilibili music ranking failed with code {}: {}",
                envelope.code, envelope.message
            ));
        }
        let data = envelope
            .data
            .ok_or_else(|| "Bilibili music ranking response has no data".to_owned())?;
        Ok(data
            .list
            .into_iter()
            .filter_map(RankingTrack::from_v2)
            .collect())
    }

    async fn fetch_region_music_ranking(
        &self,
        cookie_header: &str,
    ) -> Result<Vec<RankingTrack>, String> {
        let envelope: RankingRegionEnvelope = self
            .client
            .get(RANKING_REGION_MUSIC_URL)
            .header(USER_AGENT, DESKTOP_USER_AGENT)
            .header(REFERER, BILIBILI_REFERER)
            .header(COOKIE, cookie_header)
            .send()
            .await
            .map_err(|error| format!("Bilibili music ranking fallback request failed: {error}"))?
            .json()
            .await
            .map_err(|error| {
                format!("invalid Bilibili music ranking fallback response: {error}")
            })?;
        if envelope.code != 0 {
            return Err(format!(
                "Bilibili music ranking fallback failed with code {}: {}",
                envelope.code, envelope.message
            ));
        }
        Ok(envelope
            .data
            .into_iter()
            .filter_map(RankingTrack::from_region)
            .collect())
    }
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
        })
    }

    fn from_region(raw: RankingRegionItem) -> Option<Self> {
        let bvid = clean_required(raw.bvid)?;
        Some(Self {
            bvid,
            title: clean_required(raw.title).unwrap_or_else(|| "未命名视频".to_owned()),
            uploader: clean_required(raw.author).unwrap_or_else(|| "未知 UP 主".to_owned()),
            thumbnail_url: normalize_url(raw.pic),
            duration_seconds: parse_duration(&raw.duration).unwrap_or_default(),
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

fn parse_duration(value: &str) -> Option<u64> {
    let parts = value
        .trim()
        .split(':')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    match parts.as_slice() {
        [seconds] => Some(*seconds),
        [minutes, seconds] => Some(minutes * 60 + seconds),
        [hours, minutes, seconds] => Some(hours * 3600 + minutes * 60 + seconds),
        _ => None,
    }
}

#[derive(Deserialize)]
struct RankingV2Envelope {
    code: i64,
    message: String,
    data: Option<RankingV2Data>,
}

#[derive(Deserialize)]
struct RankingV2Data {
    list: Vec<RankingV2Item>,
}

#[derive(Deserialize)]
struct RankingV2Item {
    bvid: Option<String>,
    title: Option<String>,
    owner: Option<RankingOwner>,
    pic: Option<String>,
    duration: Option<u64>,
}

#[derive(Deserialize)]
struct RankingOwner {
    name: Option<String>,
}

#[derive(Deserialize)]
struct RankingRegionEnvelope {
    code: i64,
    message: String,
    #[serde(default)]
    data: Vec<RankingRegionItem>,
}

#[derive(Deserialize)]
struct RankingRegionItem {
    bvid: Option<String>,
    title: Option<String>,
    author: Option<String>,
    pic: Option<String>,
    #[serde(default)]
    duration: String,
}

#[cfg(test)]
mod tests {
    use super::parse_duration;

    #[test]
    fn parses_region_duration() {
        assert_eq!(parse_duration("0:15"), Some(15));
        assert_eq!(parse_duration("3:33"), Some(213));
        assert_eq!(parse_duration("1:02:03"), Some(3723));
        assert_eq!(parse_duration("bad"), None);
    }
}
