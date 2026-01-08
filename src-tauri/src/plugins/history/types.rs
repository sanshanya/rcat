use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub title_auto: bool,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub last_seen_at_ms: u64,
    pub message_count: u32,
    pub last_message_at_ms: u64,
    pub last_role: String,
    pub has_unseen: bool,
    pub is_active: bool,
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub id: String,
    pub conversation_id: String,
    pub seq: u32,
    pub role: String,
    pub content: String,
    pub reasoning: Option<String>,
    pub created_at_ms: u64,
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryBootstrap {
    pub active_conversation_id: String,
    pub conversations: Vec<ConversationSummary>,
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDetail {
    pub conversation: ConversationSummary,
    pub messages: Vec<ConversationMessage>,
}
