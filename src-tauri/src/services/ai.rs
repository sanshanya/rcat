// src-tauri/src/services/ai.rs
//! AI Service module for OpenAI-compatible API integration.
//!
//! Notes:
//! - We use `async-openai` for its HTTP client/backoff/stream handling.
//! - For OpenAI-compatible vendors (DeepSeek/OpenRouter/etc.) that include extra
//!   fields like `reasoning_content` in streaming deltas, we use async-openai's
//!   `byot` ("bring your own types") methods to deserialize those fields.

use async_openai::{config::OpenAIConfig, traits::RequestOptionsBuilder, Client};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::Emitter;

/// Event name for streaming chat chunks
pub const EVT_CHAT_STREAM: &str = "chat-stream";
/// Event name for stream completion
pub const EVT_CHAT_DONE: &str = "chat-done";
/// Event name for stream error
pub const EVT_CHAT_ERROR: &str = "chat-error";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    OpenAI,
    DeepSeek,
    Compatible,
}

/// AI configuration for OpenAI-compatible endpoints
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub provider: AiProvider,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: AiProvider::OpenAI,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
        }
    }
}

fn infer_provider(base_url: &str) -> AiProvider {
    let base = base_url.trim().to_ascii_lowercase();
    if base.contains("api.deepseek.com") {
        return AiProvider::DeepSeek;
    }
    if base.contains("api.openai.com") {
        return AiProvider::OpenAI;
    }
    AiProvider::Compatible
}

fn normalize_api_base(provider: AiProvider, base_url: &str) -> String {
    let mut base = base_url.trim().trim_end_matches('/').to_string();

    match provider {
        AiProvider::OpenAI => {
            if !base.ends_with("/v1") {
                base.push_str("/v1");
            }
        }
        AiProvider::DeepSeek => {
            if base.ends_with("/v1") {
                base.truncate(base.len().saturating_sub(3));
            }
        }
        AiProvider::Compatible => {}
    }

    base
}

/// Load AI configuration from `.env`/environment.
///
/// Reads: `AI_BASE_URL`, `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`.
fn load_ai_config() -> AiConfig {
    let _ = dotenvy::dotenv();

    let base_url =
        std::env::var("AI_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".to_string());

    let provider = match std::env::var("AI_PROVIDER")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "openai" => AiProvider::OpenAI,
        "deepseek" => AiProvider::DeepSeek,
        "compatible" | "openai-compatible" | "openai_compatible" => AiProvider::Compatible,
        _ => infer_provider(&base_url),
    };

    AiConfig {
        provider,
        base_url: normalize_api_base(provider, &base_url),
        api_key: std::env::var("AI_API_KEY").unwrap_or_default(),
        model: std::env::var("AI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string()),
    }
}

/// Public AI configuration returned to the frontend (secrets omitted).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPublicConfig {
    pub provider: AiProvider,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

/// Get backend AI configuration without exposing secrets.
#[tauri::command]
pub fn get_ai_public_config() -> AiPublicConfig {
    let config = load_ai_config();
    AiPublicConfig {
        provider: config.provider,
        base_url: config.base_url,
        model: config.model,
        has_api_key: !config.api_key.is_empty(),
    }
}

/// Message format received from frontend
#[derive(Clone, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequestOptions {
    pub path: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub query: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatDeltaKind {
    Text,
    Reasoning,
}

/// Streaming chat payload sent to frontend
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamPayload {
    pub request_id: String,
    pub delta: String,
    pub kind: ChatDeltaKind,
    pub done: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatErrorPayload {
    pub request_id: String,
    pub error: String,
}

fn validate_path_override(path: &str) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Invalid request path".to_string());
    }
    if path.contains("://") {
        return Err("Request path must be a relative path starting with '/'".to_string());
    }
    if !path.starts_with('/') {
        return Err("Request path must start with '/'".to_string());
    }
    Ok(())
}

fn is_disallowed_header(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    matches!(lower.as_str(), "authorization" | "proxy-authorization" | "x-api-key")
}

/// BYOT stream chunk type that keeps DeepSeek-style `reasoning_content`.
#[derive(Debug, Deserialize)]
struct ByotChatCompletionStreamResponse {
    choices: Vec<ByotChatChoiceStream>,
}

#[derive(Debug, Deserialize)]
struct ByotChatChoiceStream {
    delta: ByotChatCompletionStreamDelta,
}

#[derive(Debug, Deserialize)]
struct ByotChatCompletionStreamDelta {
    content: Option<String>,
    #[serde(rename = "reasoning_content")]
    reasoning_content: Option<String>,
}

