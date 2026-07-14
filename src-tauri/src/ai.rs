use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::library::{get_play_history, get_search_history, list_favorites, list_playlists};
use crate::search::{SearchClient, SearchVideo};

const VERSION: u32 = 1;
const AI_CONFIG_FILE: &str = "ai-config.json";
const DATA_SUBDIR: &str = "data";
const APP_DATA_DIR: &str = "bili-music";
#[cfg(debug_assertions)]
const DEV_DATA_DIR: &str = ".local-data";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct AiConfig {
    version: u32,
    base_url: String,
    model: String,
    api_key: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigView {
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
    pub key_hint: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: Option<ChatMessageResponse>,
}

#[derive(Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Debug, Deserialize)]
struct SearchIntent {
    #[serde(default)]
    keyword: String,
    reason: Option<String>,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            version: VERSION,
            base_url: String::new(),
            model: String::new(),
            api_key: String::new(),
        }
    }
}

impl AiConfig {
    fn view(&self) -> AiConfigView {
        AiConfigView {
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            has_key: !self.api_key.is_empty(),
            key_hint: key_hint(&self.api_key),
        }
    }

    fn ensure_supported_version(&self, path: &Path) -> Result<(), String> {
        if self.version == VERSION {
            Ok(())
        } else {
            Err(format!(
                "{} 的 AI 配置版本 {} 暂不支持。",
                path.display(),
                self.version
            ))
        }
    }
}

#[tauri::command]
pub fn get_ai_config() -> Result<AiConfigView, String> {
    Ok(read_ai_config()?.view())
}

#[tauri::command]
pub fn set_ai_config(
    base_url: String,
    model: String,
    api_key: String,
) -> Result<AiConfigView, String> {
    let base_url = normalize_required("base_url", &base_url)?;
    let model = normalize_required("model", &model)?;
    let mut config = read_ai_config()?;
    config.base_url = base_url;
    config.model = model;
    let api_key = api_key.trim();
    if !api_key.is_empty() {
        config.api_key = api_key.to_owned();
    }
    write_ai_config(&ai_config_path()?, &config)?;
    Ok(config.view())
}

#[tauri::command]
pub async fn test_ai_connection(
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
) -> Result<AiConnectionTestResult, String> {
    let stored = read_ai_config()?;
    let api_key = api_key.unwrap_or_default().trim().to_owned();
    let api_key = if api_key.is_empty() {
        if stored.api_key.is_empty() {
            return Ok(AiConnectionTestResult {
                ok: false,
                message: "请先填写 API key。".to_owned(),
            });
        }
        stored.api_key.clone()
    } else {
        api_key
    };
    let base_url = non_empty_or_stored(base_url, &stored.base_url);
    let model = non_empty_or_stored(model, &stored.model);

    if base_url.is_empty() || model.is_empty() {
        return Ok(AiConnectionTestResult {
            ok: false,
            message: "AI 配置不完整。".to_owned(),
        });
    }

    let config = AiConfig {
        version: VERSION,
        base_url,
        model,
        api_key,
    };
    let messages = vec![ChatMessage {
        role: "user",
        content: "ping".to_owned(),
    }];

    match chat_completion_with_config(&config, messages, 16).await {
        Ok(_) => Ok(AiConnectionTestResult {
            ok: true,
            message: "连接成功。".to_owned(),
        }),
        Err(error) => Ok(AiConnectionTestResult {
            ok: false,
            message: error,
        }),
    }
}

