// src-tauri/src/services/ai.rs
//! AI Service module for OpenAI-compatible API integration.
//! Supports any OpenAI-format API (official, Azure, local Ollama, etc.)
//! via configurable base_url and api_key.

use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestMessage, ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs,
    },
    Client,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// AI configuration for OpenAI-compatible endpoints
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
        }
    }
}

/// Load AI configuration from .env file.
/// Reads: AI_BASE_URL, AI_API_KEY, AI_MODEL
#[tauri::command]
pub fn load_ai_config() -> AiConfig {
    // Try to load .env file (silently ignore if not found)
    let _ = dotenvy::dotenv();

    AiConfig {
        base_url: std::env::var("AI_BASE_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1".to_string()),
        api_key: std::env::var("AI_API_KEY").unwrap_or_default(),
        model: std::env::var("AI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string()),
    }
}

/// Event name for streaming chat chunks
pub const EVT_CHAT_STREAM: &str = "chat-stream";
/// Event name for stream completion
pub const EVT_CHAT_DONE: &str = "chat-done";
/// Event name for stream error
pub const EVT_CHAT_ERROR: &str = "chat-error";

/// Streaming chat payload sent to frontend
#[derive(Clone, Serialize)]
pub struct ChatStreamPayload {
    pub chunk: String,
    pub done: bool,
}

/// Start a streaming chat request.
/// Emits chunks via `chat-stream` event, completion via `chat-done`.
#[tauri::command]
pub async fn chat_stream(
    app: tauri::AppHandle,
    prompt: String,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let env_config = load_ai_config();
    let config = AiConfig {
        base_url: base_url.unwrap_or(env_config.base_url),
        api_key: api_key.unwrap_or(env_config.api_key),
        model: model.unwrap_or(env_config.model),
    };

    if config.api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    // Build OpenAI client with custom config
    let openai_config = OpenAIConfig::new()
        .with_api_key(&config.api_key)
        .with_api_base(&config.base_url);

    let client = Client::with_config(openai_config);

    // Build chat request
    let messages: Vec<ChatCompletionRequestMessage> =
        vec![ChatCompletionRequestUserMessageArgs::default()
            .content(prompt)
            .build()
            .map_err(|e| e.to_string())?
            .into()];

    let request = CreateChatCompletionRequestArgs::default()
        .model(&config.model)
        .messages(messages)
        .stream(true)
        .build()
        .map_err(|e| e.to_string())?;

    // Execute streaming request
    let mut stream = client
        .chat()
        .create_stream(request)
        .await
        .map_err(|e| e.to_string())?;

    // Process stream chunks
    while let Some(result) = stream.next().await {
        match result {
            Ok(response) => {
                for choice in response.choices {
                    if let Some(content) = choice.delta.content {
                        let _ = app.emit(
                            EVT_CHAT_STREAM,
                            ChatStreamPayload {
                                chunk: content,
                                done: false,
                            },
                        );
                    }
                }
            }
            Err(e) => {
                let _ = app.emit(EVT_CHAT_ERROR, e.to_string());
                return Err(e.to_string());
            }
        }
    }

    // Signal completion
    let _ = app.emit(
        EVT_CHAT_STREAM,
        ChatStreamPayload {
            chunk: String::new(),
            done: true,
        },
    );
    let _ = app.emit(EVT_CHAT_DONE, ());

    Ok(())
}

/// Simple non-streaming chat for testing/debugging
#[tauri::command]
pub async fn chat_simple(
    prompt: String,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let env_config = load_ai_config();
    let config = AiConfig {
        base_url: base_url.unwrap_or(env_config.base_url),
        api_key: api_key.unwrap_or(env_config.api_key),
        model: model.unwrap_or(env_config.model),
    };

    if config.api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    let openai_config = OpenAIConfig::new()
        .with_api_key(&config.api_key)
        .with_api_base(&config.base_url);

    let client = Client::with_config(openai_config);

    let messages: Vec<ChatCompletionRequestMessage> =
        vec![ChatCompletionRequestUserMessageArgs::default()
            .content(prompt)
            .build()
            .map_err(|e| e.to_string())?
            .into()];

    let request = CreateChatCompletionRequestArgs::default()
        .model(&config.model)
        .messages(messages)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .chat()
        .create(request)
        .await
        .map_err(|e| e.to_string())?;

    response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| "No response content".to_string())
}
