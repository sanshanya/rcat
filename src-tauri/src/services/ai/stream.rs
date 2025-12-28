use async_openai::{config::OpenAIConfig, Client};
use futures_util::StreamExt;
use tauri::Emitter;

use crate::services::config::AiConfig;
use crate::services::prompts;
use crate::services::retry::RetryConfig;

use super::request_options::apply_request_options;
use super::retry_policy::should_retry_openai_error;
use super::types::{
    ByotChatCompletionStreamResponse, ChatDeltaKind, ChatMessage, ChatRequestOptions,
    ChatStreamPayload, EVT_CHAT_STREAM,
};

pub(super) async fn run_chat_stream(
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

    let retry = RetryConfig::from_env();
    let mut last_error: Option<String> = None;

    'attempts: for attempt in 1..=retry.max_attempts {
        let chat = apply_request_options(client.chat(), &request_options)?;

        let mut stream = match chat
            .create_stream_byot::<_, ByotChatCompletionStreamResponse>(&request)
            .await
        {
            Ok(stream) => stream,
            Err(err) => {
                let msg = err.to_string();
                last_error = Some(msg.clone());
                if attempt < retry.max_attempts && should_retry_openai_error(&err) {
                    log::warn!(
                        "Retry attempt {}/{} after error: {}",
                        attempt + 1,
                        retry.max_attempts,
                        msg
                    );
                    tokio::time::sleep(retry.backoff(attempt)).await;
                    continue;
                }
                return Err(msg);
            }
        };

        let mut emitted_any = false;

        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(err) => {
                    let msg = err.to_string();
                    last_error = Some(msg.clone());
                    if attempt < retry.max_attempts
                        && !emitted_any
                        && should_retry_openai_error(&err)
                    {
                        log::warn!(
                            "Retry attempt {}/{} after stream error: {}",
                            attempt + 1,
                            retry.max_attempts,
                            msg
                        );
                        tokio::time::sleep(retry.backoff(attempt)).await;
                        continue 'attempts;
                    }
                    return Err(msg);
                }
            };

            for choice in chunk.choices {
                if let Some(reasoning) = choice.delta.reasoning_content {
                    if !reasoning.is_empty() {
                        emitted_any = true;
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
                        emitted_any = true;
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

        return Ok(());
    }

    Err(last_error.unwrap_or_else(|| "Retry limit exceeded".to_string()))
}