pub async fn generate_recommendations(
    search: &SearchClient,
    user_hint: Option<String>,
) -> Result<Vec<SearchVideo>, String> {
    let mut profile = build_taste_profile();
    if let Some(hint) = user_hint {
        let hint = hint.trim();
        if !hint.is_empty() {
            if !profile.is_empty() {
                profile.push('\n');
            }
            profile.push_str(&format!(
                "【本次想听】{hint}（请优先按这个方向生成检索关键词）"
            ));
        }
    }
    if profile.is_empty() {
        return Ok(Vec::new());
    }

    let intents = match generate_search_intents(&profile).await {
        Ok(intents) => intents,
        Err(error) => return Err(error),
    };
    if intents.is_empty() {
        return Ok(Vec::new());
    }

    let mut candidates_by_bvid = HashMap::new();
    for intent in intents {
        if candidates_by_bvid.len() >= 30 {
            break;
        }
        let Ok(videos) = search.search_videos(&intent.keyword).await else {
            continue;
        };
        for video in videos {
            if candidates_by_bvid.len() >= 30 {
                break;
            }
            candidates_by_bvid
                .entry(video.bvid.clone())
                .or_insert(video);
        }
    }
    if candidates_by_bvid.is_empty() {
        return Ok(Vec::new());
    }

    let mut baseline: Vec<SearchVideo> = candidates_by_bvid.into_values().collect();
    baseline.sort_by(|left, right| {
        right
            .play_count
            .unwrap_or(0)
            .cmp(&left.play_count.unwrap_or(0))
            .then_with(|| left.title.cmp(&right.title))
    });

    let ordered_bvids = match rerank_candidates(&profile, &baseline).await {
        Ok(bvids) => filter_known_bvids(bvids, baseline.iter().map(|video| video.bvid.as_str())),
        Err(_) => Vec::new(),
    };
    if ordered_bvids.is_empty() {
        return Ok(baseline);
    }

    Ok(order_videos_by_bvids(baseline, &ordered_bvids))
}

fn read_ai_config() -> Result<AiConfig, String> {
    read_ai_config_from_path(&ai_config_path()?)
}

async fn chat_completion(messages: Vec<ChatMessage>, max_tokens: u32) -> Result<String, String> {
    let config = read_ai_config()?;
    chat_completion_with_config(&config, messages, max_tokens).await
}

