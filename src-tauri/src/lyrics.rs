mod matching;

use matching::{
    candidates_from_search_response, extract_keywords, judge_confidence, rank_candidates,
    should_skip_auto,
};
pub use matching::{Candidate, Confidence, MatchInput, ScoredCandidate};

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    time::Duration,
};

const LYRIC_API_BASE: &str = "https://api.vkeys.cn/v2";
const VIEW_DETAIL_URL: &str = "https://api.bilibili.com/x/web-interface/view/detail";
const REQUEST_TIMEOUT_SECS: u64 = 5;
const LYRICS_OFFSETS_FILE: &str = "lyrics-offsets.json";
const OFFSETS_VERSION: u32 = 1;
const LYRICS_BINDINGS_FILE: &str = "lyrics-bindings.json";
const BINDINGS_VERSION: u32 = 1;
const NEGATIVE_TTL_SECS: i64 = 7 * 24 * 3600;
const CACHE_VERSION: u32 = 1;
const LYRICS_CACHE_TTL_SECS: i64 = 30 * 24 * 3600;
const VIDEO_PAGES_CACHE_FILE: &str = "video-pages-cache.json";
const VIDEO_PAGES_CACHE_VERSION: u32 = 1;
const VIDEO_PAGES_TTL_SECS: i64 = 30 * 24 * 3600;
static VIDEO_PAGES_CACHE_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[derive(Debug, Deserialize, Serialize)]
struct LyricsOffsetsFile {
    version: u32,
    offsets: HashMap<String, i64>,
}

impl Default for LyricsOffsetsFile {
    fn default() -> Self {
        Self {
            version: OFFSETS_VERSION,
            offsets: HashMap::new(),
        }
    }
}

