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
    matches!(
        lower.as_str(),
        "authorization" | "proxy-authorization" | "x-api-key"
    )
}

/// BYOT stream chunk type that keeps DeepSeek-style `reasoning_content`.
#[derive(Debug, Deserialize)]
struct ByotChatCompletionStreamResponse {
    choices: Vec<ByotChatChoiceStream>,
}

#[derive(Debug, Deserialize)]
struct ByotChatChoiceStream {
    delta: ByotChatCompletionStreamDelta,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ByotChatCompletionStreamDelta {
    content: Option<String>,
    #[serde(rename = "reasoning_content")]
    reasoning_content: Option<String>,
    tool_calls: Option<Vec<StreamToolCallDelta>>,
}

/// Streaming tool call delta - tool calls come in chunks
#[derive(Debug, Clone, Deserialize)]
struct StreamToolCallDelta {
    index: usize,
    id: Option<String>,
    #[serde(rename = "type")]
    call_type: Option<String>,
    function: Option<StreamFunctionDelta>,
}

#[derive(Debug, Clone, Deserialize)]
struct StreamFunctionDelta {
    name: Option<String>,
    arguments: Option<String>,
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

    let mut api_messages: Vec<serde_json::Value> = Vec::new();

    // 1. Inject or replace system prompt
    let has_system = messages
        .first()
        .map(|m| m.role == "system")
        .unwrap_or(false);
    if !has_system {
        api_messages.push(serde_json::json!({
            "role": "system",
            "content": prompts::SYSTEM_PROMPT_DEFAULT
        }));
    }