async fn chat_completion_with_config(
    config: &AiConfig,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
) -> Result<String, String> {
    if config.base_url.trim().is_empty()
        || config.model.trim().is_empty()
        || config.api_key.is_empty()
    {
        return Err("AI 配置不完整。".to_owned());
    }

    let endpoint = format!(
        "{}/chat/completions",
        config.base_url.trim().trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| {
            format!(
                "无法创建 AI 客户端：{}",
                safe_error(&error.to_string(), &config.api_key)
            )
        })?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", config.api_key))
        .header(CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({
            "model": config.model,
            "messages": messages,
            "max_tokens": max_tokens
        }))
        .send()
        .await
        .map_err(|error| {
            format!(
                "AI 请求失败：{}",
                safe_error(&error.to_string(), &config.api_key)
            )
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    let body = response
        .json::<ChatCompletionResponse>()
        .await
        .map_err(|error| {
            format!(
                "响应不是有效的 chat completion：{}",
                safe_error(&error.to_string(), &config.api_key)
            )
        })?;
    body.choices
        .into_iter()
        .find_map(|choice| {
            choice.message.and_then(|message| {
                message
                    .content
                    .filter(|content| !content.trim().is_empty())
                    .or(message.reasoning_content)
            })
        })
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "响应缺少 content。".to_owned())
}

fn build_taste_profile() -> String {
    let mut lines = Vec::new();
    let mut history = get_search_history().unwrap_or_default();
    history.sort_by(|left, right| right.count.cmp(&left.count));
    let history: Vec<String> = history
        .into_iter()
        .take(8)
        .map(|item| format!("{} x{}", item.keyword, item.count))
        .collect();
    if !history.is_empty() {
        lines.push(format!("搜索偏好: {}", history.join(", ")));
    }

    let favorites: Vec<String> = list_favorites()
        .unwrap_or_default()
        .into_iter()
        .take(12)
        .map(|track| format!("{} - {}", track.title, track.uploader))
        .collect();
    if !favorites.is_empty() {
        lines.push(format!("收藏歌曲: {}", favorites.join(" | ")));
    }

    let mut seen_playlist_bvids = HashSet::new();
    let playlist_tracks: Vec<String> = list_playlists()
        .unwrap_or_default()
        .into_iter()
        .flat_map(|playlist| playlist.items)
        .filter(|track| seen_playlist_bvids.insert(track.bvid.to_lowercase()))
        .take(12)
        .map(|track| format!("{} - {}", track.title, track.uploader))
        .collect();
    if !playlist_tracks.is_empty() {
        lines.push(format!("歌单收藏: {}", playlist_tracks.join(" | ")));
    }

    let mut play_history = get_play_history().unwrap_or_default();
    play_history.sort_by(|left, right| right.count.cmp(&left.count));
    let play_history: Vec<String> = play_history
        .into_iter()
        .take(10)
        .map(|track| format!("{} - {} x{}", track.title, track.uploader, track.count))
        .collect();
    if !play_history.is_empty() {
        lines.push(format!("常听: {}", play_history.join(" | ")));
    }
    lines.join("\n")
}

async fn generate_search_intents(profile: &str) -> Result<Vec<SearchIntent>, String> {
    let messages = vec![
        ChatMessage {
            role: "system",
            content: "你只生成 B 站音乐搜索关键词意图。禁止输出 bvid，禁止把具体歌名当最终推荐，禁止解释。只输出 JSON 数组，最多 5 项，每项形如 {\"keyword\":\"...\",\"reason\":\"...\"}。".to_owned(),
        },
        ChatMessage {
            role: "user",
            content: format!("根据以下用户口味生成检索关键词意图，不要推荐具体视频。\n{profile}"),
        },
    ];
    let content = chat_completion(messages, 400).await?;
    Ok(parse_search_intents(&content).into_iter().take(5).collect())
}

async fn rerank_candidates(
    profile: &str,
    candidates: &[SearchVideo],
) -> Result<Vec<String>, String> {
    let candidate_text = candidates
        .iter()
        .take(30)
        .map(|video| {
            format!(
                "{} | {} | {} | {}",
                video.bvid,
                video.title,
                video.uploader,
                video.play_count.unwrap_or(0)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let messages = vec![
        ChatMessage {
            role: "system",
            content: "你只能重排用户提供的真实候选。只输出 JSON 字符串数组，数组元素必须仅来自候选 bvid，不得新增、编造或解释。".to_owned(),
        },
        ChatMessage {
            role: "user",
            content: format!("用户口味:\n{profile}\n\n真实候选(bvid | title | uploader | playCount):\n{candidate_text}"),
        },
    ];
    let content = chat_completion(messages, 400).await?;
    Ok(parse_bvid_list(&content))
}

fn parse_search_intents(input: &str) -> Vec<SearchIntent> {
    let Some(json) = extract_json_array(input) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<SearchIntent>>(&json)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|intent| {
            let keyword = intent.keyword.trim().to_owned();
            if keyword.is_empty() || keyword.starts_with("BV") {
                None
            } else {
                Some(SearchIntent {
                    keyword,
                    reason: intent.reason,
                })
            }
        })
        .collect()
}

fn parse_bvid_list(input: &str) -> Vec<String> {
    let Some(json) = extract_json_array(input) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&json).unwrap_or_default()
}

fn extract_json_array(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let without_fence = if let Some(fence_start) = trimmed.find("```") {
        let after_start = &trimmed[fence_start + 3..];
        let after_lang = after_start
            .find('\n')
            .map(|index| &after_start[index + 1..])
            .unwrap_or(after_start);
        after_lang
            .find("```")
            .map(|index| &after_lang[..index])
            .unwrap_or(after_lang)
            .trim()
    } else {
        trimmed
    };
    let start = without_fence.find('[')?;
    let end = without_fence.rfind(']')?;
    if end < start {
        return None;
    }
    Some(without_fence[start..=end].to_owned())
}

fn filter_known_bvids<'a>(
    bvids: Vec<String>,
    known_bvids: impl Iterator<Item = &'a str>,
) -> Vec<String> {
    let known: HashSet<String> = known_bvids.map(str::to_owned).collect();
    let mut seen = HashSet::new();
    bvids
        .into_iter()
        .filter(|bvid| known.contains(bvid) && seen.insert(bvid.clone()))
        .collect()
}

fn order_videos_by_bvids(videos: Vec<SearchVideo>, ordered_bvids: &[String]) -> Vec<SearchVideo> {
    let mut by_bvid: HashMap<String, SearchVideo> = videos
        .into_iter()
        .map(|video| (video.bvid.clone(), video))
        .collect();
    let mut ordered = Vec::new();
    for bvid in ordered_bvids {
        if let Some(video) = by_bvid.remove(bvid) {
            ordered.push(video);
        }
    }
    ordered.extend(by_bvid.into_values());
    ordered
}

fn read_ai_config_from_path(path: &Path) -> Result<AiConfig, String> {
    if !path.exists() {
        return Ok(AiConfig::default());
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("无法读取 AI 配置 {}：{error}", path.display()))?;
    let parsed: AiConfig = serde_json::from_str(&contents)
        .map_err(|error| format!("{} 格式损坏：{error}", path.display()))?;
    parsed.ensure_supported_version(path)?;
    Ok(parsed)
}

fn write_ai_config(path: &Path, config: &AiConfig) -> Result<(), String> {
    write_json_atomic(path, config)
}

fn write_json_atomic<T: Serialize>(target: &Path, value: &T) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("无法确定 {} 的父目录。", target.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建 AI 配置目录 {}：{error}", parent.display()))?;

    let tmp = target.with_extension(format!("json.tmp-{}-{}", std::process::id(), now_millis()));
    let backup = target.with_extension(format!("json.bak-{}-{}", std::process::id(), now_millis()));
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("AI 配置序列化失败：{error}"))?;

    {
        let mut file =
            File::create(&tmp).map_err(|error| format!("无法写入 {}：{error}", tmp.display()))?;
        file.write_all(json.as_bytes())
            .map_err(|error| format!("无法写入 {}：{error}", tmp.display()))?;
        file.write_all(b"\n")
            .map_err(|error| format!("无法写入 {}：{error}", tmp.display()))?;
        file.sync_all()
            .map_err(|error| format!("无法同步 {}：{error}", tmp.display()))?;
    }

    if target.exists() {
        fs::rename(target, &backup).map_err(|error| {
            let _ = fs::remove_file(&tmp);
            format!(
                "无法备份旧 AI 配置 {} 到 {}：{error}",
                target.display(),
                backup.display()
            )
        })?;
    }

    if let Err(error) = fs::rename(&tmp, target) {
        if backup.exists() {
            let _ = fs::rename(&backup, target);
        }
        let _ = fs::remove_file(&tmp);
        return Err(format!("无法保存 AI 配置 {}：{error}", target.display()));
    }

    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn ai_config_path() -> Result<PathBuf, String> {
    let target = data_root()?.join(AI_CONFIG_FILE);
    migrate_legacy_ai_config(&target)?;
    Ok(target)
}

fn data_root() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法从 CARGO_MANIFEST_DIR 定位项目根目录。".to_owned())?;
        return Ok(project_root.join(DEV_DATA_DIR));
    }

    #[cfg(not(debug_assertions))]
    {
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(Path::to_path_buf))
            })
            .ok_or_else(|| "无法定位用户数据目录。".to_owned())?;
        Ok(base.join(APP_DATA_DIR))
    }
}