impl crate::library::Versioned for LyricsOffsetsFile {
    fn version(&self) -> u32 {
        self.version
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    pub lrc: String,
    pub trans: String,
    pub has_lyric: bool,
}

#[derive(Debug, Deserialize, Serialize)]
struct CachedLyrics {
    version: u32,
    song_id: String,
    lrc: String,
    trans: String,
    cached_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PageMeta {
    pub cid: i64,
    pub page: i64,
    pub part: String,
    pub duration: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CachedVideoPages {
    pub videos: i64,
    pub pages: Vec<PageMeta>,
    pub cached_at: i64,
}

#[derive(Debug, Deserialize, Serialize)]
struct VideoPagesCacheFile {
    version: u32,
    entries: HashMap<String, CachedVideoPages>,
}

impl Default for VideoPagesCacheFile {
    fn default() -> Self {
        Self {
            version: VIDEO_PAGES_CACHE_VERSION,
            entries: HashMap::new(),
        }
    }
}

impl crate::library::Versioned for VideoPagesCacheFile {
    fn version(&self) -> u32 {
        self.version
    }
}

#[derive(Debug, Serialize)]
pub struct VideoMeta {
    pub title: String,
    pub desc: String,
    pub duration: i64,
    pub videos: i64,
    pub bgm_name: Option<String>,
    pub pages: Vec<PageMeta>,
}

pub struct MatchOutcome {
    pub confidence: String,
    pub used_keyword: String,
    pub candidates: Vec<ScoredCandidate>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LyricsBinding {
    pub song_id: String,
    pub song_name: String,
    pub singer: String,
    pub source: String,
    pub confidence: f64,
    pub checked_at: i64,
}

#[derive(Debug, Deserialize, Serialize)]
struct LyricsBindingsFile {
    version: u32,
    bindings: HashMap<String, LyricsBinding>,
}

impl Default for LyricsBindingsFile {
    fn default() -> Self {
        Self {
            version: BINDINGS_VERSION,
            bindings: HashMap::new(),
        }
    }
}

impl crate::library::Versioned for LyricsBindingsFile {
    fn version(&self) -> u32 {
        self.version
    }
}

#[derive(Serialize)]
pub struct ResolveOutcome {
    pub status: String,
    pub song_id: String,
    pub song_name: String,
    pub singer: String,
    pub lyrics: Option<Lyrics>,
    pub offset_ms: i64,
    pub used_keyword: String,
    pub candidates: Vec<ScoredCandidate>,
}

#[derive(Deserialize)]
struct LyricApiResponse {
    code: i32,
    #[serde(default)]
    data: Option<LyricApiData>,
}

#[derive(Deserialize)]
struct LyricApiData {
    #[serde(default)]
    lrc: Option<String>,
    #[serde(default)]
    trans: Option<String>,
    #[serde(default)]
    yrc: Option<String>,
    #[serde(default)]
    roma: Option<String>,
}

#[derive(Deserialize)]
struct ViewDetailResponse {
    #[serde(default)]
    code: Option<i64>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    data: Option<ViewDetailData>,
}

#[derive(Deserialize)]
struct ViewDetailData {
    #[serde(default, rename = "View")]
    view: Option<ViewDetail>,
    #[serde(default, rename = "Tags")]
    tags: Option<Vec<ViewTag>>,
}

#[derive(Deserialize)]
struct ViewDetail {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    desc: Option<String>,
    #[serde(default)]
    duration: Option<i64>,
    #[serde(default)]
    videos: Option<i64>,
    #[serde(default)]
    pages: Option<Vec<ViewPage>>,
}

#[derive(Deserialize)]
struct ViewPage {
    #[serde(default)]
    cid: Option<i64>,
    #[serde(default)]
    page: Option<i64>,
    #[serde(default)]
    part: Option<String>,
    #[serde(default)]
    duration: Option<i64>,
}

#[derive(Deserialize)]
struct ViewTag {
    #[serde(default)]
    tag_type: Option<String>,
    #[serde(default)]
    tag_name: Option<String>,
}

#[derive(Deserialize)]
struct SongSearchResponse {
    #[serde(default)]
    code: Option<i64>,
    #[serde(default)]
    data: Option<Vec<SongSearchItem>>,
}

#[derive(Deserialize)]
struct SongSearchItem {
    #[serde(default)]
    id: Option<i64>,
    #[serde(default)]
    song: Option<String>,
    #[serde(default)]
    singer: Option<String>,
    #[serde(default)]
    interval: Option<String>,
    #[serde(default)]
    grp: Option<Vec<SongSearchItem>>,
}

fn lyrics_cache_dir() -> Result<PathBuf, String> {
    let dir = crate::library::library_root()?.join("lyrics");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("无法创建歌词缓存目录 {}：{error}", dir.display()))?;
    Ok(dir)
}

fn is_safe_song_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn read_lyrics_cache(song_id: &str) -> Option<Lyrics> {
    read_lyrics_cache_inner(song_id, false)
}

fn read_lyrics_cache_allow_expired(song_id: &str) -> Option<Lyrics> {
    read_lyrics_cache_inner(song_id, true)
}

fn read_lyrics_cache_inner(song_id: &str, allow_expired: bool) -> Option<Lyrics> {
    if !is_safe_song_id(song_id) {
        return None;
    }
    let path = lyrics_cache_dir().ok()?.join(format!("{song_id}.json"));
    let cached = serde_json::from_str::<CachedLyrics>(&fs::read_to_string(path).ok()?).ok()?;
    if cached.version != CACHE_VERSION
        || cached.song_id != song_id
        || cached.lrc.trim().is_empty()
        || (!allow_expired && unix_now().saturating_sub(cached.cached_at) >= LYRICS_CACHE_TTL_SECS)
    {
        return None;
    }
    Some(Lyrics {
        lrc: cached.lrc,
        trans: cached.trans,
        has_lyric: true,
    })
}

fn write_lyrics_cache(song_id: &str, lyrics: &Lyrics) {
    if !is_safe_song_id(song_id) || !lyrics.has_lyric || lyrics.lrc.trim().is_empty() {
        return;
    }

    let dir = match lyrics_cache_dir() {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!("歌词缓存写入失败：{error}");
            return;
        }
    };
    let target = dir.join(format!("{song_id}.json"));
    let tmp = dir.join(format!("{song_id}.json.tmp"));
    let backup = dir.join(format!("{song_id}.old.json.tmp"));
    let cached = CachedLyrics {
        version: CACHE_VERSION,
        song_id: song_id.to_string(),
        lrc: lyrics.lrc.clone(),
        trans: lyrics.trans.clone(),
        cached_at: unix_now(),
    };
    let result = (|| -> Result<(), String> {
        let json = serde_json::to_vec_pretty(&cached)
            .map_err(|error| format!("歌词缓存序列化失败：{error}"))?;
        fs::write(&tmp, json).map_err(|error| format!("无法写入 {}：{error}", tmp.display()))?;
        if target.exists() {
            if backup.exists() {
                fs::remove_file(&backup)
                    .map_err(|error| format!("无法清理 {}：{error}", backup.display()))?;
            }
            fs::rename(&target, &backup)
                .map_err(|error| format!("无法备份 {}：{error}", target.display()))?;
        }
        if let Err(error) = fs::rename(&tmp, &target) {
            if backup.exists() {
                let _ = fs::rename(&backup, &target);
            }
            return Err(format!("无法保存歌词缓存 {}：{error}", target.display()));
        }
        if backup.exists() {
            let _ = fs::remove_file(backup);
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&tmp);
        eprintln!("歌词缓存写入失败：{error}");
    }
}

pub async fn fetch_lyrics_by_id(song_id: String) -> Result<Lyrics, String> {
    if let Some(lyrics) = read_lyrics_cache(&song_id) {
        return Ok(lyrics);
    }

    let result = async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|error| format!("无法创建歌词请求客户端：{error}"))?;
        let url = format!(
            "{LYRIC_API_BASE}/music/tencent/lyric?id={}",
            utf8_percent_encode(&song_id, NON_ALPHANUMERIC)
        );

        let response = match client.get(&url).send().await {
            Ok(response) => response,
            Err(error) if error.is_timeout() || error.is_connect() || error.is_request() => client
                .get(&url)
                .send()
                .await
                .map_err(|error| format!("歌词请求失败：{error}"))?,
            Err(error) => return Err(format!("歌词请求失败：{error}")),
        };
        if !response.status().is_success() {
            return Ok(no_lyrics());
        }

        let response = response
            .json::<LyricApiResponse>()
            .await
            .map_err(|error| format!("歌词服务响应解析失败：{error}"))?;
        Ok(lyrics_from_response(response))
    }
    .await;

