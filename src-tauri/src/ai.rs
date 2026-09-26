use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::library::{
    get_play_history, get_search_history, library_root, list_favorites, list_playlists,
    read_json_or_default, write_json_atomic as write_library_json_atomic, Versioned,
};
use crate::search::{SearchClient, SearchVideo};

const VERSION: u32 = 2;
const LEGACY_VERSION: u32 = 1;
const ANTHROPIC_VERSION: &str = "2023-06-01";
const AI_CONFIG_FILE: &str = "ai-config.json";
const RECOMMENDATIONS_FILE: &str = "recommendations.json";
const RECOMMENDATIONS_VERSION: u32 = 1;
#[cfg(not(debug_assertions))]
const DATA_SUBDIR: &str = "data";
#[cfg(not(debug_assertions))]
const APP_DATA_DIR: &str = "bili-music";
const AI_TIMEOUT_SHORT_SECS: u64 = 15;
const AI_TIMEOUT_LONG_SECS: u64 = 90;
const AI_CONNECT_TIMEOUT_SECS: u64 = 10;
#[cfg(debug_assertions)]
const DEV_DATA_DIR: &str = ".local-data";

/// 用户可选的 AI 接口规范。存储值用完整规范名（kebab-case），
/// 后续 OpenAI / Anthropic 推出新规范时新增枚举值即可。
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
enum ApiFormat {
    #[default]
    #[serde(rename = "openai-chat-completions")]
    OpenAiChatCompletions,
    #[serde(rename = "openai-responses")]
    OpenAiResponses,
    #[serde(rename = "anthropic-messages")]
    AnthropicMessages,
}

