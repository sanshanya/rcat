//! Tauri command surface for conversation history.
//!
//! Storage is implemented by `crate::plugins::history::HistoryStore`.

use crate::plugins::history::HistoryStore;
pub use crate::plugins::history::{
    ConversationDetail, ConversationMessage, ConversationSummary, HistoryBootstrap, HistoryError,
};

#[tauri::command]
pub async fn history_bootstrap(
    store: tauri::State<'_, HistoryStore>,
) -> Result<HistoryBootstrap, HistoryError> {
    store.bootstrap().await
}

#[tauri::command]
pub async fn history_list_conversations(
    store: tauri::State<'_, HistoryStore>,
) -> Result<Vec<ConversationSummary>, HistoryError> {
    store.list_conversations().await
}

#[tauri::command]
pub async fn history_get_conversation(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
) -> Result<ConversationDetail, HistoryError> {
    store.get_conversation(&conversation_id).await
}

#[tauri::command]
pub async fn history_get_conversation_page(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
    before_seq: Option<u32>,
    limit: Option<u32>,
) -> Result<ConversationDetail, HistoryError> {
    store
        .get_conversation_page(&conversation_id, before_seq, limit)
        .await
}

#[tauri::command]
pub async fn history_new_conversation(
    store: tauri::State<'_, HistoryStore>,
) -> Result<ConversationSummary, HistoryError> {
    store.create_conversation(None, true).await
}

#[tauri::command]
pub async fn history_set_active_conversation(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
) -> Result<(), HistoryError> {
    store.set_active_conversation_id(&conversation_id).await
}

#[tauri::command]
pub async fn history_mark_seen(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
) -> Result<(), HistoryError> {
    store.mark_seen(&conversation_id).await
}

#[tauri::command]
pub async fn history_clear_conversation(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
) -> Result<(), HistoryError> {
    store.clear_messages(&conversation_id).await
}

#[tauri::command]
pub async fn history_delete_conversation(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
) -> Result<HistoryBootstrap, HistoryError> {
    store.delete_conversation(&conversation_id).await
}

#[tauri::command]
pub async fn history_fork_conversation(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
    upto_seq: Option<u32>,
) -> Result<ConversationSummary, HistoryError> {
    store
        .fork_conversation(&conversation_id, upto_seq, true)
        .await
}

#[tauri::command]
pub async fn history_rename_conversation(
    store: tauri::State<'_, HistoryStore>,
    conversation_id: String,
    title: String,
) -> Result<(), HistoryError> {
    store.rename_conversation(&conversation_id, &title).await
}