pub struct AiStreamManager {
    http_client: reqwest::Client,
    // NOTE: Using std::sync::Mutex since lock is never held across .await.
    // If future logic requires holding lock across await points, switch to tokio::sync::Mutex.
    handles: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
}

impl Default for AiStreamManager {
    fn default() -> Self {
        let http_client = reqwest::Client::builder()
            .pool_max_idle_per_host(8)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            http_client,
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl AiStreamManager {
    fn take_handle(
        &self,
        request_id: &str,
    ) -> Result<Option<tauri::async_runtime::JoinHandle<()>>, String> {
        let mut map = self
            .handles
            .lock()
            .map_err(|_| "AI stream manager lock poisoned".to_string())?;
        Ok(map.remove(request_id))
    }
}

/// Start a streaming chat request with reasoning support.
///
/// Emits chunks via `chat-stream` event and completion via `chat-done`.
#[tauri::command]
pub async fn chat_stream(
    app: tauri::AppHandle,
    streams: tauri::State<'_, AiStreamManager>,
    request_id: String,
    messages: Vec<ChatMessage>,
    model: Option<String>,
    request_options: Option<ChatRequestOptions>,
) -> Result<(), String> {
    if request_id.trim().is_empty() {
        return Err("requestId is required".to_string());
    }
    if messages.is_empty() {
        return Err("No messages provided".to_string());
    }

    let mut config = load_ai_config();
    if let Some(model) = model {
        if !model.trim().is_empty() {
            config.model = model;
        }
    }
    if config.api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    let request_id_for_task = request_id.clone();
    let app_for_task = app.clone();
    let http_client = streams.http_client.clone();
    let handles_for_task = streams.handles.clone();
    let request_options_for_task = request_options.unwrap_or_default();

    let mut handles = streams
        .handles
        .lock()
        .map_err(|_| "AI stream manager lock poisoned".to_string())?;
    if handles.contains_key(&request_id) {
        return Err("Stream already in progress for this requestId".to_string());
    }

    let handle = tauri::async_runtime::spawn(async move {
        let result = run_chat_stream(
            &app_for_task,
            &request_id_for_task,
            messages,
            config,
            request_options_for_task,
            http_client,
        )
        .await;

        if let Err(error) = result {
            let _ = app_for_task.emit(
                EVT_CHAT_ERROR,
                ChatErrorPayload {
                    request_id: request_id_for_task.clone(),
                    error,
                },
            );
        }

        let _ = app_for_task.emit(
            EVT_CHAT_STREAM,
            ChatStreamPayload {
                request_id: request_id_for_task.clone(),
                delta: String::new(),
                kind: ChatDeltaKind::Text,
                done: true,
            },
        );
        let _ = app_for_task.emit(EVT_CHAT_DONE, request_id_for_task.clone());

        if let Ok(mut map) = handles_for_task.lock() {
            map.remove(&request_id_for_task);
        }
    });

    handles.insert(request_id, handle);
    Ok(())
}

#[tauri::command]
pub fn chat_abort(
    app: tauri::AppHandle,
    streams: tauri::State<'_, AiStreamManager>,
    request_id: String,
) -> Result<(), String> {
    if request_id.trim().is_empty() {
        return Err("requestId is required".to_string());
    }

    if let Some(handle) = streams.take_handle(&request_id)? {
        handle.abort();
    }

    let _ = app.emit(
        EVT_CHAT_STREAM,
        ChatStreamPayload {
            request_id: request_id.clone(),
            delta: String::new(),
            kind: ChatDeltaKind::Text,
            done: true,
        },
    );
    let _ = app.emit(EVT_CHAT_DONE, request_id);

    Ok(())
}

async fn run_chat_stream(
    app: &tauri::AppHandle,
    request_id: &str,
    messages: Vec<ChatMessage>,
    config: AiConfig,
    request_options: ChatRequestOptions,
    http_client: reqwest::Client,
) -> Result<(), String> {
    let request_id = request_id.to_string();

    let openai_config = OpenAIConfig::new()
        .with_api_base(config.base_url)
        .with_api_key(config.api_key);
    let client = Client::with_config(openai_config).with_http_client(http_client);

    let api_messages: Vec<serde_json::Value> = messages
        .into_iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    let request = serde_json::json!({
        "model": config.model,
        "messages": api_messages,
        "stream": true
    });

    let mut chat = client.chat();

    if let Some(path) = request_options.path.as_deref() {
        validate_path_override(path)?;
        chat = chat.path(path).map_err(|e| e.to_string())?;
    }

    if let Some(query) = request_options.query.as_ref() {
        chat = chat.query(query).map_err(|e| e.to_string())?;
    }

    if let Some(headers) = request_options.headers.as_ref() {
        let mut header_map = reqwest::header::HeaderMap::new();
        for (key, value) in headers {
            if is_disallowed_header(key) {
                return Err(format!("Header not allowed from frontend: {key}"));
            }
            let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|_| format!("Invalid header name: {key}"))?;
            let value = reqwest::header::HeaderValue::from_str(value)
                .map_err(|_| format!("Invalid header value for {key}"))?;
            header_map.insert(name, value);
        }
        chat = chat.headers(header_map);
    }

    let mut stream = chat
        .create_stream_byot::<_, ByotChatCompletionStreamResponse>(&request)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        for choice in chunk.choices {
            if let Some(reasoning) = choice.delta.reasoning_content {
                if !reasoning.is_empty() {
                    let _ = app.emit(
                        EVT_CHAT_STREAM,
                        ChatStreamPayload {
                            request_id: request_id.clone(),
                            delta: reasoning,
                            kind: ChatDeltaKind::Reasoning,
                            done: false,
                        },
                    );
                }
            }

            if let Some(content) = choice.delta.content {
                if !content.is_empty() {
                    let _ = app.emit(
                        EVT_CHAT_STREAM,
                        ChatStreamPayload {
                            request_id: request_id.clone(),
                            delta: content,
                            kind: ChatDeltaKind::Text,
                            done: false,
                        },
                    );
                }
            }
        }
    }

