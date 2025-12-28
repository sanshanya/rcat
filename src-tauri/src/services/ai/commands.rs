use async_openai::{config::OpenAIConfig, Client};
use serde_json::Value as JsonValue;
use tauri::Emitter;

use crate::plugins::history::HistoryStore;
use crate::services::config::load_ai_config;

use super::manager::AiStreamManager;
use super::request_options::apply_request_options;
use super::stream::run_chat_stream;
use super::tools::run_chat_with_tools;
use super::types::{
    ChatDeltaKind, ChatDonePayload, ChatErrorPayload, ChatMessage, ChatRequestOptions,
    ChatStreamPayload, EVT_CHAT_DONE, EVT_CHAT_ERROR, EVT_CHAT_STREAM,
};

/// Start a streaming chat request with reasoning support.
///
/// Emits chunks via `chat-stream` event and completion via `chat-done`.
#[tauri::command]
pub async fn chat_stream(
    app: tauri::AppHandle,
    streams: tauri::State<'_, AiStreamManager>,
    history: tauri::State<'_, HistoryStore>,
    request_id: String,
    conversation_id: Option<String>,
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
    let registry_for_task = streams.registry.clone();
    let request_options_for_task = request_options.unwrap_or_default();
    let history_for_task = history.inner().clone();
    let conversation_id_for_task = conversation_id.clone();

    let mut registry = streams
        .registry
        .lock()
        .map_err(|_| "AI stream manager lock poisoned".to_string())?;
    if registry.handles.contains_key(&request_id) {
        return Err("Stream already in progress for this requestId".to_string());
    }
    if let Some(conversation_id) = conversation_id.as_deref() {
        if registry.by_conversation.contains_key(conversation_id) {
            return Err("Conversation is busy".to_string());
        }
    }

    let handle = tauri::async_runtime::spawn(async move {
        if let Some(conversation_id) = conversation_id_for_task.as_deref() {
            if let Err(err) = history_for_task
                .sync_from_frontend_messages(conversation_id, &messages)
                .await
            {
                log::warn!("History sync failed: {}", err);
            }
        }

        let result = run_chat_stream(
            &app_for_task,
            &request_id_for_task,
            messages,
            config,
            request_options_for_task,
            http_client,
        )
        .await;

        match result {
            Ok((text, reasoning)) => {
                if let Some(conversation_id) = conversation_id_for_task.as_deref() {
                    let reasoning = reasoning.trim();
                    if let Err(err) = history_for_task
                        .append_assistant_message(
                            conversation_id,
                            text,
                            if reasoning.is_empty() {
                                None
                            } else {
                                Some(reasoning.to_string())
                            },
                        )
                        .await
                    {
                        log::warn!("History append failed: {}", err);
                    }
                }
            }
            Err(error) => {
                let _ = app_for_task.emit(
                    EVT_CHAT_ERROR,
                    ChatErrorPayload {
                        request_id: request_id_for_task.clone(),
                        error,
                    },
                );
            }
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
        let _ = app_for_task.emit(
            EVT_CHAT_DONE,
            ChatDonePayload {
                request_id: request_id_for_task.clone(),
                conversation_id: conversation_id_for_task.clone(),
            },
        );

        if let Ok(mut registry) = registry_for_task.lock() {
            registry.handles.remove(&request_id_for_task);
            if let Some(conversation_id) = conversation_id_for_task.as_deref() {
                if registry
                    .by_conversation
                    .get(conversation_id)
                    .map(|rid| rid.as_str())
                    == Some(request_id_for_task.as_str())
                {
                    registry.by_conversation.remove(conversation_id);
                }
            }
        }
    });

    if let Some(conversation_id) = conversation_id {
        registry
            .by_conversation
            .insert(conversation_id, request_id.clone());
    }
    registry.handles.insert(request_id, handle);
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

    let (conversation_id, handle) = match streams.take_request(&request_id)? {
        Some((cid, h)) => (cid, h),
        None => {
            let _ = app.emit(
                EVT_CHAT_DONE,
                ChatDonePayload {
                    request_id,
                    conversation_id: None,
                },
            );
            return Ok(());
        }
    };

    handle.abort();

    let _ = app.emit(
        EVT_CHAT_STREAM,
        ChatStreamPayload {
            request_id: request_id.clone(),
            delta: String::new(),
            kind: ChatDeltaKind::Text,
            done: true,
        },
    );
    let _ = app.emit(
        EVT_CHAT_DONE,
        ChatDonePayload {
            request_id,
            conversation_id,
        },
    );

    Ok(())
}

/// Abort the currently running stream for a conversation (if any).
#[tauri::command]
pub fn chat_abort_conversation(
    app: tauri::AppHandle,
    streams: tauri::State<'_, AiStreamManager>,
    conversation_id: String,
) -> Result<(), String> {
    let conversation_id = conversation_id.trim().to_string();
    if conversation_id.is_empty() {
        return Err("conversationId is required".to_string());
    }

    let Some((request_id, handle)) = streams.take_conversation(&conversation_id)? else {
        return Ok(());
    };

    handle.abort();

    let _ = app.emit(
        EVT_CHAT_STREAM,
        ChatStreamPayload {
            request_id: request_id.clone(),
            delta: String::new(),
            kind: ChatDeltaKind::Text,
            done: true,
        },
    );
    let _ = app.emit(
        EVT_CHAT_DONE,
        ChatDonePayload {
            request_id,
            conversation_id: Some(conversation_id),
        },
    );

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
    history: tauri::State<'_, HistoryStore>,
    request_id: String,
    conversation_id: Option<String>,
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
    let registry_for_task = streams.registry.clone();
    let request_options_for_task = request_options.unwrap_or_default();
    let history_for_task = history.inner().clone();
    let conversation_id_for_task = conversation_id.clone();

    let mut registry = streams
        .registry
        .lock()
        .map_err(|_| "AI stream manager lock poisoned".to_string())?;
    if registry.handles.contains_key(&request_id) {
        return Err("Stream already in progress for this requestId".to_string());
    }
    if let Some(conversation_id) = conversation_id.as_deref() {
        if registry.by_conversation.contains_key(conversation_id) {
            return Err("Conversation is busy".to_string());
        }
    }

    let handle = tauri::async_runtime::spawn(async move {
        if let Some(conversation_id) = conversation_id_for_task.as_deref() {
            if let Err(err) = history_for_task
                .sync_from_frontend_messages(conversation_id, &messages)
                .await
            {
                log::warn!("History sync failed: {}", err);
            }
        }

        let result = run_chat_with_tools(
            &app_for_task,
            &request_id_for_task,
            messages,
            config,
            request_options_for_task,
            http_client,
        )
        .await;

        match result {
            Ok((text, reasoning)) => {
                if let Some(conversation_id) = conversation_id_for_task.as_deref() {
                    let reasoning = reasoning.trim();
                    if let Err(err) = history_for_task
                        .append_assistant_message(
                            conversation_id,
                            text,
                            if reasoning.is_empty() {
                                None
                            } else {
                                Some(reasoning.to_string())
                            },
                        )
                        .await
                    {
                        log::warn!("History append failed: {}", err);
                    }
                }
            }
            Err(error) => {
                let _ = app_for_task.emit(
                    EVT_CHAT_ERROR,
                    ChatErrorPayload {
                        request_id: request_id_for_task.clone(),
                        error,
                    },
                );
            }
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
        let _ = app_for_task.emit(
            EVT_CHAT_DONE,
            ChatDonePayload {
                request_id: request_id_for_task.clone(),
                conversation_id: conversation_id_for_task.clone(),
            },
        );

        if let Ok(mut registry) = registry_for_task.lock() {
            registry.handles.remove(&request_id_for_task);
            if let Some(conversation_id) = conversation_id_for_task.as_deref() {
                if registry
                    .by_conversation
                    .get(conversation_id)
                    .map(|rid| rid.as_str())
                    == Some(request_id_for_task.as_str())
                {
                    registry.by_conversation.remove(conversation_id);
                }
            }
        }
    });

    if let Some(conversation_id) = conversation_id {
        registry
            .by_conversation
            .insert(conversation_id, request_id.clone());
    }
    registry.handles.insert(request_id, handle);
    Ok(())
}
