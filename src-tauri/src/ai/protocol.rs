use super::{AiConfig, ApiFormat, ChatMessage};

const ANTHROPIC_VERSION: &str = "2023-06-01";

/// 识别“输出被 max tokens 截断”的响应，返回各规范的截断原因。
pub(super) fn output_truncated_reason(
    format: ApiFormat,
    body: &serde_json::Value,
) -> Option<String> {
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
pub(super) fn response_snippet(text: &str) -> String {
    const SNIPPET_MAX_CHARS: usize = 600;
    let snippet: String = text.trim().chars().take(SNIPPET_MAX_CHARS).collect();
    if text.trim().chars().count() > SNIPPET_MAX_CHARS {
        format!("{snippet}…")
    } else {
        snippet
    }
}

pub(super) struct BuiltRequest {
    pub(super) endpoint: String,
    pub(super) headers: Vec<(&'static str, String)>,
    pub(super) body: serde_json::Value,
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

/// Base URL 缺少协议头时补 https://，去掉末尾斜杠后追加所选规范的端点。
fn resolve_endpoint(base_url: &str, endpoint: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    let base = if trimmed.contains("://") {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    format!("{base}/{endpoint}")
}

const OPENAI_CHAT_ENDPOINT: &str = "chat/completions";
const OPENAI_RESPONSES_ENDPOINT: &str = "responses";
const ANTHROPIC_MESSAGES_ENDPOINT: &str = "messages";

/// Base URL 由用户填写服务商地址（如 https://api.openai.com/v1 或
/// https://open.bigmodel.cn/api/v1），端点路径由 resolve_endpoint 按规范拼接。
pub(super) fn build_request(
    config: &AiConfig,
    messages: &[ChatMessage],
    max_tokens: u32,
) -> BuiltRequest {
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

pub(super) fn extract_content(format: ApiFormat, body: &serde_json::Value) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::super::VERSION;
    use super::*;

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
            // OpenAI 官方：路径需填到 /v1
            (
                ApiFormat::OpenAiChatCompletions,
                "https://api.openai.com/v1/",
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
                "https://api.deepseek.com/v1",
                "https://api.deepseek.com/v1/chat/completions",
            ),
            (
                ApiFormat::OpenAiChatCompletions,
                "https://api.moonshot.cn/v1",
                "https://api.moonshot.cn/v1/chat/completions",
            ),
            (
                ApiFormat::OpenAiChatCompletions,
                "https://api.siliconflow.cn/v1",
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
                "http://localhost:11434/v1",
                "http://localhost:11434/v1/chat/completions",
            ),
            // Responses：智谱 /api/v1 与 OpenAI 官方版本路径
            (
                ApiFormat::OpenAiResponses,
                "https://open.bigmodel.cn/api/v1",
                "https://open.bigmodel.cn/api/v1/responses",
            ),
            (
                ApiFormat::OpenAiResponses,
                "https://api.openai.com/v1",
                "https://api.openai.com/v1/responses",
            ),
            // Anthropic：官方 /v1 与智谱兼容网关
            (
                ApiFormat::AnthropicMessages,
                "https://api.anthropic.com/v1",
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
    fn resolve_endpoint_preserves_v1_chat_completions_urls() {
        let cases = [
            (
                "https://api.deepseek.com",
                "https://api.deepseek.com/chat/completions",
            ),
            (
                "https://api.deepseek.com/",
                "https://api.deepseek.com/chat/completions",
            ),
            (
                "https://api.openai.com/v1",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                "http://localhost:11434",
                "http://localhost:11434/chat/completions",
            ),
            (
                "https://example.com/custom/path",
                "https://example.com/custom/path/chat/completions",
            ),
            (
                "api.example.com",
                "https://api.example.com/chat/completions",
            ),
        ];
        for (base, expected) in cases {
            assert_eq!(resolve_endpoint(base, "chat/completions"), expected);
        }
    }
}
