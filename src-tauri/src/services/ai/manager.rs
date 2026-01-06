use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Default)]
pub(super) struct StreamRegistry {
    pub(super) handles: HashMap<String, tauri::async_runtime::JoinHandle<()>>,
    pub(super) by_conversation: HashMap<String, String>,
}

pub struct AiStreamManager {
    pub(super) http_client: reqwest::Client,
    // NOTE: Using std::sync::Mutex since lock is never held across .await.
    // If future logic requires holding lock across await points, switch to tokio::sync::Mutex.
    pub(super) registry: Arc<Mutex<StreamRegistry>>,
}

impl Default for AiStreamManager {
    fn default() -> Self {
        let http_client = reqwest::Client::builder()
            .pool_max_idle_per_host(8)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            http_client,
            registry: Arc::new(Mutex::new(StreamRegistry::default())),
        }
    }
}

impl AiStreamManager {
    pub(crate) fn take_request(
        &self,
        request_id: &str,
    ) -> Result<Option<(Option<String>, tauri::async_runtime::JoinHandle<()>)>, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "AI stream manager lock poisoned".to_string())?;
        let handle = registry.handles.remove(request_id);
        let Some(handle) = handle else {
            return Ok(None);
        };

        let conversation_id = registry
            .by_conversation
            .iter()
            .find(|(_, rid)| rid.as_str() == request_id)
            .map(|(cid, _)| cid.clone());

        if let Some(cid) = conversation_id.as_deref() {
            registry.by_conversation.remove(cid);
        }

        Ok(Some((conversation_id, handle)))
    }

    pub(crate) fn take_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Option<(String, tauri::async_runtime::JoinHandle<()>)>, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "AI stream manager lock poisoned".to_string())?;

        let Some(request_id) = registry.by_conversation.remove(conversation_id) else {
            return Ok(None);
        };
        let Some(handle) = registry.handles.remove(&request_id) else {
            return Ok(None);
        };

        Ok(Some((request_id, handle)))
    }
}
