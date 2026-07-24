use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
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
const NOISE_WORDS: &[&str] = &[
    "4k",
    "60fps",
    "1080p",
    "高清",
    "无损",
    "hi-res",
    "hires",
    "高音质",
    "完整版",
    "官方",
    "mv",
    "live",
    "现场",
    "翻唱",
    "cover",
    "中文cc字幕",
    "字幕",
    "动态歌词",
    "動態歌詞",
    "歌词版",
    "收藏级",
    "珍藏",
    "神级",
    "付费",
    "付费歌曲",
    "超清",
    "母带",
];

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

#[derive(Debug, Serialize)]
pub struct PageMeta {
    pub cid: i64,
    pub page: i64,
    pub part: String,
    pub duration: i64,
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

pub struct MatchInput {
    pub title: String,
    pub desc: String,
    pub bgm_name: Option<String>,
    pub videos: i64,
    pub page_part: Option<String>,
    pub page_duration: i64,
}

#[derive(Serialize)]
pub struct Candidate {
    pub song_id: String,
    pub name: String,
    pub singer: String,
    pub duration: i64,
}

#[derive(Serialize)]
pub struct ScoredCandidate {
    pub candidate: Candidate,
    pub score: f64,
}

#[derive(PartialEq, Debug)]
pub enum Confidence {
    High,
    Medium,
    Low,
    Skip,
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

pub async fn fetch_lyrics_by_id(song_id: String) -> Result<Lyrics, String> {
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

fn normalize(value: &str) -> String {
    value
        .chars()
        .map(to_halfwidth)
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn to_halfwidth(character: char) -> char {
    match character {
        '\u{3000}' => ' ',
        '\u{FF01}'..='\u{FF5E}' => char::from_u32(character as u32 - 0xFEE0).unwrap_or(character),
        _ => character,
    }
}

fn similarity(left: &str, right: &str) -> f64 {
    let left: Vec<_> = normalize(left).chars().collect();
    let right: Vec<_> = normalize(right).chars().collect();
    if left.len() < 2 || right.len() < 2 {
        return if left == right { 1.0 } else { 0.0 };
    }

    let left: HashSet<_> = left.windows(2).map(|pair| (pair[0], pair[1])).collect();
    let right: HashSet<_> = right.windows(2).map(|pair| (pair[0], pair[1])).collect();
    2.0 * left.intersection(&right).count() as f64 / (left.len() + right.len()) as f64
}

fn extract_keywords(input: &MatchInput) -> Vec<String> {
    let mut keywords = Vec::new();
    let mut seen = HashSet::new();

    if input.videos > 1 {
        if let Some(part) = input.page_part.as_deref() {
            let part = clean_keyword(part);
            let normalized_part = normalize(&part);
            if !normalized_part.is_empty() {
                push_keyword(&mut keywords, &mut seen, part.clone());
                if let Some(singer) = extract_title_singer(&input.title) {
                    if !normalized_part.contains(&normalize(&singer)) {
                        push_keyword(&mut keywords, &mut seen, format!("{part} {singer}"));
                    }
                }
            }
        }
        return keywords;
    }

    if let Some(bgm_name) = input.bgm_name.as_deref() {
        push_keyword(&mut keywords, &mut seen, clean_keyword(bgm_name));
    }
    for field in ["歌曲", "歌名", "曲名", "演唱", "原唱", "原曲", "BGM"] {
        for value in extract_field_values(&input.desc, field) {
            push_keyword(&mut keywords, &mut seen, value);
        }
    }
    push_keyword(&mut keywords, &mut seen, clean_keyword(&input.title));
    keywords
}

fn push_keyword(keywords: &mut Vec<String>, seen: &mut HashSet<String>, keyword: String) {
    let key = normalize(&keyword);
    if !key.is_empty() && seen.insert(key) {
        keywords.push(keyword);
    }
}

fn clean_keyword(value: &str) -> String {
    let value = value
        .find('《')
        .and_then(|start| {
            let rest = &value[start + '《'.len_utf8()..];
            rest.find('》').map(|end| &rest[..end])
        })
        .unwrap_or(value);
    let value: String = value.chars().map(to_halfwidth).collect();
    let value = remove_enclosed(&remove_enclosed(&value, '【', '】'), '[', ']');
    let value = remove_noise_words(value);
    strip_leading_sequence(&value).trim().to_string()
}

fn remove_enclosed(value: &str, open: char, close: char) -> String {
    let mut depth = 0;
    value
        .chars()
        .filter(|character| {
            if *character == open {
                depth += 1;
                false
            } else if *character == close && depth > 0 {
                depth -= 1;
                false
            } else {
                depth == 0
            }
        })
        .collect()
}

fn remove_noise_words(mut value: String) -> String {
    loop {
        let lowered = value.to_ascii_lowercase();
        let Some((start, length)) = NOISE_WORDS
            .iter()
            .filter_map(|word| {
                lowered
                    .find(&word.to_ascii_lowercase())
                    .map(|start| (start, word.len()))
            })
            .max_by_key(|(_, length)| *length)
        else {
            return value;
        };
        value.replace_range(start..start + length, "");
    }
}

fn strip_leading_sequence(value: &str) -> &str {
    let value = value.trim_start();
    let digit_bytes = value
        .char_indices()
        .take_while(|(_, character)| character.is_ascii_digit())
        .map(|(index, character)| index + character.len_utf8())
        .last()
        .unwrap_or(0);
    if digit_bytes == 0 {
        return value;
    }

    let rest = value[digit_bytes..].trim_start();
    match rest.chars().next() {
        Some(marker) if matches!(marker, '.' | '、' | '-') => {
            rest[marker.len_utf8()..].trim_start()
        }
        _ => value,
    }
}

fn extract_field_values(value: &str, field: &str) -> Vec<String> {
    let field = normalize(field);
    value
        .split(|character| matches!(character, '\n' | '\r' | ';' | '；'))
        .filter_map(|line| {
            let (colon, marker) = line
                .char_indices()
                .find(|(_, character)| matches!(character, ':' | '：'))?;
            normalize(&line[..colon])
                .ends_with(&field)
                .then(|| clean_keyword(&line[colon + marker.len_utf8()..]))
        })
        .filter(|value| !value.is_empty())
        .collect()
}

fn extract_title_singer(title: &str) -> Option<String> {
    for field in ["演唱", "原唱"] {
        if let Some(singer) = extract_field_values(title, field).into_iter().next() {
            return Some(singer);
        }
    }

    let prefix = title.split_once('《')?.0;
    let singer = clean_keyword(prefix)
        .trim_matches(|character: char| {
            character.is_whitespace() || matches!(character, '-' | '—' | '|' | '/' | ':' | '：')
        })
        .to_string();
    (!singer.is_empty()).then_some(singer)
}

fn should_skip_auto(input: &MatchInput) -> bool {
    const INSTRUMENTAL_WORDS: &[&str] = &[
        "纯音乐",
        "雨声",
        "白噪音",
        "助眠",
        "安眠",
        "轻音乐",
        "instrumental",
        "无人声",
    ];
    const COLLECTION_WORDS: &[&str] = &["合集", "playlist", "歌单", "精选", "串烧"];

    if contains_any(&input.title, INSTRUMENTAL_WORDS)
        || input
            .page_part
            .as_deref()
            .is_some_and(|part| contains_any(part, INSTRUMENTAL_WORDS))
    {
        return true;
    }
    if input.videos > 1 {
        return false;
    }
    (input.page_duration > 600 && timestamp_count(&input.desc) >= 3)
        || contains_any(&input.title, COLLECTION_WORDS)
}

fn contains_any(value: &str, words: &[&str]) -> bool {
    let value = normalize(value);
    words.iter().any(|word| value.contains(&normalize(word)))
}

fn timestamp_count(value: &str) -> usize {
    let bytes = value.as_bytes();
    let mut count = 0;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_digit() && (index == 0 || !bytes[index - 1].is_ascii_digit()) {
            let start = index;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }
            let minute_digits = index - start;
            if (1..=2).contains(&minute_digits)
                && bytes.get(index) == Some(&b':')
                && bytes.get(index + 1).is_some_and(u8::is_ascii_digit)
                && bytes.get(index + 2).is_some_and(u8::is_ascii_digit)
                && bytes
                    .get(index + 3)
                    .is_none_or(|byte| !byte.is_ascii_digit())
            {
                count += 1;
                index += 3;
            }
        } else {
            index += 1;
        }
    }
    count
}

fn score_candidate(input: &MatchInput, keyword: &str, candidate: &Candidate) -> f64 {
    let singer = normalize(&candidate.singer);
    let singer_match = !singer.is_empty()
        && [
            normalize(&input.title),
            normalize(&input.desc),
            normalize(input.page_part.as_deref().unwrap_or_default()),
        ]
        .iter()
        .any(|value| value.contains(&singer));
    let duration_score = if input.page_duration <= 0 || candidate.duration <= 0 {
        0.5
    } else {
        match candidate.duration.abs_diff(input.page_duration) {
            0..=5 => 1.0,
            6..=15 => 0.6,
            16..=30 => 0.3,
            _ => 0.0,
        }
    };
    let bonus = input
        .bgm_name
        .as_deref()
        .is_some_and(|bgm_name| similarity(bgm_name, &candidate.name) >= 0.9);

    (0.55 * similarity(keyword, &candidate.name)
        + 0.25 * if singer_match { 1.0 } else { 0.0 }
        + 0.20 * duration_score
        + if bonus { 0.08 } else { 0.0 })
    .min(1.0)
}

fn rank_candidates(
    input: &MatchInput,
    keyword: &str,
    candidates: Vec<Candidate>,
) -> Vec<ScoredCandidate> {
    let mut ranked: Vec<_> = candidates
        .into_iter()
        .map(|candidate| ScoredCandidate {
            score: score_candidate(input, keyword, &candidate),
            candidate,
        })
        .collect();
    ranked.sort_by(|left, right| right.score.total_cmp(&left.score));
    ranked
}

fn judge_confidence(input: &MatchInput, ranked: &[ScoredCandidate]) -> Confidence {
    if should_skip_auto(input) {
        return Confidence::Skip;
    }
    let Some(first) = ranked.first() else {
        return Confidence::Low;
    };
    let second = ranked.get(1).map_or(0.0, |candidate| candidate.score);
    if first.score >= 0.82 && first.score - second >= 0.12 {
        Confidence::High
    } else if first.score >= 0.55 {
        Confidence::Medium
    } else {
        Confidence::Low
    }
}

fn parse_interval(text: &str) -> i64 {
    let mut total = 0_i64;
    let mut number = 0_i64;
    let mut has_number = false;
    let mut matched_unit = false;
    let mut characters = text.chars().peekable();

    while let Some(character) = characters.next() {
        let character = to_halfwidth(character);
        if let Some(digit) = character.to_digit(10) {
            number = number.saturating_mul(10).saturating_add(i64::from(digit));
            has_number = true;
            continue;
        }

        let multiplier = match character {
            '小' if characters.peek() == Some(&'时') => {
                characters.next();
                Some(3600)
            }
            '分' => Some(60),
            '秒' => Some(1),
            _ => None,
        };
        if let Some(multiplier) = multiplier {
            if has_number {
                total = total.saturating_add(number.saturating_mul(multiplier));
                matched_unit = true;
            }
            number = 0;
            has_number = false;
        }
    }

    if matched_unit {
        total
    } else {
        0
    }
}

fn candidates_from_search_response(response: SongSearchResponse) -> Vec<Candidate> {
    if response.code != Some(200) {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for mut item in response.data.unwrap_or_default() {
        let grouped = item.grp.take().unwrap_or_default();
        for item in std::iter::once(item).chain(grouped) {
            let Some(id) = item.id.filter(|id| *id != 0) else {
                continue;
            };
            let Some(name) = item.song.filter(|name| !name.trim().is_empty()) else {
                continue;
            };
            let song_id = id.to_string();
            if !seen.insert(song_id.clone()) {
                continue;
            }
            candidates.push(Candidate {
                song_id,
                name,
                singer: item.singer.unwrap_or_default(),
                duration: parse_interval(item.interval.as_deref().unwrap_or_default()),
            });
            if candidates.len() == 20 {
                return candidates;
            }
        }
    }
    candidates
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

    fn match_input() -> MatchInput {
        MatchInput {
            title: "周杰伦《告白气球》".to_string(),
            desc: String::new(),
            bgm_name: None,
            videos: 1,
            page_part: None,
            page_duration: 120,
        }
    }

    fn scored(score: f64) -> ScoredCandidate {
        ScoredCandidate {
            candidate: Candidate {
                song_id: score.to_string(),
                name: String::new(),
                singer: String::new(),
                duration: 0,
            },
            score,
        }
    }

    #[test]
    fn normalization_and_bigram_similarity_ignore_width_and_punctuation() {
        assert_eq!(similarity("告白气球", "告白气球"), 1.0);
        assert!(similarity("告白气球", "晴天") < 0.01);
        assert_eq!(normalize("ＡＢＣ《１２３》"), normalize("abc-123"));
        assert_eq!(similarity("ＡＢＣ《１２３》", "abc-123"), 1.0);
    }

    #[test]
    fn title_keyword_prefers_book_title_and_extracts_desc_fields() {
        let mut input = match_input();
        input.title = "【4K60FPS】周杰伦《告白气球》".to_string();
        input.desc = "歌名：稻香".to_string();
        let keywords = extract_keywords(&input);
        assert!(keywords.iter().any(|keyword| keyword == "告白气球"));
        assert!(keywords.iter().any(|keyword| keyword == "稻香"));
    }

    #[test]
    fn part_keyword_removes_leading_sequence() {
        let mut input = match_input();
        input.videos = 9;
        input.page_part = Some("001.周杰伦-晴天".to_string());
        let keywords = extract_keywords(&input);
        assert!(keywords
            .first()
            .is_some_and(|keyword| keyword.contains("晴天")));
    }

    #[test]
    fn multipart_keyword_starts_with_part_and_does_not_promote_bgm() {
        let mut input = match_input();
        input.videos = 9;
        input.page_part = Some("001.晴天".to_string());
        input.bgm_name = Some("错误歌名".to_string());
        let keywords = extract_keywords(&input);
        assert_eq!(keywords.first().map(String::as_str), Some("晴天"));
        assert!(!keywords.iter().any(|keyword| keyword == "错误歌名"));
    }

    #[test]
    fn auto_skip_handles_instrumentals_long_single_parts_and_real_multipart() {
        let mut input = match_input();
        input.title = "纯音乐助眠".to_string();
        assert!(should_skip_auto(&input));

        input.title = "九首歌曲合集".to_string();
        input.videos = 9;
        assert!(!should_skip_auto(&input));

        input.title = "长视频".to_string();
        input.videos = 1;
        input.page_duration = 1698;
        input.desc = "00:00 第一首\n03:15 第二首\n07:42 第三首".to_string();
        assert!(should_skip_auto(&input));
    }

    #[test]
    fn confidence_judges_high_medium_low_and_skip() {
        let input = match_input();
        assert_eq!(
            judge_confidence(&input, &[scored(0.90), scored(0.70)]),
            Confidence::High
        );
        assert_eq!(
            judge_confidence(&input, &[scored(0.70), scored(0.65)]),
            Confidence::Medium
        );
        assert_eq!(judge_confidence(&input, &[scored(0.40)]), Confidence::Low);

        let mut skipped = match_input();
        skipped.title = "无人声纯音乐".to_string();
        assert_eq!(judge_confidence(&skipped, &[]), Confidence::Skip);
    }

    #[test]
    fn candidate_scoring_and_ranking_apply_all_signals() {
        let mut input = match_input();
        input.bgm_name = Some("告白气球".to_string());
        let ranked = rank_candidates(
            &input,
            "告白气球",
            vec![
                Candidate {
                    song_id: "wrong".to_string(),
                    name: "晴天".to_string(),
                    singer: "其他歌手".to_string(),
                    duration: 200,
                },
                Candidate {
                    song_id: "best".to_string(),
                    name: "告白气球".to_string(),
                    singer: "周杰伦".to_string(),
                    duration: 120,
                },
            ],
        );
        assert_eq!(ranked[0].candidate.song_id, "best");
        assert_eq!(ranked[0].score, 1.0);
        assert!(ranked[0].score > ranked[1].score);
    }

    #[test]
    fn parses_chinese_interval_text() {
        assert_eq!(parse_interval("3分35秒"), 215);
        assert_eq!(parse_interval("45秒"), 45);
        assert_eq!(parse_interval("1小时2分3秒"), 3723);
        assert_eq!(parse_interval(""), 0);
        assert_eq!(parse_interval("abc"), 0);
    }

    #[test]
    fn flattens_one_grp_level_and_deduplicates_song_ids() {
        let response = serde_json::from_str::<SongSearchResponse>(
            r#"{
                "code": 200,
                "data": [
                    {
                        "id": 1,
                        "song": "告白气球",
                        "singer": "周杰伦",
                        "interval": "3分35秒",
                        "grp": [
                            {
                                "id": 2,
                                "song": "告白气球 Live",
                                "singer": "周杰伦",
                                "interval": "4分",
                                "grp": [
                                    {"id": 3, "song": "不应递归摊平", "interval": "1分"}
                                ]
                            },
                            {"id": 1, "song": "重复版本", "interval": "45秒"}
                        ]
                    },
                    {"id": 2, "song": "再次重复", "interval": "45秒"},
                    {"id": 0, "song": "无效 ID", "interval": "45秒"},
                    {"id": 4, "song": "", "interval": "45秒"}
                ]
            }"#,
        )
        .unwrap();
        let candidates = candidates_from_search_response(response);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].song_id, "1");
        assert_eq!(candidates[0].duration, 215);
        assert_eq!(candidates[1].song_id, "2");
        assert_eq!(candidates[1].duration, 240);
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
