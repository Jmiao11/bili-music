use crate::ranking::{RankingClient, RankingTrack};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

mod for_you;
use for_you::{Seed, Selection};

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Source {
    Ranking,
    NewSongs,
    ForYou,
}
#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Mode {
    Cache,
    Auto,
    Refresh,
    Retry,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Section {
    date: String,
    fetched_at: u64,
    items: Vec<RankingTrack>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    seeds: Vec<Seed>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    no_seeds_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    risk_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    risk_at: Option<u64>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cache {
    version: u8,
    ranking: Section,
    new_songs: Section,
    #[serde(default)]
    for_you: Section,
}
impl Default for Cache {
    fn default() -> Self {
        Self {
            version: 1,
            ranking: Section::default(),
            new_songs: Section::default(),
            for_you: Section::default(),
        }
    }
}
impl Cache {
    fn visible_new_songs(&self) -> Vec<RankingTrack> {
        let mut seen: std::collections::HashSet<_> = self
            .ranking
            .items
            .iter()
            .map(|track| track.bvid.as_str())
            .collect();
        self.new_songs
            .items
            .iter()
            .filter(|track| seen.insert(track.bvid.as_str()))
            .take(8)
            .cloned()
            .collect()
    }
    fn section(&mut self, source: Source) -> &mut Section {
        match source {
            Source::Ranking => &mut self.ranking,
            Source::NewSongs => &mut self.new_songs,
            Source::ForYou => &mut self.for_you,
        }
    }
}
fn read(guard: &crate::storage::StorageGuard, path: &Path) -> Result<Cache, String> {
    match crate::storage::read(guard, path) {
        Ok(bytes) => Ok(serde_json::from_slice::<Cache>(&bytes)
            .ok()
            .filter(|c| c.version == 1)
            .unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Cache::default()),
        Err(_) => Err("首页缓存读取失败".into()),
    }
}
#[derive(Default)]
struct Attempts {
    date: String,
    failures: u8,
    restricted: bool,
    auto_blocked: bool,
    last: Option<Instant>,
    error: Option<String>,
}
impl Attempts {
    fn should_fetch(&self, mode: Mode, section: &Section, today: &str, now: Instant) -> bool {
        match mode {
            Mode::Cache => false,
            Mode::Auto => {
                !(section.date == today && (!section.items.is_empty() || !section.seeds.is_empty()))
                    && (self.date != today || (!self.auto_blocked && self.failures < 2))
            }
            Mode::Refresh | Mode::Retry => {
                !(mode == Mode::Refresh || (self.date == today && self.restricted))
                    || self
                        .last
                        .is_none_or(|t| now.duration_since(t) >= Duration::from_secs(60))
            }
        }
    }
}
#[derive(Default)]
pub(crate) struct HomeFeed {
    sequence: std::sync::atomic::AtomicU64,
    ranking: Mutex<Attempts>,
    new_songs: Mutex<Attempts>,
    for_you: Mutex<Attempts>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedResult {
    section: Section,
    error: Option<String>,
    restricted: bool,
    request_at: Option<u64>,
    new_songs: Vec<RankingTrack>,
    sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    available: Option<bool>,
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl HomeFeed {
    pub(crate) async fn load(
        &self,
        client: &RankingClient,
        source: Source,
        mode: Mode,
        today: String,
    ) -> Result<FeedResult, String> {
        if today.len() != 10
            || !today.bytes().enumerate().all(|(i, c)| {
                if i == 4 || i == 7 {
                    c == b'-'
                } else {
                    c.is_ascii_digit()
                }
            })
        {
            return Err("首页日期格式错误".into());
        }
        let path = crate::library::library_root()?.join("home_feed.json");
        self.load_from(
            &path,
            source,
            mode,
            today,
            |previous| for_you::plan(timestamp(), previous),
            |selection| async move {
                match source {
                    Source::Ranking => client.music_ranking().await,
                    Source::NewSongs => client.new_songs().await,
                    Source::ForYou => {
                        let selection = selection.expect("a related request requires seeds");
                        let seeds = selection
                            .seeds
                            .iter()
                            .map(|seed| seed.bvid.clone())
                            .collect::<Vec<_>>();
                        let batches = client.related(seeds).await?;
                        Ok(selection.tracks(batches))
                    }
                }
            },
        )
        .await
    }
    async fn load_from<F, Fut>(
        &self,
        path: &Path,
        source: Source,
        mode: Mode,
        today: String,
        plan: impl FnOnce(&[Seed]) -> Result<Option<Selection>, String>,
        fetch: F,
    ) -> Result<FeedResult, String>
    where
        F: FnOnce(Option<Selection>) -> Fut,
        Fut: std::future::Future<Output = Result<Vec<RankingTrack>, String>>,
    {
        let lock = match source {
            Source::Ranking => &self.ranking,
            Source::NewSongs => &self.new_songs,
            Source::ForYou => &self.for_you,
        };
        let mut attempts = lock.lock().await;
        let mut section = {
            let guard = crate::storage::lock_storage()?;
            read(&guard, path)?.section(source).clone()
        };
        let now = Instant::now();
        let mut request_at = None;
        if attempts.date != today {
            attempts.date = today.clone();
            attempts.auto_blocked = section.risk_date.as_deref() == Some(&today);
            attempts.failures = 0;
            attempts.restricted = false;
            attempts.error = None;
            if attempts.auto_blocked {
                attempts.restricted = true;
                attempts.error = Some("请求受限".into());
                if let Some(at) = section.risk_at {
                    let elapsed = timestamp().saturating_sub(at);
                    if elapsed < 60_000 {
                        attempts.last = now.checked_sub(Duration::from_millis(elapsed));
                        request_at = Some(at);
                    }
                }
            }
        }
        let cold_today = section.no_seeds_date.as_deref() == Some(&today);
        let should_fetch = attempts.should_fetch(mode, &section, &today, now)
            && !(source == Source::ForYou && mode == Mode::Auto && cold_today);
        let mut available = !section.seeds.is_empty() && !cold_today;
        let selection = if source == Source::ForYou
            && mode != Mode::Cache
            && (should_fetch || !available && !cold_today)
        {
            let selection = plan(&section.seeds)?;
            available = selection.is_some();
            if should_fetch && !available {
                section.no_seeds_date = Some(today.clone());
                save_section(path, source, &section)?;
            }
            selection
        } else {
            None
        };
        if should_fetch && (source != Source::ForYou || selection.is_some()) {
            attempts.last = Some(Instant::now());
            request_at = Some(timestamp());
            let seeds = selection
                .as_ref()
                .map_or_else(Vec::new, |selection| selection.seeds.clone());
            let result = fetch(selection).await;
            match result {
                Ok(items) => {
                    section = Section {
                        risk_date: section.risk_date,
                        risk_at: section.risk_at,
                        date: today,
                        fetched_at: timestamp(),
                        items,
                        seeds,
                        no_seeds_date: None,
                    };
                    save_section(path, source, &section)?;
                    attempts.failures = 0;
                    attempts.restricted = false;
                    attempts.error = None;
                }
                Err(e) => {
                    attempts.restricted = e.contains("请求受限")
                        || e.contains("412")
                        || e.contains("-352")
                        || e.contains("验证码");
                    attempts.auto_blocked |= attempts.restricted;
                    let was_cold = section.no_seeds_date.take().is_some();
                    if attempts.restricted {
                        section.risk_date = Some(today.clone());
                        section.risk_at = request_at;
                    }
                    if attempts.restricted || was_cold {
                        save_section(path, source, &section)?;
                    }
                    if mode == Mode::Auto {
                        attempts.failures += 1;
                    }
                    attempts.error = Some(
                        if attempts.restricted {
                            "请求受限"
                        } else {
                            "更新失败"
                        }
                        .into(),
                    );
                }
            }
        }
        let guard = crate::storage::lock_storage()?;
        let cache = read(&guard, path)?;
        let new_songs = cache.visible_new_songs();
        if source == Source::NewSongs {
            section.items = new_songs.clone();
        }
        Ok(FeedResult {
            new_songs,
            sequence: self
                .sequence
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                + 1,
            section,
            error: attempts.error.clone(),
            restricted: attempts.restricted,
            request_at,
            available: (source == Source::ForYou).then_some(available),
        })
    }
}

fn save_section(path: &Path, source: Source, section: &Section) -> Result<(), String> {
    let guard = crate::storage::lock_storage()?;
    let mut cache = read(&guard, path)?;
    *cache.section(source) = section.clone();
    crate::storage::write_json_atomic(&guard, path, &cache)
}

#[cfg(test)]
mod tests {
    use super::*;
    const DAY: &str = "2026-11-23";
    fn rows(n: usize) -> Vec<RankingTrack> {
        (0..n)
            .map(|i| RankingTrack {
                bvid: format!("BV{i:010}"),
                title: format!("曲目{i}"),
                uploader: "合成作者".into(),
                thumbnail_url: String::new(),
                duration_seconds: 60,
                play_count: None,
            })
            .collect()
    }
    #[tokio::test]
    async fn same_day_sends_no_request_and_next_day_preserves_failed_source() {
        let dir = std::env::temp_dir().join(format!("bili-r2-cache-{}", uuid::Uuid::new_v4()));
        let path = dir.join("home_feed.json");
        let feed = HomeFeed::default();
        let request = |count| move |_| async move { Ok(rows(count)) };
        feed.load_from(
            &path,
            Source::Ranking,
            Mode::Auto,
            DAY.into(),
            |_| Ok(None),
            request(2),
        )
        .await
        .unwrap();
        let result = feed
            .load_from(
                &path,
                Source::NewSongs,
                Mode::Auto,
                DAY.into(),
                |_| Ok(None),
                request(16),
            )
            .await
            .unwrap();
        assert_eq!(result.new_songs.len(), 8);
        assert_eq!(result.new_songs[0].bvid, "BV0000000002");
        let fresh = HomeFeed::default();
        let cached = fresh
            .load_from(
                &path,
                Source::Ranking,
                Mode::Auto,
                DAY.into(),
                |_| Ok(None),
                |_| async { panic!("同日不发请求") },
            )
            .await
            .unwrap();
        assert!(cached.request_at.is_none());
        let later = "2026-11-24".to_string();
        for _ in 0..2 {
            let failed = fresh
                .load_from(
                    &path,
                    Source::Ranking,
                    Mode::Auto,
                    later.clone(),
                    |_| Ok(None),
                    |_| async { Err("网络失败".into()) },
                )
                .await
                .unwrap();
            assert!(failed.request_at.is_some());
            assert_eq!(failed.section.fetched_at, cached.section.fetched_at);
            assert_eq!(failed.section.items.len(), 2);
        }
        fresh
            .load_from(
                &path,
                Source::Ranking,
                Mode::Auto,
                later.clone(),
                |_| Ok(None),
                |_| async { panic!("超出重试次数") },
            )
            .await
            .unwrap();
        let other = fresh
            .load_from(
                &path,
                Source::NewSongs,
                Mode::Auto,
                later,
                |_| Ok(None),
                request(3),
            )
            .await
            .unwrap();
        assert_eq!(other.section.items.len(), 1);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        let tomorrow = "2026-11-25".to_owned();
        let limited = fresh
            .load_from(
                &path,
                Source::Ranking,
                Mode::Auto,
                tomorrow.clone(),
                |_| Ok(None),
                |_| async { Err("首页请求受限".into()) },
            )
            .await
            .unwrap();
        assert!(limited.restricted);
        let restarted = HomeFeed::default();
        let stopped = restarted
            .load_from(
                &path,
                Source::Ranking,
                Mode::Auto,
                tomorrow,
                |_| Ok(None),
                |_| async { panic!("风控当天重开不能请求") },
            )
            .await
            .unwrap();
        assert!(stopped.restricted);
        assert_eq!(stopped.section.fetched_at, cached.section.fetched_at);
        for bytes in [b"broken".as_slice(),br#"{"version":99,"ranking":{"date":"x","fetchedAt":1,"items":[]},"newSongs":{"date":"x","fetchedAt":1,"items":[]}}"#] {
            std::fs::write(&path,bytes).unwrap();
            let empty=read(&crate::storage::lock_storage().unwrap(),&path).unwrap();
            assert!(empty.ranking.date.is_empty());
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn risk_and_retry_cooldowns() {
        let start = Instant::now();
        let mut attempts = Attempts {
            date: DAY.into(),
            last: Some(start),
            restricted: true,
            auto_blocked: true,
            ..Default::default()
        };
        let empty = Section::default();
        assert!(!attempts.should_fetch(Mode::Auto, &empty, DAY, start + Duration::from_secs(80)));
        assert!(attempts.should_fetch(Mode::Auto, &empty, "2026-11-24", start));
        for mode in [Mode::Refresh, Mode::Retry] {
            assert!(!attempts.should_fetch(mode, &empty, DAY, start + Duration::from_secs(59)));
            assert!(attempts.should_fetch(mode, &empty, DAY, start + Duration::from_secs(60)));
        }
        attempts.restricted = false;
        assert!(attempts.should_fetch(Mode::Retry, &empty, DAY, start));
    }
}
