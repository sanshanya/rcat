use async_openai::error::OpenAIError;
use async_openai::{config::OpenAIConfig, Client};
use futures_util::StreamExt;
use tauri::{Emitter, Manager};

use crate::services::config::AiConfig;
use crate::services::prompts;
use crate::services::retry::RetryConfig;

use super::request_options::apply_request_options;
use super::retry_policy::should_retry_openai_error;
use super::types::{
    ByotChatCompletionStreamResponse, ChatDeltaKind, ChatMessage, ChatRequestOptions,
    ChatStreamPayload, EVT_CHAT_STREAM,
};
#[cfg(feature = "vision")]
use crate::plugins::vision as vision_plugin;

#[cfg(not(feature = "vision"))]
mod vision_plugin {
    use crate::services::config::AiConfig;

    pub fn ai_tools_schema(_config: &AiConfig) -> serde_json::Value {
        serde_json::json!([])
    }

    pub async fn execute_ai_tool_call(
        _name: &str,
        _arguments: &serde_json::Value,
    ) -> Result<String, String> {
        Err("Vision disabled".to_string())
    }
}

fn vision_runtime_enabled() -> bool {
    std::env::var("RCAT_VISION")
        .or_else(|_| std::env::var("VISION_ENABLED"))
        .ok()
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "y" | "on"
            )
        })
        .unwrap_or(true)
}

async fn clear_voice_stream_handle(app: &tauri::AppHandle) {
    let Some(voice_state) = app.try_state::<crate::services::voice::VoiceState>() else {
        return;
    };
    voice_state.set_stream_handle(None).await;
}

