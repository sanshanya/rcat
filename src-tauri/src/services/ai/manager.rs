use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

pub struct AiStreamManager {
    pub(super) http_client: reqwest::Client,
    // NOTE: Using std::sync::Mutex since lock is never held across .await.
    // If future logic requires holding lock across await points, switch to tokio::sync::Mutex.
    pub(super) handles: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
}

impl Default for AiStreamManager {
    fn default() -> Self {
        let http_client = reqwest::Client::builder()
            .pool_max_idle_per_host(8)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            http_client,
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl AiStreamManager {
    pub(super) fn take_handle(
        &self,
        request_id: &str,
    ) -> Result<Option<tauri::async_runtime::JoinHandle<()>>, String> {
        let mut map = self
            .handles
            .lock()
            .map_err(|_| "AI stream manager lock poisoned".to_string())?;
        Ok(map.remove(request_id))
    }
}

