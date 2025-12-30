//! Conversation history persistence backed by Turso (libSQL).
//!
//! The Tauri command surface lives in `crate::services::history`.

mod error;
mod store;
mod title;
mod types;

pub use error::HistoryError;
pub use store::HistoryStore;
pub use types::{ConversationDetail, ConversationMessage, ConversationSummary, HistoryBootstrap};
