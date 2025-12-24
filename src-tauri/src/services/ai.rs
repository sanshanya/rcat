// src-tauri/src/services/ai.rs
//! AI Service module for OpenAI-compatible API integration.
//! Supports any OpenAI-format API (official, Azure, local Ollama, etc.)
//! via configurable base_url and api_key.
//! 
//! Special support for reasoning models (DeepSeek R1, etc.) that output
//! reasoning_content in the delta stream.

use futures_util::StreamExt;
use reqwest_eventsource::{Event, EventSource};
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
    pub delta: String,
    pub kind: String, // "text" or "reasoning"
    pub done: bool,
}

/// Message format received from frontend
#[derive(Clone, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Start a streaming chat request with reasoning support.
/// Uses raw HTTP streaming to capture both content and reasoning_content.
/// Emits chunks via `chat-stream` event, completion via `chat-done`.
#[tauri::command]
pub async fn chat_stream(
    app: tauri::AppHandle,
    messages: Vec<ChatMessage>,
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

    if messages.is_empty() {
        return Err("No messages provided".to_string());
    }

    // Ensure base_url ends without trailing slash
    let base_url = config.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);

    // Convert messages to API format
    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    // Build request body with full conversation history
    let body = serde_json::json!({
        "model": config.model,
        "messages": api_messages,
        "stream": true
    });

    // Create HTTP client and request
    let client = reqwest::Client::new();
    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body);

    // Create SSE event source
    let mut es = EventSource::new(request).map_err(|e| e.to_string())?;

    // Process SSE events
    while let Some(event) = es.next().await {
        match event {
            Ok(Event::Open) => {
                // Connection opened, nothing to do
            }
            Ok(Event::Message(message)) => {
                // Check for [DONE] signal
                if message.data == "[DONE]" {
                    break;
                }

                // Parse the JSON data
                if let Ok(json) = serde_json::from_str::<Value>(&message.data) {
                    if let Some(choices) = json.get("choices").and_then(|c| c.as_array()) {
                        for choice in choices {
                            if let Some(delta) = choice.get("delta") {
                                // Extract reasoning_content (for DeepSeek R1, etc.)
                                if let Some(reasoning) = delta.get("reasoning_content").and_then(|r| r.as_str()) {
                                    if !reasoning.is_empty() {
                                        let _ = app.emit(
                                            EVT_CHAT_STREAM,
                                            ChatStreamPayload {
                                                delta: reasoning.to_string(),
                                                kind: "reasoning".to_string(),
                                                done: false,
                                            },
                                        );
                                    }
                                }

                                // Extract regular content
                                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                    if !content.is_empty() {
                                        let _ = app.emit(
                                            EVT_CHAT_STREAM,
                                            ChatStreamPayload {
                                                delta: content.to_string(),
                                                kind: "text".to_string(),
                                                done: false,
                                            },
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                // Handle errors
                let error_msg = format!("Stream error: {}", e);
                let _ = app.emit(EVT_CHAT_ERROR, &error_msg);
                es.close();
                return Err(error_msg);
            }
        }
    }

    // Signal completion
    let _ = app.emit(
        EVT_CHAT_STREAM,
        ChatStreamPayload {
            delta: String::new(),
            kind: "text".to_string(),
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

    // Ensure base_url ends without trailing slash
    let base_url = config.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);

    let body = serde_json::json!({
        "model": config.model,
        "messages": [
            { "role": "user", "content": prompt }
        ]
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = response.json().await.map_err(|e| e.to_string())?;

    json.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No response content".to_string())
}
