//! Tauri command surface for conversation history.
//!
//! Storage is implemented by `crate::plugins::history::HistoryStore`.

use crate::plugins::history::HistoryStore;
pub use crate::plugins::history::{
    ConversationDetail, ConversationMessage, ConversationSummary, HistoryBootstrap,
};

#[tauri::command]
pub async fn history_bootstrap(
    store: tauri::State<'_, HistoryStore>,
) -> Result<HistoryBootstrap, String> {
    store.bootstrap().await
}

#[tauri::command]
pub async fn history_list_conversations(
    store: tauri::State<'_, HistoryStore>,
) -> Result<Vec<ConversationSummary>, String> {
    store.list_conversations().await
}

#[tauri::command]
pub async fn history_get_conversation(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
) -> Result<ConversationDetail, String> {
    store.get_conversation(&conversation_id).await
}

#[tauri::command]
pub async fn history_new_conversation(
    store: tauri::State<'_, HistoryStore>,
) -> Result<ConversationSummary, String> {
    store.create_conversation(None, true).await
}

#[tauri::command]
pub async fn history_set_active_conversation(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
) -> Result<(), String> {
    store.set_active_conversation_id(&conversation_id).await
}

#[tauri::command]
pub async fn history_mark_seen(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
) -> Result<(), String> {
    store.mark_seen(&conversation_id).await
}

#[tauri::command]
pub async fn history_clear_conversation(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
) -> Result<(), String> {
    store.clear_messages(&conversation_id).await
}

#[tauri::command]
pub async fn history_delete_conversation(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
) -> Result<HistoryBootstrap, String> {
    store.delete_conversation(&conversation_id).await
}
