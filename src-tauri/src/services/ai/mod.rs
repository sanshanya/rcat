//! AI Service module for OpenAI-compatible API integration.
//!
//! Notes:
//! - We use `async-openai` for its HTTP client/backoff/stream handling.
//! - For OpenAI-compatible vendors (DeepSeek/OpenRouter/etc.) that include extra
//!   fields like `reasoning_content` in streaming deltas, we use async-openai's
//!   `byot` ("bring your own types") methods to deserialize those fields.

pub(crate) mod commands;
mod manager;
mod request_options;
mod retry_policy;
mod stream;
mod tools;
mod types;

pub use commands::{
    chat_abort, chat_abort_conversation, chat_simple, chat_stream, chat_stream_with_tools,
};
pub use manager::AiStreamManager;
pub use types::{
    ChatDeltaKind, ChatDonePayload, ChatErrorPayload, ChatMessage, ChatRequestOptions,
    ChatStreamPayload, EVT_CHAT_DONE, EVT_CHAT_ERROR, EVT_CHAT_STREAM,
};