fn migrate_legacy_ai_config(target: &Path) -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    {
        if target.exists() {
            return Ok(());
        }
        let exe =
            std::env::current_exe().map_err(|error| format!("无法定位当前 exe 路径：{error}"))?;
        let exe_parent = exe
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法定位 exe 所在目录。".to_owned())?;
        let legacy_data_dir = exe_parent.join(DATA_SUBDIR);
        let legacy = [
            legacy_data_dir.join(AI_CONFIG_FILE),
            exe_parent.join(AI_CONFIG_FILE),
        ]
        .into_iter()
        .find(|path| path.exists());
        let Some(legacy) = legacy else {
            return Ok(());
        };
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建 AI 配置目录 {}：{error}", parent.display()))?;
        }
        fs::rename(&legacy, target).map_err(|error| {
            format!(
                "无法迁移旧 AI 配置 {} 到 {}：{error}",
                legacy.display(),
                target.display()
            )
        })?;
        if legacy_data_dir.exists()
            && legacy_data_dir
                .read_dir()
                .map_err(|error| {
                    format!(
                        "无法读取旧 AI 配置目录 {}：{error}",
                        legacy_data_dir.display()
                    )
                })?
                .next()
                .is_none()
        {
            fs::remove_dir(&legacy_data_dir).map_err(|error| {
                format!(
                    "无法删除空旧 AI 配置目录 {}：{error}",
                    legacy_data_dir.display()
                )
            })?;
        }
    }
    let _ = target;
    Ok(())
}

fn normalize_required(name: &str, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{name} 不能为空。"))
    } else {
        Ok(value.to_owned())
    }
}

fn non_empty_or_stored(value: Option<String>, stored: &str) -> String {
    let value = value.unwrap_or_default().trim().to_owned();
    if value.is_empty() {
        stored.trim().to_owned()
    } else {
        value
    }
}

