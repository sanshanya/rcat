use async_openai::{config::OpenAIConfig, Client};
use serde_json::Value as JsonValue;

use crate::services::config::load_ai_config;
use crate::services::config::AiProvider;
use crate::services::prompts;

use super::types::ConversationMessage;

fn build_transcript(messages: &[ConversationMessage]) -> String {
    let mut out = String::new();
    for m in messages {
        if m.role == "system" {
            continue;
        }
        let role = if m.role == "user" {
            "User"
        } else {
            "Assistant"
        };
        out.push_str(role);
        out.push_str(": ");
        out.push_str(m.content.trim());
        out.push('\n');
    }
    out
}

pub(super) async fn generate_title(messages: &[ConversationMessage]) -> Result<String, String> {
    let config = load_ai_config();
    if config.api_key.is_empty() {
        return Err("AI key missing for title generation".to_string());
    }

    // Prefer a non-reasoning chat model for title generation. Reasoning models (e.g. DeepSeek R1)
    // may return empty `content`, which produces noisy retries.
    let model = match config.provider {
        AiProvider::DeepSeek
            if config
                .model
                .trim()
                .eq_ignore_ascii_case("deepseek-reasoner") =>
        {
            "deepseek-chat".to_string()
        }
        _ => config.model.clone(),
    };

    let openai_config = OpenAIConfig::new()
        .with_api_base(config.base_url)
        .with_api_key(config.api_key);
    let client = Client::with_config(openai_config);

    let transcript = build_transcript(messages);
    let prompt = format!(
        "为下面这段对话生成一个简短标题（中文优先，<= 16 个字），只输出标题本身，不要引号：\n\n{}",
        transcript
    );

    let request = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": prompts::SYSTEM_PROMPT_DEFAULT },
            { "role": "user", "content": prompt }
        ],
        "stream": false,
        "max_tokens": 64
    });

    let response: JsonValue = client
        .chat()
        .create_byot::<_, JsonValue>(&request)
        .await
        .map_err(|e| e.to_string())?;

    let message = response
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .cloned()
        .unwrap_or(JsonValue::Null);

    let mut title = message
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .trim()
        .trim_matches('"')
        .trim()
        .to_string();

    if title.is_empty() {
        title = message
            .get("reasoning_content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .trim()
            .to_string();
    }

    let title = title.trim().trim_matches('"').trim().to_string();

    if title.is_empty() {
        return Err("Empty title from model".to_string());
    }

    Ok(title)
}