    // 2. Add user messages
    for m in messages {
        if m.role == "system" {
            api_messages.push(serde_json::json!({
                "role": "system",
                "content": prompts::SYSTEM_PROMPT_DEFAULT
            }));
        } else {
            api_messages.push(serde_json::json!({ "role": m.role, "content": m.content }));
        }
    }

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

// ============================================================================
// Tool Calling Support
// ============================================================================

use super::prompts;
use super::vision;

/// Vision tools available for AI to call
fn get_vision_tools() -> serde_json::Value {
    prompts::build_vision_tools_schema()
}

/// Execute a tool call and return the result
async fn execute_tool_call(name: &str, arguments: &serde_json::Value) -> Result<String, String> {
    match name {
        name if name == prompts::tool_list_windows::NAME => {
            let windows = vision::list_capturable_windows()?;
            let formatted: Vec<(String, String, bool)> = windows
                .iter()
                .map(|w| (w.title.clone(), w.app_name.clone(), w.is_focused))
                .collect();
            Ok(prompts::format_window_list(&formatted))
        }
        name if name == prompts::tool_capture_window::NAME => {
            let window_title = arguments
                .get(prompts::tool_capture_window::PARAM_WINDOW_TITLE)
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing window_title argument".to_string())?;

            let result = vision::capture_screen_text(Some(window_title.to_string())).await?;
            let window_name = result
                .window_name
                .unwrap_or_else(|| window_title.to_string());
            Ok(prompts::format_window_capture(&window_name, &result.text))
        }
        name if name == prompts::tool_capture_focused::NAME => {
            let result = vision::capture_smart().await?;
            let window_name = result.window_name.unwrap_or_else(|| "未知".to_string());
            Ok(prompts::format_focused_capture(&window_name, &result.text))
        }
        _ => Err(format!("Unknown tool: {}", name)),
    }
}

/// Streaming chat with tool calling support.
///
/// The AI can call vision tools to observe the user's screen.
#[tauri::command]
pub async fn chat_stream_with_tools(
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
        let result = run_chat_with_tools(
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

async fn run_chat_with_tools(
    app: &tauri::AppHandle,
    request_id: &str,
    messages: Vec<ChatMessage>,
    config: AiConfig,
    request_options: ChatRequestOptions,
    http_client: reqwest::Client,
) -> Result<(), String> {
    let openai_config = OpenAIConfig::new()
        .with_api_base(config.base_url.clone())
        .with_api_key(config.api_key.clone());
    let client = Client::with_config(openai_config).with_http_client(http_client);

    // Build initial messages
    let mut api_messages: Vec<serde_json::Value> = Vec::new();

    // 1. Inject or replace system prompt
    let has_system = messages
        .first()
        .map(|m| m.role == "system")
        .unwrap_or(false);
    if !has_system {
        api_messages.push(serde_json::json!({
            "role": "system",
            "content": prompts::SYSTEM_PROMPT_WITH_TOOLS
        }));
    }

    // 2. Add user messages
    for m in messages {
        if m.role == "system" {
            // Replace existing system prompt with ours (force tool rules)
            api_messages.push(serde_json::json!({
                "role": "system",
                "content": prompts::SYSTEM_PROMPT_WITH_TOOLS
            }));
        } else {
            api_messages.push(serde_json::json!({ "role": m.role, "content": m.content }));
        }
    }

    let tools = get_vision_tools();
    const MAX_TOOL_ROUNDS: usize = 5;

    for _round in 0..MAX_TOOL_ROUNDS {
        // Use streaming API
        let request = serde_json::json!({
            "model": config.model,
            "messages": api_messages,
            "tools": tools,
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
                let val = reqwest::header::HeaderValue::from_str(value)
                    .map_err(|_| format!("Invalid header value for {key}"))?;
                header_map.insert(name, val);
            }
            chat = chat.headers(header_map);
        }

        let mut stream = chat
            .create_stream_byot::<_, ByotChatCompletionStreamResponse>(&request)
            .await
            .map_err(|e| e.to_string())?;

        // Accumulators for this round
        let mut accumulated_content = String::new();
        let mut accumulated_reasoning = String::new();
        let mut accumulated_tool_calls: Vec<(String, String, String, String)> = Vec::new(); // (id, type, name, arguments)
        let mut finish_reason: Option<String> = None;

        // Process stream
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;

            for choice in chunk.choices {
                // Track finish reason
                if choice.finish_reason.is_some() {
                    finish_reason = choice.finish_reason;
                }

                // Stream reasoning content
                if let Some(reasoning) = choice.delta.reasoning_content {
                    if !reasoning.is_empty() {
                        accumulated_reasoning.push_str(&reasoning);
                        let _ = app.emit(
                            EVT_CHAT_STREAM,
                            ChatStreamPayload {
                                request_id: request_id.to_string(),
                                delta: reasoning,
                                kind: ChatDeltaKind::Reasoning,
                                done: false,
                            },
                        );
                    }
                }

                // Stream text content
                if let Some(content) = choice.delta.content {
                    if !content.is_empty() {
                        accumulated_content.push_str(&content);
                        let _ = app.emit(
                            EVT_CHAT_STREAM,
                            ChatStreamPayload {
                                request_id: request_id.to_string(),
                                delta: content,
                                kind: ChatDeltaKind::Text,
                                done: false,
                            },
                        );
                    }
                }

                // Accumulate tool calls (they come in chunks)
                if let Some(tool_calls) = choice.delta.tool_calls {
                    for tc in tool_calls {
                        let idx = tc.index;
                        // Ensure we have enough slots
                        while accumulated_tool_calls.len() <= idx {
                            accumulated_tool_calls.push((
                                String::new(),
                                String::new(),
                                String::new(),
                                String::new(),
                            ));
                        }
                        // Accumulate parts
                        if let Some(id) = tc.id {
                            accumulated_tool_calls[idx].0 = id;
                        }
                        if let Some(call_type) = tc.call_type {
                            accumulated_tool_calls[idx].1 = call_type;
                        }
                        if let Some(func) = tc.function {
                            if let Some(name) = func.name {
                                accumulated_tool_calls[idx].2 = name;
                            }
                            if let Some(args) = func.arguments {
                                accumulated_tool_calls[idx].3.push_str(&args);
                            }
                        }
                    }
                }
            }
        }

        // Check if we have tool calls to execute
        let has_tool_calls =
            !accumulated_tool_calls.is_empty() && finish_reason.as_deref() == Some("tool_calls");

        if has_tool_calls {
            // Build assistant message with tool_calls AND reasoning_content
            let tool_calls_json: Vec<serde_json::Value> = accumulated_tool_calls
                .iter()
                .filter(|(id, _, name, _)| !id.is_empty() && !name.is_empty())
                .map(|(id, call_type, name, args)| {
                    serde_json::json!({
                        "id": id,
                        "type": if call_type.is_empty() { "function" } else { call_type.as_str() },
                        "function": {
                            "name": name,
                            "arguments": args
                        }
                    })
                })
                .collect();

            api_messages.push(serde_json::json!({
                "role": "assistant",
                "content": if accumulated_content.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(accumulated_content.clone()) },
                "reasoning_content": if accumulated_reasoning.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(accumulated_reasoning.clone()) },
                "tool_calls": tool_calls_json
            }));

            // Emit tool call info and execute
            for (id, _, name, args) in &accumulated_tool_calls {
                if id.is_empty() || name.is_empty() {
                    continue;
                }

                let _ = app.emit(
                    EVT_CHAT_STREAM,
                    ChatStreamPayload {
                        request_id: request_id.to_string(),
                        delta: prompts::tool_call_indicator(name),
                        kind: ChatDeltaKind::Reasoning,
                        done: false,
                    },
                );

                let arguments: serde_json::Value =
                    serde_json::from_str(args).unwrap_or(serde_json::json!({}));

                let tool_result = execute_tool_call(name, &arguments)
                    .await
                    .unwrap_or_else(|e| format!("工具执行失败: {}", e));

                // Add tool result to conversation
                api_messages.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": tool_result
                }));
            }
            // Continue to next round
            continue;
        }

        // No tool calls - we're done
        break;
    }

    Ok(())
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