pub(super) async fn run_chat_generic(
    app: &tauri::AppHandle,
    request_id: &str,
    messages: Vec<ChatMessage>,
    config: AiConfig,
    request_options: ChatRequestOptions,
    http_client: reqwest::Client,
    tools_enabled: bool,
    voice_enabled: bool,
) -> Result<(String, String), String> {
    let request_id = request_id.to_string();

    let mut voice_session: Option<rcat_voice::streaming::StreamSession> = None;
    let mut voice_control: Option<rcat_voice::streaming::StreamControl> = None;
    let mut voice_delta_tx: Option<tokio::sync::mpsc::Sender<String>> = None;
    if voice_enabled {
        let voice_state = app.state::<crate::services::voice::VoiceState>();
        voice_state.cancel_active_stream().await;
        match voice_state.get_or_build_engine(true) {
            Ok(engine) => {
                // Ensure previous playback is stopped before starting a new streaming session.
                let _ = engine.stop().await;
                let session = rcat_voice::streaming::StreamSession::from_env(engine);
                voice_state
                    .set_stream_handle(Some(session.cancel_handle()))
                    .await;
                let control = session.control();
                control.mark_llm_start();
                voice_delta_tx = Some(control.sender());
                voice_control = Some(control);
                voice_session = Some(session);
            }
            Err(err) => {
                log::warn!("Voice auto mode disabled: {err}");
            }
        }
    }

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

    let tools_available = tools_enabled && cfg!(feature = "vision") && vision_runtime_enabled();
    let tools_schema = if tools_available {
        vision_plugin::ai_tools_schema(&config)
    } else {
        serde_json::json!([])
    };
    let tools_active = tools_available
        && tools_schema
            .as_array()
            .map(|items| !items.is_empty())
            .unwrap_or(true);

    let system_prompt = if tools_active {
        prompts::SYSTEM_PROMPT_WITH_TOOLS
    } else {
        prompts::SYSTEM_PROMPT_DEFAULT
    };

    if !has_system {
        api_messages.push(serde_json::json!({
            "role": "system",
            "content": system_prompt
        }));
    }

    // 2. Add user messages
    for m in messages {
        if m.role == "system" {
            // Replace existing system prompt with ours (force consistent rules)
            api_messages.push(serde_json::json!({
                "role": "system",
                "content": system_prompt
            }));
        } else {
            api_messages.push(serde_json::json!({ "role": m.role, "content": m.content }));
        }
    }

    let tools = if tools_active { Some(tools_schema) } else { None };

    let retry = RetryConfig::from_env();
    let max_tool_rounds = if tools_active {
        std::env::var("AI_MAX_TOOL_ROUNDS")
            .ok()
            .and_then(|v| v.trim().parse::<usize>().ok())
            .unwrap_or(5)
            .clamp(1, 50)
    } else {
        1 // Non-tool chats only need 1 round
    };

    // Accumulate what the UI receives across tool rounds.
    let mut all_text = String::new();
    let mut all_reasoning = String::new();

    'rounds: for _round in 0..max_tool_rounds {
        // Use streaming API
        let mut request_json = serde_json::json!({
            "model": config.model,
            "messages": api_messages,
            "stream": true
        });

        if let Some(t) = &tools {
            request_json
                .as_object_mut()
                .unwrap()
                .insert("tools".to_string(), t.clone());
        }

        let request = request_json;

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
                        continue 'attempts;
                    }
                    return Err(msg);
                }
            };

            // Accumulators for this round
            let mut accumulated_content = String::new();
            let mut accumulated_reasoning = String::new();
            let mut accumulated_tool_calls: Vec<(String, String, String, String)> = Vec::new(); // (id, type, name, arguments)
            let mut finish_reason: Option<String> = None;
            let mut emitted_any = false;
            let mut stream_error: Option<OpenAIError> = None;

            // Process stream
            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(chunk) => chunk,
                    Err(err) => {
                        stream_error = Some(err);
                        break;
                    }
                };

                for choice in chunk.choices {
                    // Track finish reason
                    if choice.finish_reason.is_some() {
                        finish_reason = choice.finish_reason;
                    }

                    // Stream reasoning content
                    if let Some(reasoning) = choice.delta.reasoning_content {
                        if !reasoning.is_empty() {
                            emitted_any = true;
                            accumulated_reasoning.push_str(&reasoning);
                            all_reasoning.push_str(&reasoning);
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

                    // Stream text content
                    if let Some(content) = choice.delta.content {
                        if !content.is_empty() {
                            emitted_any = true;
                            accumulated_content.push_str(&content);
                            all_text.push_str(&content);
                            if let Some(tx) = voice_delta_tx.as_mut() {
                                let _ = tx.send(content.clone()).await;
                            }
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

            if let Some(err) = stream_error {
                let msg = err.to_string();
                last_error = Some(msg.clone());
                if attempt < retry.max_attempts && !emitted_any && should_retry_openai_error(&err) {
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

            // Check if we have tool calls to execute
            let has_tool_calls = tools_enabled
                && !accumulated_tool_calls.is_empty()
                && finish_reason.as_deref() == Some("tool_calls");

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

                    let indicator = prompts::tool_call_indicator(name);
                    let _ = app.emit(
                        EVT_CHAT_STREAM,
                        ChatStreamPayload {
                            request_id: request_id.clone(),
                            delta: indicator.clone(),
                            kind: ChatDeltaKind::Reasoning,
                            done: false,
                        },
                    );
                    all_reasoning.push_str(&indicator);

                    let arguments: serde_json::Value =
                        serde_json::from_str(args).unwrap_or(serde_json::json!({}));

                    let tool_result = if vision_runtime_enabled() {
                        vision_plugin::execute_ai_tool_call(name, &arguments)
                            .await
                            .unwrap_or_else(|e| format!("工具执行失败: {}", e))
                    } else {
                        "Vision disabled".to_string()
                    };

                    // Add tool result to conversation
                    api_messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": id,
                        "content": tool_result
                    }));
                }
                // Continue to next round
                continue 'rounds;
            }

            // No tool calls - we're done
            if voice_enabled {
                clear_voice_stream_handle(app).await;
            }
            drop(voice_delta_tx);
            drop(voice_control);
            drop(voice_session);
            return Ok((all_text, all_reasoning));
        }

        if voice_enabled {
            clear_voice_stream_handle(app).await;
        }
        return Err(last_error.unwrap_or_else(|| "Retry limit exceeded".to_string()));
    }

    if voice_enabled {
        clear_voice_stream_handle(app).await;
    }
    Err(format!("Tool round limit reached ({max_tool_rounds})"))
}
