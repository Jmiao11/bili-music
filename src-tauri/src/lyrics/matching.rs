use super::SongSearchResponse;
use serde::Serialize;
use std::collections::HashSet;

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

pub(super) fn extract_keywords(input: &MatchInput) -> Vec<String> {
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

pub(super) fn should_skip_auto(input: &MatchInput) -> bool {
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

pub(super) fn rank_candidates(
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

pub(super) fn judge_confidence(input: &MatchInput, ranked: &[ScoredCandidate]) -> Confidence {
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

pub(super) fn candidates_from_search_response(response: SongSearchResponse) -> Vec<Candidate> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