impl ApiFormat {
    fn parse(value: &str) -> Result<ApiFormat, String> {
        match value.trim() {
            "openai-chat-completions" => Ok(ApiFormat::OpenAiChatCompletions),
            "openai-responses" => Ok(ApiFormat::OpenAiResponses),
            "anthropic-messages" => Ok(ApiFormat::AnthropicMessages),
            other => Err(format!(
                "不支持的 AI 接口规范：{other}。支持 openai-chat-completions / openai-responses / anthropic-messages。"
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            ApiFormat::OpenAiChatCompletions => "openai-chat-completions",
            ApiFormat::OpenAiResponses => "openai-responses",
            ApiFormat::AnthropicMessages => "anthropic-messages",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct AiConfig {
    version: u32,
    #[serde(default)]
    api_format: ApiFormat,
    base_url: String,
    model: String,
    api_key: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigView {
    pub api_format: String,
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

#[derive(Debug, Serialize)]
struct RecommendationsFile {
    version: u32,
    items: Vec<SearchVideo>,
    generated_at: i64,
}

#[derive(Deserialize)]
struct StoredRecommendationsFile {
    version: u32,
    items: Vec<StoredSearchVideo>,
    generated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSearchVideo {
    bvid: String,
    title: String,
    uploader: String,
    thumbnail_url: String,
    duration_seconds: u64,
    play_count: Option<u64>,
    pubdate: Option<u64>,
}

impl Default for RecommendationsFile {
    fn default() -> Self {
        Self {
            version: RECOMMENDATIONS_VERSION,
            items: Vec::new(),
            generated_at: 0,
        }
    }
}

impl Versioned for RecommendationsFile {
    fn version(&self) -> u32 {
        self.version
    }
}

impl<'de> Deserialize<'de> for RecommendationsFile {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let stored = StoredRecommendationsFile::deserialize(deserializer)?;
        Ok(Self {
            version: stored.version,
            items: stored
                .items
                .into_iter()
                .map(|video| SearchVideo {
                    bvid: video.bvid,
                    title: video.title,
                    uploader: video.uploader,
                    thumbnail_url: video.thumbnail_url,
                    duration_seconds: video.duration_seconds,
                    play_count: video.play_count,
                    pubdate: video.pubdate,
                })
                .collect(),
            generated_at: stored.generated_at,
        })
    }
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            version: VERSION,
            api_format: ApiFormat::default(),
            base_url: String::new(),
            model: String::new(),
            api_key: String::new(),
        }
    }
}

impl AiConfig {
    fn view(&self) -> AiConfigView {
        AiConfigView {
            api_format: self.api_format.as_str().to_owned(),
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            has_key: !self.api_key.is_empty(),
            key_hint: key_hint(&self.api_key),
        }
    }

    fn ensure_supported_version(&self, path: &Path) -> Result<(), String> {
        // v1 是无 api_format 字段的旧配置，读取时默认按 openai-chat-completions 处理，
        // 下次保存时以 v2 落盘；不认识的版本仍然报错且不覆盖。
        if self.version == VERSION || self.version == LEGACY_VERSION {
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
pub fn get_saved_recommendations() -> Result<Vec<SearchVideo>, String> {
    let path = library_root()?.join(RECOMMENDATIONS_FILE);
    Ok(read_saved_recommendations_from_path(&path))
}

pub(crate) fn save_recommendations(items: &[SearchVideo]) -> Result<(), String> {
    let path = library_root()?.join(RECOMMENDATIONS_FILE);
    write_recommendations_to_path(&path, items)
}

#[tauri::command]
pub fn set_ai_config(
    api_format: String,
    base_url: String,
    model: String,
    api_key: String,
) -> Result<AiConfigView, String> {
    let api_format = ApiFormat::parse(&api_format)?;
    let base_url = normalize_required("base_url", &base_url)?;
    let model = normalize_required("model", &model)?;
    let mut config = read_ai_config()?;
    config.api_format = api_format;
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
    api_format: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
) -> Result<AiConnectionTestResult, String> {
    let stored = read_ai_config()?;
    let api_format = match api_format
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => ApiFormat::parse(value)?,
        None => stored.api_format,
    };
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
        api_format,
        base_url,
        model,
        api_key,
    };
    let messages = vec![ChatMessage {
        role: "user",
        content: "ping".to_owned(),
    }];

    match chat_completion_with_config(&config, messages, 512, AI_TIMEOUT_SHORT_SECS).await {
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
    chat_completion_with_config(&config, messages, max_tokens, AI_TIMEOUT_LONG_SECS).await
}

async fn chat_completion_with_config(
    config: &AiConfig,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
    timeout_secs: u64,
) -> Result<String, String> {
    if config.base_url.trim().is_empty()
        || config.model.trim().is_empty()
        || config.api_key.is_empty()
    {
        return Err("AI 配置不完整。".to_owned());
    }

    let built = build_request(config, &messages, max_tokens);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(AI_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|error| {
            format!(
                "无法创建 AI 客户端：{}",
                safe_error(&error.to_string(), &config.api_key)
            )
        })?;
    let mut request = client
        .post(&built.endpoint)
        .header(CONTENT_TYPE, "application/json")
        // 三种规范统一带 Bearer：OpenAI 系标准用法；
        // 智谱等 Anthropic 兼容网关也认 Bearer（不认 x-api-key），官方 Anthropic 则忽略它。
        .header(AUTHORIZATION, format!("Bearer {}", config.api_key));
    for (name, value) in &built.headers {
        request = request.header(*name, value);
    }
    let response = request.json(&built.body).send().await.map_err(|error| {
        ai_request_error(
            error.is_timeout(),
            &error.to_string(),
            "AI 请求失败：",
            &config.api_key,
        )
    })?;

    let status = response.status();
    let body_text = response.text().await.map_err(|error| {
        ai_request_error(
            error.is_timeout(),
            &error.to_string(),
            "响应读取失败：",
            &config.api_key,
        )
    })?;
    if !status.is_success() {
        // 把服务端返回的真实错误体和请求端点打到终端，否则无法定位网关路径/参数问题。
        let snippet = response_snippet(&body_text);
        eprintln!(
            "[ai] {} 请求 {} 返回 HTTP {}：{}",
            config.api_format.as_str(),
            built.endpoint,
            status.as_u16(),
            safe_error(&snippet, &config.api_key)
        );
        return Err(format!("HTTP {}：{}", status.as_u16(), snippet));
    }
    let body: serde_json::Value = serde_json::from_str(&body_text).map_err(|error| {
        let snippet = response_snippet(&body_text);
        eprintln!(
            "[ai] {} 响应不是有效 JSON：{}",
            config.api_format.as_str(),
            safe_error(&snippet, &config.api_key)
        );
        ai_request_error(
            false,
            &error.to_string(),
            "响应不是有效的 JSON：",
            &config.api_key,
        )
    })?;
    match extract_content(config.api_format, &body) {
        Some(content) => Ok(content),
        None => {
            // 按所选规范没提取到文本时，打印端点、模型和原始响应体，定位网关路由/模型/参数问题。
            let snippet = response_snippet(&body_text);
            eprintln!(
                "[ai] {} 请求 {}（model={}）响应缺少 content，原始响应：{}",
                config.api_format.as_str(),
                built.endpoint,
                config.model,
                safe_error(&snippet, &config.api_key)
            );
            if let Some(reason) = output_truncated_reason(config.api_format, &body) {
                return Err(format!(
                    "模型输出被 max tokens 截断（{reason}），推理模型思考占用了全部输出额度；请换非推理模型或重试。"
                ));
            }
            Err(format!(
                "响应缺少 content（model={}，原始响应片段：{}）",
                config.model, snippet
            ))
        }
    }
}

/// 识别“输出被 max tokens 截断”的响应，返回各规范的截断原因。
fn output_truncated_reason(format: ApiFormat, body: &serde_json::Value) -> Option<String> {
    match format {
        ApiFormat::OpenAiChatCompletions => {
            let finish = body
                .get("choices")?
                .get(0)?
                .get("finish_reason")?
                .as_str()?;
            (finish == "length").then(|| format!("finish_reason={finish}"))
        }
        ApiFormat::OpenAiResponses => {
            if body.get("status").and_then(serde_json::Value::as_str) != Some("incomplete") {
                return None;
            }
            let reason = body
                .get("incomplete_details")
                .and_then(|details| details.get("reason"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown");
            Some(format!("status=incomplete, reason={reason}"))
        }
        ApiFormat::AnthropicMessages => {
            let stop = body
                .get("stop_reason")
                .and_then(serde_json::Value::as_str)?;
            (stop == "max_tokens").then(|| format!("stop_reason={stop}"))
        }
    }
}

/// 响应体截断片段：用于终端日志和前端错误提示，按字符截断避免切断 UTF-8。
fn response_snippet(text: &str) -> String {
    const SNIPPET_MAX_CHARS: usize = 600;
    let snippet: String = text.trim().chars().take(SNIPPET_MAX_CHARS).collect();
    if text.trim().chars().count() > SNIPPET_MAX_CHARS {
        format!("{snippet}…")
    } else {
        snippet
    }
}

struct BuiltRequest {
    endpoint: String,
    headers: Vec<(&'static str, String)>,
    body: serde_json::Value,
}

fn split_system_messages(messages: &[ChatMessage]) -> (String, Vec<&ChatMessage>) {
    let mut system_parts = Vec::new();
    let mut rest = Vec::new();
    for message in messages {
        if message.role == "system" {
            system_parts.push(message.content.as_str());
        } else {
            rest.push(message);
        }
    }
    (system_parts.join("\n\n"), rest)
}

/// Base URL 智能拼接：用户可只填服务商域名，也可填到版本段或自定义路径。
/// Base URL 智能拼接：①无 scheme 自动补 https://；②裸域名自动补 /v1；
/// ③路径末段是版本段（v1/v4…）或自定义路径 → 直接追加端点。
/// 注意：程序只会自动补 /v1 这一种；服务商路径不含 /v1 时（如智谱 /api/v1），
/// 用户必须填到版本段，由提示文案说明。
fn resolve_endpoint(base_url: &str, endpoint: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    let base = if trimmed.contains("://") {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    let remainder = base
        .split_once("://")
        .map_or(base.as_str(), |(_, rest)| rest);
    if !remainder.contains('/') {
        return format!("{base}/{DEFAULT_VERSION_SEGMENT}/{endpoint}");
    }
    let last_segment = remainder.rsplit('/').next().unwrap_or("");
    if is_version_segment(last_segment) {
        return format!("{base}/{endpoint}");
    }
    format!("{base}/{endpoint}")
}

fn is_version_segment(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    bytes.len() >= 2 && bytes[0] == b'v' && bytes[1..].iter().all(u8::is_ascii_digit)
}

const OPENAI_CHAT_ENDPOINT: &str = "chat/completions";
const OPENAI_RESPONSES_ENDPOINT: &str = "responses";
const ANTHROPIC_MESSAGES_ENDPOINT: &str = "messages";
const DEFAULT_VERSION_SEGMENT: &str = "v1";

/// Base URL 由用户填写服务商地址（如 https://api.openai.com 或
/// https://open.bigmodel.cn/api/v1），端点路径由 resolve_endpoint 按规范拼接。
fn build_request(config: &AiConfig, messages: &[ChatMessage], max_tokens: u32) -> BuiltRequest {
    match config.api_format {
        ApiFormat::OpenAiChatCompletions => BuiltRequest {
            endpoint: resolve_endpoint(&config.base_url, OPENAI_CHAT_ENDPOINT),
            headers: Vec::new(),
            body: serde_json::json!({
                "model": config.model,
                "messages": messages,
                "max_tokens": max_tokens,
            }),
        },
        ApiFormat::OpenAiResponses => {
            let (instructions, input) = split_system_messages(messages);
            let mut body = serde_json::json!({
                "model": config.model,
                "input": input,
                "max_output_tokens": max_tokens,
            });
            if !instructions.is_empty() {
                body["instructions"] = serde_json::Value::String(instructions);
            }
            BuiltRequest {
                endpoint: resolve_endpoint(&config.base_url, OPENAI_RESPONSES_ENDPOINT),
                headers: Vec::new(),
                body,
            }
        }
        ApiFormat::AnthropicMessages => {
            // Anthropic 规范不允许 system 角色放在 messages 里，必须单独放 system 字段；
            // 官方 Anthropic 用 x-api-key + anthropic-version 鉴权，
            // Bearer 由外层统一追加以兼容智谱等网关。
            let (system, conversation) = split_system_messages(messages);
            let mut body = serde_json::json!({
                "model": config.model,
                "max_tokens": max_tokens,
                "messages": conversation,
            });
            if !system.is_empty() {
                body["system"] = serde_json::Value::String(system);
            }
            BuiltRequest {
                endpoint: resolve_endpoint(&config.base_url, ANTHROPIC_MESSAGES_ENDPOINT),
                headers: vec![
                    ("x-api-key", config.api_key.clone()),
                    ("anthropic-version", ANTHROPIC_VERSION.to_owned()),
                ],
                body,
            }
        }
    }
}

fn extract_content(format: ApiFormat, body: &serde_json::Value) -> Option<String> {
    let content = match format {
        ApiFormat::OpenAiChatCompletions => extract_openai_chat_content(body),
        ApiFormat::OpenAiResponses => extract_openai_responses_content(body),
        ApiFormat::AnthropicMessages => extract_anthropic_content(body),
    };
    let content = content.trim();
    if content.is_empty() {
        None
    } else {
        Some(content.to_owned())
    }
}

fn extract_openai_chat_content(body: &serde_json::Value) -> String {
    let Some(choices) = body.get("choices").and_then(serde_json::Value::as_array) else {
        return String::new();
    };
    // 优先 content；全部为空时回退 reasoning_content（推理模型的思考输出）。
    for choice in choices {
        if let Some(content) = choice
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(serde_json::Value::as_str)
        {
            if !content.trim().is_empty() {
                return content.to_owned();
            }
        }
    }
    for choice in choices {
        if let Some(reasoning) = choice
            .get("message")
            .and_then(|message| message.get("reasoning_content"))
            .and_then(serde_json::Value::as_str)
        {
            if !reasoning.trim().is_empty() {
                return reasoning.to_owned();
            }
        }
    }
    String::new()
}

fn extract_openai_responses_content(body: &serde_json::Value) -> String {
    let Some(output) = body.get("output").and_then(serde_json::Value::as_array) else {
        return String::new();
    };
    let mut parts = Vec::new();
    for item in output {
        if item.get("type").and_then(serde_json::Value::as_str) != Some("message") {
            // reasoning 等其它输出项不参与文本提取。
            continue;
        }
        let Some(blocks) = item.get("content").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for block in blocks {
            if block.get("type").and_then(serde_json::Value::as_str) == Some("output_text") {
                if let Some(text) = block.get("text").and_then(serde_json::Value::as_str) {
                    parts.push(text);
                }
            }
        }
    }
    parts.join("")
}

fn extract_anthropic_content(body: &serde_json::Value) -> String {
    let Some(blocks) = body.get("content").and_then(serde_json::Value::as_array) else {
        return String::new();
    };
    let mut parts = Vec::new();
    for block in blocks {
        if block.get("type").and_then(serde_json::Value::as_str) == Some("text") {
            if let Some(text) = block.get("text").and_then(serde_json::Value::as_str) {
                parts.push(text);
            }
        }
    }
    parts.join("")
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
    let content = chat_completion(messages, 2000).await?;
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
    let content = chat_completion(messages, 2000).await?;
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

fn read_saved_recommendations_from_path(path: &Path) -> Vec<SearchVideo> {
    read_json_or_default::<RecommendationsFile>(path)
        .map(|file| file.items)
        .unwrap_or_default()
}

fn write_recommendations_to_path(path: &Path, items: &[SearchVideo]) -> Result<(), String> {
    #[derive(Serialize)]
    struct RecommendationsFileRef<'a> {
        version: u32,
        items: &'a [SearchVideo],
        generated_at: i64,
    }

    write_library_json_atomic(
        path,
        &RecommendationsFileRef {
            version: RECOMMENDATIONS_VERSION,
            items,
            generated_at: now_unix_seconds(),
        },
    )
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
        Ok(bilibili_music_core::user_data_base()?.join(APP_DATA_DIR))
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

fn ai_request_error(is_timeout: bool, message: &str, context: &str, api_key: &str) -> String {
    if is_timeout {
        "AI 请求超时，模型响应过慢或网络不稳定，请稍后重试或更换模型。".to_owned()
    } else {
        format!("{context}{}", safe_error(message, api_key))
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs().min(i64::MAX as u64) as i64)
}

#[cfg(test)]
mod tests {
    use super::{
        ai_request_error, build_request, chat_completion_with_config, extract_content,
        filter_known_bvids, key_hint, parse_search_intents, read_ai_config_from_path,
        read_saved_recommendations_from_path, resolve_endpoint, write_ai_config,
        write_recommendations_to_path, AiConfig, ApiFormat, ChatMessage, AI_CONFIG_FILE, VERSION,
    };
    use crate::search::SearchVideo;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn serializes_and_deserializes_ai_config() {
        let mut config = AiConfig {
            version: VERSION,
            api_format: ApiFormat::OpenAiChatCompletions,
            base_url: "https://api.example.com/v1".to_owned(),
            model: "test-model".to_owned(),
            api_key: "sk-secret".to_owned(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: AiConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed, config);
        assert!(json.contains("\"api_format\":\"openai-chat-completions\""));

        config.api_format = ApiFormat::AnthropicMessages;
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"api_format\":\"anthropic-messages\""));
    }

    #[test]
    fn legacy_v1_config_defaults_to_openai_chat_completions() {
        let legacy = r#"{
            "version": 1,
            "base_url": "https://api.example.com/v1",
            "model": "test-model",
            "api_key": "sk-secret"
        }"#;
        let parsed: AiConfig = serde_json::from_str(legacy).unwrap();

        assert_eq!(parsed.api_format, ApiFormat::OpenAiChatCompletions);
        let path = unique_temp_path("legacy-v1");
        fs::write(&path, legacy).unwrap();
        let loaded = read_ai_config_from_path(&path);
        let _ = fs::remove_file(&path);

        assert!(loaded.is_ok());
        assert_eq!(loaded.unwrap().api_format, ApiFormat::OpenAiChatCompletions);
    }

    #[test]
    fn unknown_api_format_is_rejected() {
        assert!(ApiFormat::parse("openai").is_err());
        assert!(ApiFormat::parse("anthropic").is_err());
        assert!(ApiFormat::parse("openai-chat").is_err());
        assert_eq!(
            ApiFormat::parse(" openai-responses ").unwrap(),
            ApiFormat::OpenAiResponses
        );
    }

    #[test]
    fn atomic_write_reads_back_ai_config() {
        let path = unique_temp_path("write-read");
        let config = AiConfig {
            version: VERSION,
            api_format: ApiFormat::AnthropicMessages,
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
            api_format: ApiFormat::OpenAiChatCompletions,
            base_url: "https://api.example.com/v1".to_owned(),
            model: "test-model".to_owned(),
            api_key: "sk-secret-1234".to_owned(),
        };
        let view = config.view();
        let json = serde_json::to_string(&view).unwrap();

        assert_eq!(view.api_format, "openai-chat-completions");
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
    fn recommendations_round_trip_and_bad_file_falls_back_to_empty() {
        let path = unique_temp_path("recommendations");
        let items = [SearchVideo {
            bvid: "BV1xx411c7mD".to_owned(),
            title: "Real A".to_owned(),
            uploader: "UP A".to_owned(),
            thumbnail_url: "https://example.com/cover.jpg".to_owned(),
            duration_seconds: 180,
            play_count: Some(100),
            pubdate: Some(1_700_000_000),
        }];

        write_recommendations_to_path(&path, &items).unwrap();
        let saved = read_saved_recommendations_from_path(&path);
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].bvid, items[0].bvid);

        fs::write(&path, "{ not json").unwrap();
        assert!(read_saved_recommendations_from_path(&path).is_empty());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn timeout_errors_are_explained_in_chinese() {
        assert_eq!(
            ai_request_error(true, "error sending request", "AI 请求失败：", "sk-secret"),
            "AI 请求超时，模型响应过慢或网络不稳定，请稍后重试或更换模型。"
        );
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

    fn chat_config(api_format: ApiFormat, base_url: &str) -> AiConfig {
        AiConfig {
            version: VERSION,
            api_format,
            base_url: base_url.to_owned(),
            model: "test-model".to_owned(),
            api_key: "sk-secret".to_owned(),
        }
    }

    fn sample_messages() -> Vec<ChatMessage> {
        vec![
            ChatMessage {
                role: "system",
                content: "你只生成 JSON。".to_owned(),
            },
            ChatMessage {
                role: "user",
                content: "根据口味生成关键词。".to_owned(),
            },
        ]
    }

    #[test]
    fn build_request_openai_chat_completions() {
        let config = chat_config(
            ApiFormat::OpenAiChatCompletions,
            "https://api.example.com/v1/",
        );
        let built = build_request(&config, &sample_messages(), 400);

        // Base URL 末尾斜杠被去掉，只追加端点路径。
        assert_eq!(
            built.endpoint,
            "https://api.example.com/v1/chat/completions"
        );
        assert!(built.headers.is_empty());
        assert_eq!(built.body["model"], "test-model");
        assert_eq!(built.body["max_tokens"], 400);
        assert_eq!(built.body["messages"][0]["role"], "system");
        assert_eq!(built.body["messages"][1]["role"], "user");
        assert!(built.body.get("input").is_none());
    }

    #[test]
    fn build_request_openai_responses() {
        let config = chat_config(ApiFormat::OpenAiResponses, "https://api.example.com/v1");
        let built = build_request(&config, &sample_messages(), 400);

        assert_eq!(built.endpoint, "https://api.example.com/v1/responses");
        assert!(built.headers.is_empty());
        assert_eq!(built.body["model"], "test-model");
        assert_eq!(built.body["max_output_tokens"], 400);
        assert_eq!(built.body["instructions"], "你只生成 JSON。");
        // system 不进 input。
        assert_eq!(built.body["input"][0]["role"], "user");
        assert_eq!(built.body["input"].as_array().unwrap().len(), 1);
        assert!(built.body.get("max_tokens").is_none());
    }

    #[test]
    fn build_request_anthropic_messages() {
        let config = chat_config(
            ApiFormat::AnthropicMessages,
            "https://open.bigmodel.cn/api/anthropic",
        );
        let built = build_request(&config, &sample_messages(), 400);

        assert_eq!(
            built.endpoint,
            "https://open.bigmodel.cn/api/anthropic/messages"
        );
        assert_eq!(built.body["model"], "test-model");
        assert_eq!(built.body["max_tokens"], 400);
        assert_eq!(built.body["system"], "你只生成 JSON。");
        // system 不进 messages。
        assert_eq!(built.body["messages"][0]["role"], "user");
        assert_eq!(built.body["messages"].as_array().unwrap().len(), 1);
        // Anthropic 用 x-api-key + anthropic-version，外层还会统一追加 Bearer 兼容网关。
        assert!(built
            .headers
            .iter()
            .any(|(name, value)| *name == "x-api-key" && value == "sk-secret"));
        assert!(built
            .headers
            .iter()
            .any(|(name, _)| *name == "anthropic-version"));
    }

    #[test]
    fn extract_content_openai_chat_completions() {
        let format = ApiFormat::OpenAiChatCompletions;
        let with_content: serde_json::Value = serde_json::from_str(
            r#"{"choices":[{"message":{"role":"assistant","content":"[{\"keyword\":\"vocaloid\"}]"}}]}"#,
        )
        .unwrap();
        let with_reasoning_only: serde_json::Value = serde_json::from_str(
            r#"{"choices":[{"message":{"role":"assistant","content":"","reasoning_content":"思考中"}}]}"#,
        )
        .unwrap();
        let empty: serde_json::Value = serde_json::from_str(r#"{"choices":[]}"#).unwrap();

        assert_eq!(
            extract_content(format, &with_content).as_deref(),
            Some("[{\"keyword\":\"vocaloid\"}]")
        );
        assert_eq!(
            extract_content(format, &with_reasoning_only).as_deref(),
            Some("思考中")
        );
        assert_eq!(extract_content(format, &empty), None);
    }

    #[test]
    fn extract_content_openai_responses() {
        let format = ApiFormat::OpenAiResponses;
        let body: serde_json::Value = serde_json::from_str(
            r#"{
                "output": [
                    {"type": "reasoning", "summary": []},
                    {"type": "message", "content": [
                        {"type": "output_text", "text": "[\"vocaloid\"]"}
                    ]}
                ]
            }"#,
        )
        .unwrap();
        let no_message: serde_json::Value =
            serde_json::from_str(r#"{"output": [{"type": "reasoning", "summary": []}]}"#).unwrap();

        assert_eq!(
            extract_content(format, &body).as_deref(),
            Some("[\"vocaloid\"]")
        );
        assert_eq!(extract_content(format, &no_message), None);
    }

    #[test]
    fn extract_content_anthropic_messages() {
        let format = ApiFormat::AnthropicMessages;
        let body: serde_json::Value = serde_json::from_str(
            r#"{
                "content": [
                    {"type": "thinking", "thinking": "思考"},
                    {"type": "text", "text": "[{\"keyword\":"},
                    {"type": "text", "text": "\"vocaloid\"}]"}
                ]
            }"#,
        )
        .unwrap();
        let no_text: serde_json::Value = serde_json::from_str(r#"{"content": []}"#).unwrap();

        // 多个 text 块拼接，thinking 块忽略。
        assert_eq!(
            extract_content(format, &body).as_deref(),
            Some("[{\"keyword\":\"vocaloid\"}]")
        );
        assert_eq!(extract_content(format, &no_text), None);
    }

    #[test]
    fn response_snippet_truncates_by_chars() {
        assert_eq!(super::response_snippet("  ok "), "ok");
        let long = "a".repeat(1000);
        let snippet = super::response_snippet(&long);
        assert_eq!(snippet.chars().count(), 601); // 600 + 省略号
        assert!(snippet.ends_with('…'));
        let unicode = "音乐".repeat(500);
        assert!(super::response_snippet(&unicode).starts_with("音乐"));
    }

    #[test]
    fn output_truncated_reason_covers_all_formats() {
        use super::output_truncated_reason;
        let responses: serde_json::Value = serde_json::from_str(
            r#"{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}"#,
        )
        .unwrap();
        let chat: serde_json::Value = serde_json::from_str(
            r#"{"choices":[{"message":{"content":""},"finish_reason":"length"}]}"#,
        )
        .unwrap();
        let anthropic: serde_json::Value =
            serde_json::from_str(r#"{"stop_reason":"max_tokens"}"#).unwrap();
        let complete: serde_json::Value = serde_json::from_str(r#"{}"#).unwrap();

        assert_eq!(
            output_truncated_reason(ApiFormat::OpenAiResponses, &responses).as_deref(),
            Some("status=incomplete, reason=max_output_tokens")
        );
        assert_eq!(
            output_truncated_reason(ApiFormat::OpenAiChatCompletions, &chat).as_deref(),
            Some("finish_reason=length")
        );
        assert_eq!(
            output_truncated_reason(ApiFormat::AnthropicMessages, &anthropic).as_deref(),
            Some("stop_reason=max_tokens")
        );
        assert_eq!(
            output_truncated_reason(ApiFormat::OpenAiResponses, &complete),
            None
        );
    }

    fn endpoint_of(format: ApiFormat) -> &'static str {
        match format {
            ApiFormat::OpenAiChatCompletions => "chat/completions",
            ApiFormat::OpenAiResponses => "responses",
            ApiFormat::AnthropicMessages => "messages",
        }
    }

    #[test]
    fn resolve_endpoint_covers_major_providers() {
        let cases = [
            // OpenAI 官方：只填域名也能拼出 /v1
            (
                ApiFormat::OpenAiChatCompletions,
                "https://api.openai.com",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                ApiFormat::OpenAiChatCompletions,
                "https://api.openai.com/v1",
                "https://api.openai.com/v1/chat/completions",
            ),
            // DeepSeek / 月之暗面 / 硅基流动
            (
                ApiFormat::OpenAiChatCompletions,
                "https://api.deepseek.com",
                "https://api.deepseek.com/v1/chat/completions",
            ),
            (
                ApiFormat::OpenAiChatCompletions,
                "https://api.moonshot.cn/v1",
                "https://api.moonshot.cn/v1/chat/completions",
            ),
            (
                ApiFormat::OpenAiChatCompletions,
                "https://api.siliconflow.cn",
                "https://api.siliconflow.cn/v1/chat/completions",
            ),
            // 智谱：paas/v4 版本段直接追加；无 scheme 自动补 https://
            (
                ApiFormat::OpenAiChatCompletions,
                "https://open.bigmodel.cn/api/paas/v4",
                "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            ),
            (
                ApiFormat::OpenAiChatCompletions,
                "open.bigmodel.cn/api/v1",
                "https://open.bigmodel.cn/api/v1/chat/completions",
            ),
            // Gemini OpenAI 兼容路径（非版本段结尾）直接追加端点
            (
                ApiFormat::OpenAiChatCompletions,
                "https://generativelanguage.googleapis.com/v1beta/openai",
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            ),
            // Ollama 本地
            (
                ApiFormat::OpenAiChatCompletions,
                "http://localhost:11434",
                "http://localhost:11434/v1/chat/completions",
            ),
            // Responses：智谱 /api/v1 与 OpenAI 官方域名
            (
                ApiFormat::OpenAiResponses,
                "https://open.bigmodel.cn/api/v1",
                "https://open.bigmodel.cn/api/v1/responses",
            ),
            (
                ApiFormat::OpenAiResponses,
                "https://api.openai.com",
                "https://api.openai.com/v1/responses",
            ),
            // Anthropic：官方裸域名与智谱兼容网关
            (
                ApiFormat::AnthropicMessages,
                "https://api.anthropic.com",
                "https://api.anthropic.com/v1/messages",
            ),
            (
                ApiFormat::AnthropicMessages,
                "https://open.bigmodel.cn/api/anthropic/v1",
                "https://open.bigmodel.cn/api/anthropic/v1/messages",
            ),
        ];
        for (format, base, expected) in cases {
            assert_eq!(resolve_endpoint(base, endpoint_of(format)), expected);
        }
    }

    #[test]
    fn resolve_endpoint_bare_domain_appends_v1_only() {
        // 裸域名只会自动补 /v1；服务商路径不含 /v1 时必须由用户填到版本段。
        assert_eq!(
            resolve_endpoint("https://open.bigmodel.cn", "chat/completions"),
            "https://open.bigmodel.cn/v1/chat/completions"
        );
        assert_eq!(
            resolve_endpoint("open.bigmodel.cn/api/v1", "responses"),
            "https://open.bigmodel.cn/api/v1/responses"
        );
        assert_eq!(
            resolve_endpoint("https://api.example.com", "chat/completions"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    /// 启动一次性本地 mock 服务器，任意路径都返回固定 JSON。
    fn spawn_mock_server(body: &'static str) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 16384];
                let _ = stream.read(&mut buf);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        format!("http://{addr}")
    }

    #[test]
    fn chat_completion_end_to_end_per_format() {
        let cases = [
            (
                ApiFormat::OpenAiChatCompletions,
                r#"{"choices":[{"message":{"role":"assistant","content":"pong"}}]}"#,
            ),
            (
                ApiFormat::OpenAiResponses,
                r#"{"object":"response","output":[{"type":"reasoning","content":[{"type":"reasoning_text","text":"思考"}]},{"type":"message","content":[{"type":"output_text","text":"pong"}]}]}"#,
            ),
            (
                ApiFormat::AnthropicMessages,
                r#"{"content":[{"type":"thinking","thinking":"思考"},{"type":"text","text":"pong"}]}"#,
            ),
        ];
        for (format, body) in cases {
            let base = spawn_mock_server(body);
            let config = chat_config(format, &base);
            let result = tauri::async_runtime::block_on(chat_completion_with_config(
                &config,
                vec![ChatMessage {
                    role: "user",
                    content: "ping".to_owned(),
                }],
                512,
                10,
            ))
            .unwrap();
            assert_eq!(result, "pong");
        }
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