    match result {
        Ok(lyrics) => {
            write_lyrics_cache(&song_id, &lyrics);
            Ok(lyrics)
        }
        Err(error) => read_lyrics_cache_allow_expired(&song_id).ok_or(error),
    }
}

pub async fn fetch_video_meta(bvid: &str, cookie_header: &str) -> Result<VideoMeta, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("无法创建视频元数据请求客户端：{error}"))?;
    let url = format!(
        "{VIEW_DETAIL_URL}?bvid={}",
        utf8_percent_encode(bvid, NON_ALPHANUMERIC)
    );

    let response = {
        let mut retried = false;
        loop {
            match client
                .get(&url)
                .header(
                    reqwest::header::USER_AGENT,
                    bilibili_music_core::DESKTOP_USER_AGENT,
                )
                .header(
                    reqwest::header::REFERER,
                    bilibili_music_core::BILIBILI_REFERER,
                )
                .header(reqwest::header::COOKIE, cookie_header)
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => {
                    match response.json::<ViewDetailResponse>().await {
                        Ok(response) => break response,
                        Err(error)
                            if !retried
                                && (error.is_timeout()
                                    || error.is_connect()
                                    || error.is_body()) =>
                        {
                            retried = true;
                        }
                        Err(error) => {
                            return Err(format!("视频元数据响应解析失败：{error}"));
                        }
                    }
                }
                Ok(response) => {
                    return Err(format!("视频元数据请求失败：HTTP {}", response.status()));
                }
                Err(error)
                    if !retried
                        && (error.is_timeout() || error.is_connect() || error.is_request()) =>
                {
                    retried = true;
                }
                Err(error) => return Err(format!("视频元数据请求失败：{error}")),
            }
        }
    };
    video_meta_from_response(response)
}