fn key_hint(api_key: &str) -> Option<String> {
    if api_key.is_empty() {
        return None;
    }
    let mut tail: Vec<char> = api_key.chars().rev().take(4).collect();
    tail.reverse();
    Some(format!("••••{}", tail.into_iter().collect::<String>()))
}

fn safe_error(message: &str, api_key: &str) -> String {
    if api_key.is_empty() {
        return message.to_owned();
    }
    message.replace(api_key, "[redacted]")
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::{
        filter_known_bvids, key_hint, parse_search_intents, read_ai_config_from_path,
        write_ai_config, AiConfig, AI_CONFIG_FILE, VERSION,
    };
    use crate::search::SearchVideo;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn serializes_and_deserializes_ai_config() {
        let config = AiConfig {
            version: VERSION,
            base_url: "https://api.example.com/v1".to_owned(),
            model: "test-model".to_owned(),
            api_key: "sk-secret".to_owned(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: AiConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed, config);
    }

    #[test]
    fn atomic_write_reads_back_ai_config() {
        let path = unique_temp_path("write-read");
        let config = AiConfig {
            version: VERSION,
            base_url: "https://api.example.com/v1".to_owned(),
            model: "test-model".to_owned(),
            api_key: "sk-secret".to_owned(),
        };

        write_ai_config(&path, &config).unwrap();
        let parsed = read_ai_config_from_path(&path).unwrap();
        let _ = fs::remove_file(&path);

        assert_eq!(parsed, config);
    }

    #[test]
    fn config_view_never_contains_plain_api_key() {
        let config = AiConfig {
            version: VERSION,
            base_url: "https://api.example.com/v1".to_owned(),
            model: "test-model".to_owned(),
            api_key: "sk-secret-1234".to_owned(),
        };
        let view = config.view();
        let json = serde_json::to_string(&view).unwrap();

        assert!(view.has_key);
        assert_eq!(key_hint(&config.api_key).as_deref(), Some("••••1234"));
        assert!(!json.contains(&config.api_key));
        assert!(json.contains("1234"));
    }

    #[test]
    fn bad_ai_config_file_returns_error_without_overwriting() {
        let path = unique_temp_path("bad-file");
        fs::write(&path, "{ not json").unwrap();

        let result = read_ai_config_from_path(&path);
        let contents = fs::read_to_string(&path).unwrap();
        let _ = fs::remove_file(&path);

        assert!(result.is_err());
        assert_eq!(contents, "{ not json");
    }

    #[test]
    fn recommendation_json_parsing_is_defensive() {
        let fenced = "```json\n[{\"keyword\":\"vocaloid\",\"reason\":\"常搜\"}]\n```";
        let missing = "[{\"reason\":\"missing keyword\"}]";
        let garbage = "not json at all";

        assert_eq!(parse_search_intents(fenced).len(), 1);
        assert!(parse_search_intents(missing).is_empty());
        assert!(parse_search_intents(garbage).is_empty());
    }

    #[test]
    fn rerank_bvid_validation_drops_unknown_ids() {
        let candidates = [
            SearchVideo {
                bvid: "BV1xx411c7mD".to_owned(),
                title: "Real A".to_owned(),
                uploader: "UP A".to_owned(),
                thumbnail_url: String::new(),
                duration_seconds: 180,
                play_count: Some(100),
                pubdate: None,
            },
            SearchVideo {
                bvid: "BV1yy411c7mD".to_owned(),
                title: "Real B".to_owned(),
                uploader: "UP B".to_owned(),
                thumbnail_url: String::new(),
                duration_seconds: 180,
                play_count: Some(50),
                pubdate: None,
            },
        ];
        let ordered = filter_known_bvids(
            vec![
                "BV_FAKE_0000".to_owned(),
                "BV1yy411c7mD".to_owned(),
                "BV1yy411c7mD".to_owned(),
                "BV1xx411c7mD".to_owned(),
            ],
            candidates.iter().map(|video| video.bvid.as_str()),
        );

        assert_eq!(ordered, vec!["BV1yy411c7mD", "BV1xx411c7mD"]);
    }

    fn unique_temp_path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "bilibili-music-{label}-{}-{nanos}-{AI_CONFIG_FILE}",
            std::process::id()
        ))
    }
}