    Ok(())
}

/// Simple non-streaming chat for testing/debugging.
#[tauri::command]
pub async fn chat_simple(
    prompt: String,
    model: Option<String>,
    request_options: Option<ChatRequestOptions>,
) -> Result<String, String> {
    let mut config = load_ai_config();
    if let Some(model) = model {
        if !model.trim().is_empty() {
            config.model = model;
        }
    }

    if config.api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    let openai_config = OpenAIConfig::new()
        .with_api_base(config.base_url)
        .with_api_key(config.api_key);
    let client = Client::with_config(openai_config);

    let request = serde_json::json!({
        "model": config.model,
        "messages": [
            { "role": "user", "content": prompt }
        ],
        "stream": false
    });

    let request_options = request_options.unwrap_or_default();
    let mut chat = client.chat();

    if let Some(path) = request_options.path.as_deref() {
        validate_path_override(path)?;
        chat = chat.path(path).map_err(|e| e.to_string())?;
    }

    if let Some(query) = request_options.query.as_ref() {
        chat = chat.query(query).map_err(|e| e.to_string())?;
    }

    if let Some(headers) = request_options.headers.as_ref() {
        let mut header_map = reqwest::header::HeaderMap::new();
        for (key, value) in headers {
            if is_disallowed_header(key) {
                return Err(format!("Header not allowed from frontend: {key}"));
            }
            let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|_| format!("Invalid header name: {key}"))?;
            let value = reqwest::header::HeaderValue::from_str(value)
                .map_err(|_| format!("Invalid header value for {key}"))?;
            header_map.insert(name, value);
        }
        chat = chat.headers(header_map);
    }

    let response: serde_json::Value = chat
        .create_byot::<_, serde_json::Value>(&request)
        .await
        .map_err(|e| e.to_string())?;

    response
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No response content".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_provider() {
        assert!(matches!(
            infer_provider("https://api.deepseek.com"),
            AiProvider::DeepSeek
        ));
        assert!(matches!(
            infer_provider("https://api.deepseek.com/beta"),
            AiProvider::DeepSeek
        ));
        assert!(matches!(
            infer_provider("https://api.openai.com/v1"),
            AiProvider::OpenAI
        ));
        assert!(matches!(
            infer_provider("https://unknown.com/v1"),
            AiProvider::Compatible
        ));
    }

    #[test]
    fn test_normalize_api_base() {
        assert_eq!(
            normalize_api_base(AiProvider::OpenAI, "https://api.openai.com"),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            normalize_api_base(AiProvider::OpenAI, "https://api.openai.com/v1"),
            "https://api.openai.com/v1"
        );

        assert_eq!(
            normalize_api_base(AiProvider::DeepSeek, "https://api.deepseek.com/v1"),
            "https://api.deepseek.com"
        );
        assert_eq!(
            normalize_api_base(AiProvider::DeepSeek, "https://api.deepseek.com"),
            "https://api.deepseek.com"
        );

        assert_eq!(
            normalize_api_base(AiProvider::Compatible, "https://other.com/v1"),
            "https://other.com/v1"
        );
    }
}