#[tauri::command]
pub fn get_cached_video_pages(
    bvids: Vec<String>,
) -> Result<HashMap<String, CachedVideoPages>, String> {
    let Ok(path) = video_pages_cache_path() else {
        return Ok(HashMap::new());
    };
    let Ok(file) = crate::library::read_json_or_default::<VideoPagesCacheFile>(&path) else {
        return Ok(HashMap::new());
    };
    Ok(fresh_video_pages_entries(file, bvids, unix_now()))
}

pub fn cache_video_pages(bvid: String, videos: i64, pages: Vec<PageMeta>) -> Result<(), String> {
    if bvid.trim().is_empty() || videos < 1 {
        return Ok(());
    }
    let _guard = VIDEO_PAGES_CACHE_WRITE_LOCK
        .lock()
        .map_err(|_| "分P缓存写入锁已损坏。".to_owned())?;
    let path = video_pages_cache_path()?;
    let mut file =
        crate::library::read_json_or_default::<VideoPagesCacheFile>(&path).unwrap_or_default();
    file.entries.insert(
        bvid.trim().to_owned(),
        CachedVideoPages {
            videos,
            pages,
            cached_at: unix_now(),
        },
    );
    crate::library::write_json_atomic(&path, &file)
}

#[tauri::command]
pub fn clear_video_pages_cache() -> Result<u32, String> {
    let _guard = VIDEO_PAGES_CACHE_WRITE_LOCK
        .lock()
        .map_err(|_| "分P缓存写入锁已损坏。".to_owned())?;
    let path = video_pages_cache_path()?;
    let count = crate::library::read_json_or_default::<VideoPagesCacheFile>(&path)
        .unwrap_or_default()
        .entries
        .len()
        .min(u32::MAX as usize) as u32;
    crate::library::write_json_atomic(&path, &VideoPagesCacheFile::default())?;
    Ok(count)
}

fn video_pages_cache_path() -> Result<PathBuf, String> {
    Ok(crate::library::library_root()?.join(VIDEO_PAGES_CACHE_FILE))
}

fn fresh_video_pages_entries(
    file: VideoPagesCacheFile,
    bvids: Vec<String>,
    now: i64,
) -> HashMap<String, CachedVideoPages> {
    let requested = bvids
        .into_iter()
        .map(|bvid| bvid.trim().to_owned())
        .filter(|bvid| !bvid.is_empty())
        .collect::<HashSet<_>>();
    file.entries
        .into_iter()
        .filter(|(bvid, entry)| {
            requested.contains(bvid) && now.saturating_sub(entry.cached_at) < VIDEO_PAGES_TTL_SECS
        })
        .collect()
}

fn video_meta_from_response(response: ViewDetailResponse) -> Result<VideoMeta, String> {
    let code = response.code.unwrap_or(-1);
    if code != 0 {
        return Err(format!(
            "B站视频元数据接口返回错误（code {code}）：{}",
            response.message.unwrap_or_else(|| "未知错误".to_string())
        ));
    }

    let data = response
        .data
        .ok_or_else(|| "B站视频元数据响应缺少 data".to_string())?;
    let view = data
        .view
        .ok_or_else(|| "B站视频元数据响应缺少 View".to_string())?;
    let bgm_name = data
        .tags
        .unwrap_or_default()
        .into_iter()
        .find(|tag| tag.tag_type.as_deref() == Some("bgm"))
        .and_then(|tag| tag.tag_name)
        .and_then(|name| {
            let name = name.trim();
            name.strip_prefix("发现《")
                .and_then(|name| name.strip_suffix('》'))
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_owned)
        });
    let pages = view
        .pages
        .unwrap_or_default()
        .into_iter()
        .map(|page| PageMeta {
            cid: page.cid.unwrap_or_default(),
            page: page.page.unwrap_or_default(),
            part: page.part.unwrap_or_default(),
            duration: page.duration.unwrap_or_default(),
        })
        .collect();

    Ok(VideoMeta {
        title: view.title.unwrap_or_default(),
        desc: view.desc.unwrap_or_default(),
        duration: view.duration.unwrap_or_default(),
        videos: view.videos.unwrap_or_default(),
        bgm_name,
        pages,
    })
}

