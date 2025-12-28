use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Event name for streaming chat chunks
pub const EVT_CHAT_STREAM: &str = "chat-stream";
/// Event name for stream completion
pub const EVT_CHAT_DONE: &str = "chat-done";
/// Event name for stream error
pub const EVT_CHAT_ERROR: &str = "chat-error";

/// Stream completion payload (used for history refresh / notifications).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDonePayload {
    pub request_id: String,
    pub conversation_id: Option<String>,
}

/// Message format received from frontend
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[derive(Clone, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
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

/// BYOT stream chunk type that keeps DeepSeek-style `reasoning_content`.
#[derive(Debug, Deserialize)]
pub(super) struct ByotChatCompletionStreamResponse {
    pub(super) choices: Vec<ByotChatChoiceStream>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ByotChatChoiceStream {
    pub(super) delta: ByotChatCompletionStreamDelta,
    pub(super) finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ByotChatCompletionStreamDelta {
    pub(super) content: Option<String>,
    #[serde(rename = "reasoning_content")]
    pub(super) reasoning_content: Option<String>,
    pub(super) tool_calls: Option<Vec<StreamToolCallDelta>>,
}

/// Streaming tool call delta - tool calls come in chunks
#[derive(Debug, Clone, Deserialize)]
pub(super) struct StreamToolCallDelta {
    pub(super) index: usize,
    pub(super) id: Option<String>,
    #[serde(rename = "type")]
    pub(super) call_type: Option<String>,
    pub(super) function: Option<StreamFunctionDelta>,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct StreamFunctionDelta {
    pub(super) name: Option<String>,
    pub(super) arguments: Option<String>,
}
