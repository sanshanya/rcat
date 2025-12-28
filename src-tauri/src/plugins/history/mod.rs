//! Conversation history persistence backed by Turso (libSQL).
//!
//! The Tauri command surface lives in `crate::services::history`.

mod store;
mod title;
mod types;

pub use store::HistoryStore;
pub use types::{ConversationDetail, ConversationMessage, ConversationSummary, HistoryBootstrap};