async fn search_songs(keyword: &str) -> Result<Vec<Candidate>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("无法创建歌曲搜索请求客户端：{error}"))?;
    let url = format!(
        "{LYRIC_API_BASE}/music/tencent/search/song?word={}",
        utf8_percent_encode(keyword, NON_ALPHANUMERIC)
    );

    let response = match client.get(&url).send().await {
        Ok(response) => response,
        Err(error) if error.is_timeout() || error.is_connect() || error.is_request() => client
            .get(&url)
            .send()
            .await
            .map_err(|error| format!("歌曲搜索请求失败：{error}"))?,
        Err(error) => return Err(format!("歌曲搜索请求失败：{error}")),
    };
    if !response.status().is_success() {
        return Err(format!("歌曲搜索请求失败：HTTP {}", response.status()));
    }

    let response = response
        .json::<SongSearchResponse>()
        .await
        .map_err(|error| format!("歌曲搜索响应解析失败：{error}"))?;
    Ok(candidates_from_search_response(response))
}

pub async fn match_song(input: MatchInput) -> Result<MatchOutcome, String> {
    if should_skip_auto(&input) {
        return Ok(MatchOutcome {
            confidence: "skip".to_string(),
            used_keyword: String::new(),
            candidates: Vec::new(),
        });
    }

    let mut attempted = 0;
    let mut successful_search = false;
    let mut last_error = None;
    let mut best: Option<(f64, String, Confidence, Vec<ScoredCandidate>)> = None;

    for keyword in extract_keywords(&input).into_iter().take(3) {
        attempted += 1;
        let candidates = match search_songs(&keyword).await {
            Ok(candidates) => {
                successful_search = true;
                candidates
            }
            Err(error) => {
                last_error = Some(format!("关键词“{keyword}”搜索失败：{error}"));
                continue;
            }
        };
        let mut ranked = rank_candidates(&input, &keyword, candidates);
        if ranked.is_empty() {
            continue;
        }

        let confidence = judge_confidence(&input, &ranked);
        if confidence == Confidence::High {
            ranked.truncate(8);
            return Ok(MatchOutcome {
                confidence: "high".to_string(),
                used_keyword: keyword,
                candidates: ranked,
            });
        }

        let top_score = ranked[0].score;
        if best
            .as_ref()
            .is_none_or(|(score, _, _, _)| top_score > *score)
        {
            ranked.truncate(8);
            best = Some((top_score, keyword, confidence, ranked));
        }
    }

    if attempted > 0 && !successful_search {
        return Err(last_error.unwrap_or_else(|| "所有关键词搜索均失败".to_string()));
    }
    if let Some((_, used_keyword, confidence, candidates)) = best {
        return Ok(MatchOutcome {
            confidence: match confidence {
                Confidence::High => "high",
                Confidence::Medium => "medium",
                Confidence::Low => "low",
                Confidence::Skip => "skip",
            }
            .to_string(),
            used_keyword,
            candidates,
        });
    }
    Ok(MatchOutcome {
        confidence: "low".to_string(),
        used_keyword: String::new(),
        candidates: Vec::new(),
    })
}

fn lyrics_from_response(response: LyricApiResponse) -> Lyrics {
    let Some(data) = response.data.filter(|_| response.code == 200) else {
        return no_lyrics();
    };
    let lrc = data.lrc.unwrap_or_default();
    if lrc.trim().is_empty() {
        return no_lyrics();
    }
    let _ = (data.yrc, data.roma);
    Lyrics {
        lrc,
        trans: data.trans.unwrap_or_default(),
        has_lyric: true,
    }
}

fn no_lyrics() -> Lyrics {
    Lyrics {
        lrc: String::new(),
        trans: String::new(),
        has_lyric: false,
    }
}

#[tauri::command]
pub async fn get_lyrics_by_id(song_id: String) -> Result<Lyrics, String> {
    fetch_lyrics_by_id(song_id).await
}

#[tauri::command]
pub async fn search_lyrics_songs(keyword: String) -> Result<Vec<Candidate>, String> {
    if keyword.trim().is_empty() {
        return Ok(Vec::new());
    }
    search_songs(&keyword).await
}

