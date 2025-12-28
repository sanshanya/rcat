use async_openai::{config::OpenAIConfig, Client};
use serde_json::Value as JsonValue;
use tauri::Emitter;

use crate::services::config::load_ai_config;

use super::manager::AiStreamManager;
use super::request_options::apply_request_options;
use super::stream::run_chat_stream;
use super::tools::run_chat_with_tools;
use super::types::{
    ChatDeltaKind, ChatErrorPayload, ChatMessage, ChatRequestOptions, ChatStreamPayload,
    EVT_CHAT_DONE, EVT_CHAT_ERROR, EVT_CHAT_STREAM,
};

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
    let chat = apply_request_options(client.chat(), &request_options)?;

    let response: JsonValue = chat
        .create_byot::<_, JsonValue>(&request)
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