#[tauri::command]
pub async fn clear_lyrics_cache() -> Result<u32, String> {
    let dir = crate::library::library_root()?.join("lyrics");
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(format!("无法读取歌词缓存目录 {}：{error}", dir.display()));
        }
    };
    let mut removed = 0u32;
    for entry in entries {
        let entry = entry.map_err(|error| format!("无法读取歌词缓存目录项：{error}"))?;
        if !entry
            .file_type()
            .map_err(|error| format!("无法读取歌词缓存文件类型：{error}"))?
            .is_file()
        {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".json") || name.ends_with(".json.tmp") {
            fs::remove_file(entry.path())
                .map_err(|error| format!("无法删除歌词缓存文件 {name}：{error}"))?;
            removed = removed.saturating_add(1);
        }
    }
    Ok(removed)
}

fn offsets_path() -> Result<PathBuf, String> {
    Ok(crate::library::library_root()?.join(LYRICS_OFFSETS_FILE))
}

fn offset_key(bvid: &str, cid: i64) -> String {
    format!("{}:{}", bvid.trim(), cid)
}

#[tauri::command]
pub async fn get_lyrics_offset(bvid: String, cid: i64) -> Result<i64, String> {
    let file = crate::library::read_json_or_default::<LyricsOffsetsFile>(&offsets_path()?)?;
    Ok(file
        .offsets
        .get(&offset_key(&bvid, cid))
        .copied()
        .unwrap_or(0))
}

#[tauri::command]
pub async fn set_lyrics_offset(bvid: String, cid: i64, offset_ms: i64) -> Result<(), String> {
    if bvid.trim().is_empty() || cid <= 0 {
        return Ok(());
    }

    let path = offsets_path()?;
    let mut file = crate::library::read_json_or_default::<LyricsOffsetsFile>(&path)?;
    let key = offset_key(&bvid, cid);
    if offset_ms == 0 {
        file.offsets.remove(&key);
    } else {
        file.offsets.insert(key, offset_ms);
    }
    crate::library::write_json_atomic(&path, &file)
}

fn bindings_path() -> Result<PathBuf, String> {
    Ok(crate::library::library_root()?.join(LYRICS_BINDINGS_FILE))
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs().min(i64::MAX as u64) as i64)
}

fn write_binding(bvid: &str, cid: i64, binding: LyricsBinding) -> Result<(), String> {
    if bvid.trim().is_empty() || cid <= 0 {
        return Ok(());
    }
    let path = bindings_path()?;
    let mut file = crate::library::read_json_or_default::<LyricsBindingsFile>(&path)?;
    file.bindings.insert(offset_key(bvid, cid), binding);
    crate::library::write_json_atomic(&path, &file)
}

#[tauri::command]
pub async fn get_lyrics_binding(bvid: String, cid: i64) -> Result<Option<LyricsBinding>, String> {
    if bvid.trim().is_empty() || cid <= 0 {
        return Ok(None);
    }
    let file = crate::library::read_json_or_default::<LyricsBindingsFile>(&bindings_path()?)?;
    Ok(file.bindings.get(&offset_key(&bvid, cid)).cloned())
}

#[tauri::command]
pub async fn set_lyrics_binding(
    bvid: String,
    cid: i64,
    song_id: String,
    song_name: String,
    singer: String,
) -> Result<(), String> {
    write_binding(
        &bvid,
        cid,
        LyricsBinding {
            song_id,
            song_name,
            singer,
            source: "manual".to_string(),
            confidence: 1.0,
            checked_at: unix_now(),
        },
    )
}

#[tauri::command]
pub async fn clear_lyrics_binding(bvid: String, cid: i64) -> Result<(), String> {
    if bvid.trim().is_empty() || cid <= 0 {
        return Ok(());
    }
    let path = bindings_path()?;
    let mut file = crate::library::read_json_or_default::<LyricsBindingsFile>(&path)?;
    if file.bindings.remove(&offset_key(&bvid, cid)).is_none() {
        return Ok(());
    }
    crate::library::write_json_atomic(&path, &file)
}

fn negative_binding_is_fresh(binding: &LyricsBinding, now: i64) -> bool {
    binding.song_id.is_empty()
        && binding.source == "none"
        && now.saturating_sub(binding.checked_at) < NEGATIVE_TTL_SECS
}

fn empty_resolve_outcome(status: &str, offset_ms: i64) -> ResolveOutcome {
    ResolveOutcome {
        status: status.to_string(),
        song_id: String::new(),
        song_name: String::new(),
        singer: String::new(),
        lyrics: None,
        offset_ms,
        used_keyword: String::new(),
        candidates: Vec::new(),
    }
}

pub async fn resolve_lyrics(
    bvid: &str,
    cid: i64,
    force: bool,
    cookie_header: &str,
) -> Result<ResolveOutcome, String> {
    let binding = if force {
        None
    } else {
        get_lyrics_binding(bvid.to_string(), cid).await?
    };
    let offset_ms = get_lyrics_offset(bvid.to_string(), cid).await?;

    if let Some(binding) = binding {
        if !binding.song_id.is_empty() {
            let lyrics = fetch_lyrics_by_id(binding.song_id.clone()).await.ok();
            return Ok(ResolveOutcome {
                status: "bound".to_string(),
                song_id: binding.song_id,
                song_name: binding.song_name,
                singer: binding.singer,
                lyrics,
                offset_ms,
                used_keyword: String::new(),
                candidates: Vec::new(),
            });
        }
        if negative_binding_is_fresh(&binding, unix_now()) {
            return Ok(empty_resolve_outcome("none", offset_ms));
        }
    }

    let meta = fetch_video_meta(bvid, cookie_header).await?;
    let page = meta.pages.iter().find(|page| page.cid == cid);
    let page_part = page.map(|page| page.part.clone());
    let page_duration = page.map_or(meta.duration, |page| page.duration);
    let matched = match_song(MatchInput {
        title: meta.title,
        desc: meta.desc,
        bgm_name: meta.bgm_name,
        videos: meta.videos,
        page_part,
        page_duration,
    })
    .await?;

    match matched.confidence.as_str() {
        "high" => {
            let scored = matched
                .candidates
                .into_iter()
                .next()
                .ok_or_else(|| "高置信匹配缺少候选歌曲".to_string())?;
            let song_id = scored.candidate.song_id;
            let song_name = scored.candidate.name;
            let singer = scored.candidate.singer;
            write_binding(
                bvid,
                cid,
                LyricsBinding {
                    song_id: song_id.clone(),
                    song_name: song_name.clone(),
                    singer: singer.clone(),
                    source: "auto".to_string(),
                    confidence: scored.score,
                    checked_at: unix_now(),
                },
            )?;
            let lyrics = fetch_lyrics_by_id(song_id.clone()).await.ok();
            Ok(ResolveOutcome {
                status: "auto".to_string(),
                song_id,
                song_name,
                singer,
                lyrics,
                offset_ms,
                used_keyword: matched.used_keyword,
                candidates: Vec::new(),
            })
        }
        "medium" => Ok(ResolveOutcome {
            status: "candidates".to_string(),
            song_id: String::new(),
            song_name: String::new(),
            singer: String::new(),
            lyrics: None,
            offset_ms,
            used_keyword: matched.used_keyword,
            candidates: matched.candidates,
        }),
        "low" => {
            write_binding(
                bvid,
                cid,
                LyricsBinding {
                    song_id: String::new(),
                    song_name: String::new(),
                    singer: String::new(),
                    source: "none".to_string(),
                    confidence: 0.0,
                    checked_at: unix_now(),
                },
            )?;
            Ok(empty_resolve_outcome("none", offset_ms))
        }
        "skip" => Ok(empty_resolve_outcome("skip", offset_ms)),
        confidence => Err(format!("未知歌词匹配置信度：{confidence}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn song_id_cache_keys_reject_unsafe_paths() {
        assert!(is_safe_song_id("107192078"));
        for song_id in ["../etc", "a/b", "", "a b"] {
            assert!(!is_safe_song_id(song_id), "{song_id}");
        }
    }

    #[test]
    fn cached_lyrics_json_round_trips() {
        let cached = CachedLyrics {
            version: CACHE_VERSION,
            song_id: "107192078".to_string(),
            lrc: "[00:00.00]歌词".to_string(),
            trans: "[00:00.00]translation".to_string(),
            cached_at: 123456789,
        };
        let json = serde_json::to_string(&cached).unwrap();
        let decoded = serde_json::from_str::<CachedLyrics>(&json).unwrap();
        assert_eq!(decoded.version, cached.version);
        assert_eq!(decoded.song_id, cached.song_id);
        assert_eq!(decoded.lrc, cached.lrc);
        assert_eq!(decoded.trans, cached.trans);
        assert_eq!(decoded.cached_at, cached.cached_at);
    }

    #[test]
    fn video_pages_cache_only_returns_requested_fresh_entries() {
        let page = PageMeta {
            cid: 1,
            page: 1,
            part: "P1".to_owned(),
            duration: 60,
        };
        let file = VideoPagesCacheFile {
            version: VIDEO_PAGES_CACHE_VERSION,
            entries: HashMap::from([
                (
                    "BVfresh".to_owned(),
                    CachedVideoPages {
                        videos: 1,
                        pages: vec![page.clone()],
                        cached_at: 100,
                    },
                ),
                (
                    "BVstale".to_owned(),
                    CachedVideoPages {
                        videos: 1,
                        pages: vec![page],
                        cached_at: 100 - VIDEO_PAGES_TTL_SECS,
                    },
                ),
            ]),
        };
        let entries =
            fresh_video_pages_entries(file, vec!["BVfresh".to_owned(), "BVstale".to_owned()], 100);
        assert_eq!(entries.len(), 1);
        assert!(entries.contains_key("BVfresh"));
    }

    #[test]
    fn missing_lyrics_is_a_successful_empty_result() {
        for json in [
            r#"{"code":404,"message":"not found"}"#,
            r#"{"code":200,"data":{"lrc":"","trans":null}}"#,
        ] {
            let lyrics =
                lyrics_from_response(serde_json::from_str::<LyricApiResponse>(json).unwrap());
            assert!(!lyrics.has_lyric);
            assert!(lyrics.lrc.is_empty());
            assert!(lyrics.trans.is_empty());
        }
    }

    #[test]
    fn lyric_offsets_default_cleanly_and_trim_the_bvid_key() {
        let file = LyricsOffsetsFile::default();
        assert_eq!(file.version, OFFSETS_VERSION);
        assert!(file.offsets.is_empty());
        assert_eq!(offset_key("  BV1xx411c7mD  ", 123), "BV1xx411c7mD:123");
    }

    #[test]
    fn video_meta_extracts_first_bgm_and_pages() {
        let response = serde_json::from_str::<ViewDetailResponse>(
            r#"{
                "code": 0,
                "data": {
                    "View": {
                        "title": "标题",
                        "desc": "简介",
                        "duration": 123,
                        "videos": 1,
                        "pages": [{"cid": 456, "page": 1, "part": "正片", "duration": 123}]
                    },
                    "Tags": [
                        {"tag_type": "bgm", "tag_name": "发现《告白气球》"},
                        {"tag_type": "bgm", "tag_name": "发现《第二首》"}
                    ]
                }
            }"#,
        )
        .unwrap();
        let meta = video_meta_from_response(response).unwrap();
        assert_eq!(meta.bgm_name.as_deref(), Some("告白气球"));
        assert_eq!(meta.pages.len(), 1);
        assert_eq!(meta.pages[0].cid, 456);

        let no_bgm = serde_json::from_str::<ViewDetailResponse>(
            r#"{"code":0,"data":{"View":{},"Tags":[]}}"#,
        )
        .unwrap();
        assert!(video_meta_from_response(no_bgm).unwrap().bgm_name.is_none());
    }

    #[test]
    fn negative_binding_expires_at_the_ttl_boundary() {
        let file = LyricsBindingsFile::default();
        assert_eq!(file.version, BINDINGS_VERSION);

        let binding = LyricsBinding {
            song_id: String::new(),
            song_name: String::new(),
            singer: String::new(),
            source: "none".to_string(),
            confidence: 0.0,
            checked_at: 100,
        };
        assert!(negative_binding_is_fresh(
            &binding,
            100 + NEGATIVE_TTL_SECS - 1
        ));
        assert!(!negative_binding_is_fresh(
            &binding,
            100 + NEGATIVE_TTL_SECS
        ));
    }
}
