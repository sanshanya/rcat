//! Conversation history storage backed by libSQL (Turso).
//!
//! This module uses the `libsql` crate (async client) because it supports both:
//! - Remote Turso/libSQL databases via `TURSO_DATABASE_URL` / `LIBSQL_DATABASE_URL` (+ token).
//! - Local file fallback in the app `savedata` directory (`history.db`).

use std::path::PathBuf;
use std::ops::Deref;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{future::Future, time::Duration};

use libsql::{params, Builder, Database};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use crate::services::ai::ChatMessage;

use super::title;
use super::types::{
    ConversationDetail, ConversationMessage, ConversationSummary, HistoryBootstrap,
};

const APP_STATE_ACTIVE_CONVERSATION_ID: &str = "active_conversation_id";
const HISTORY_DB_BUSY_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_POOLED_CONNECTIONS: usize = 8;
const MAX_REMOTE_CONNECTIONS: usize = 8;
const MAX_LOCAL_CONNECTIONS: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DbMode {
    Remote,
    Local,
}

#[derive(Clone)]
pub struct HistoryStore {
    inner: Arc<HistoryStoreInner>,
}

struct HistoryStoreInner {
    db: Database,
    db_mode: DbMode,
    /// Serialize *writes* for local file databases to reduce SQLITE_BUSY contention.
    /// For remote Turso/libSQL, this is disabled to avoid serializing network latency.
    write_gate: Option<Arc<Semaphore>>,
    /// Bound the number of concurrent connections (important for remote and local).
    conn_gate: Arc<Semaphore>,
    conn_pool: Mutex<Vec<libsql::Connection>>,
}

/// A pooled libSQL connection (returned to the pool on drop).
struct PooledConnection {
    conn: Option<libsql::Connection>,
    store: HistoryStore,
    _permit: OwnedSemaphorePermit,
}

impl Deref for PooledConnection {
    type Target = libsql::Connection;

    fn deref(&self) -> &Self::Target {
        self.conn
            .as_ref()
            .expect("PooledConnection must hold a connection")
    }
}

impl Drop for PooledConnection {
    fn drop(&mut self) {
        let Some(conn) = self.conn.take() else {
            return;
        };

        let Ok(mut pool) = self.store.inner.conn_pool.lock() else {
            return;
        };
        if pool.len() >= MAX_POOLED_CONNECTIONS {
            return;
        }
        pool.push(conn);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn truncate_title(source: &str) -> String {
    let first_line = source.lines().next().unwrap_or(source).trim();
    let max_chars = 32usize;
    if first_line.chars().count() <= max_chars {
        return first_line.to_string();
    }
    first_line.chars().take(max_chars).collect::<String>() + "…"
}

fn new_id(prefix: &str) -> String {
    format!("{}_{}", prefix, Uuid::new_v4())
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = crate::services::paths::data_dir(app)?;
    Ok(dir.join("history.db"))
}

fn is_db_locked_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("database is locked")
        || lower.contains("sqlite failure: `database is locked`")
        || lower.contains("sqlite_busy")
        || lower.contains("sqlite busy")
        || lower.contains("database is busy")
        || lower.contains("locked")
}

async fn retry_db_locked<T, Fut, F>(mut op: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let mut delay = Duration::from_millis(25);
    for attempt in 0..5 {
        match op().await {
            Ok(v) => return Ok(v),
            Err(err) => {
                if attempt >= 4 || !is_db_locked_error(&err) {
                    return Err(err);
                }
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_millis(400));
            }
        }
    }
    Err("History DB retry exhausted".to_string())
}

async fn open_database(app: &tauri::AppHandle) -> Result<(Database, DbMode), String> {
    let url = std::env::var("TURSO_DATABASE_URL")
        .or_else(|_| std::env::var("LIBSQL_DATABASE_URL"))
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let token = std::env::var("TURSO_AUTH_TOKEN")
        .or_else(|_| std::env::var("LIBSQL_AUTH_TOKEN"))
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if let (Some(url), Some(token)) = (url, token) {
        log::info!("History DB: using remote Turso/libSQL");
        let db = Builder::new_remote(url, token)
            .build()
            .await
            .map_err(|e| e.to_string())?;
        return Ok((db, DbMode::Remote));
    }

    let path = db_path(app)?;
    let path_str = path.to_string_lossy().to_string();
    log::warn!(
        "History DB: TURSO env missing, falling back to local file {}",
        path_str
    );
    let db = Builder::new_local(path_str)
        .build()
        .await
        .map_err(|e| e.to_string())?;
    Ok((db, DbMode::Local))
}

impl HistoryStore {
    pub(crate) fn init(app: &tauri::AppHandle) -> Result<Self, String> {
        tauri::async_runtime::block_on(async {
            let (db, db_mode) = open_database(app).await?;
            let (conn_limit, write_gate) = match db_mode {
                DbMode::Remote => (MAX_REMOTE_CONNECTIONS, None),
                DbMode::Local => (MAX_LOCAL_CONNECTIONS, Some(Arc::new(Semaphore::new(1)))),
            };
            let store = Self {
                inner: Arc::new(HistoryStoreInner {
                    db,
                    db_mode,
                    write_gate,
                    conn_gate: Arc::new(Semaphore::new(conn_limit)),
                    conn_pool: Mutex::new(Vec::new()),
                }),
            };
            store.migrate().await?;
            Ok(store)
        })
    }

    async fn connect(&self) -> Result<PooledConnection, String> {
        let permit = self
            .inner
            .conn_gate
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| "History DB connection gate closed".to_string())?;

        if let Ok(mut pool) = self.inner.conn_pool.lock() {
            if let Some(conn) = pool.pop() {
                return Ok(PooledConnection {
                    conn: Some(conn),
                    store: self.clone(),
                    _permit: permit,
                });
            }
        }

        let conn = self.inner.db.connect().map_err(|e| e.to_string())?;

        // Best-effort per-connection pragmas.
        // - Local mode: reduce SQLITE_BUSY + enable FK constraints.
        // - Remote mode: pragmas may be ignored; that's OK.
        if self.inner.db_mode == DbMode::Local {
            let _ = conn.busy_timeout(HISTORY_DB_BUSY_TIMEOUT);
            let _ = conn.query("PRAGMA journal_mode = WAL;", ()).await;
            let _ = conn.query("PRAGMA synchronous = NORMAL;", ()).await;
        }
        let _ = conn.query("PRAGMA foreign_keys = ON;", ()).await;

        Ok(PooledConnection {
            conn: Some(conn),
            store: self.clone(),
            _permit: permit,
        })
    }

    async fn write_permit(&self) -> Result<Option<OwnedSemaphorePermit>, String> {
        let Some(gate) = self.inner.write_gate.as_ref() else {
            return Ok(None);
        };
        gate.clone()
            .acquire_owned()
            .await
            .map(Some)
            .map_err(|_| "History DB write gate closed".to_string())
    }

    async fn migrate(&self) -> Result<(), String> {
        let conn = self.connect().await?;

        // Reduce lock contention for the local SQLite file.
        if self.inner.db_mode == DbMode::Local {
            let _ = conn.query("PRAGMA journal_mode = WAL;", ()).await;
            let _ = conn.query("PRAGMA synchronous = NORMAL;", ()).await;
        }

        conn.execute(
            "CREATE TABLE IF NOT EXISTS app_state (\n  key TEXT PRIMARY KEY NOT NULL,\n  value TEXT NOT NULL\n);",
            (),
        )
        .await
        .map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS conversations (\n  id TEXT PRIMARY KEY NOT NULL,\n  title TEXT NOT NULL,\n  title_auto INTEGER NOT NULL DEFAULT 0,\n  created_at_ms INTEGER NOT NULL,\n  updated_at_ms INTEGER NOT NULL,\n  last_seen_at_ms INTEGER NOT NULL,\n  archived INTEGER NOT NULL DEFAULT 0\n);",
            (),
        )
        .await
        .map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS messages (\n  id TEXT PRIMARY KEY NOT NULL,\n  conversation_id TEXT NOT NULL,\n  seq INTEGER NOT NULL,\n  role TEXT NOT NULL,\n  content TEXT NOT NULL,\n  reasoning TEXT,\n  created_at_ms INTEGER NOT NULL,\n  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE\n);",
            (),
        )
        .await
        .map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq ON messages(conversation_id, seq);",
            (),
        )
        .await
        .map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at_ms);",
            (),
        )
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub(crate) async fn bootstrap(&self) -> Result<HistoryBootstrap, String> {
        let active_id = match self.get_active_conversation_id().await? {
            Some(id) if self.conversation_exists(&id).await? => id,
            _ => self.create_conversation(None, true).await?.id,
        };

        let conversations = self.list_conversations().await?;

        Ok(HistoryBootstrap {
            active_conversation_id: active_id,
            conversations,
        })
    }

    pub(crate) async fn list_conversations(&self) -> Result<Vec<ConversationSummary>, String> {
        let conn = self.connect().await?;
        let active_id = self.get_active_conversation_id_from_conn(&conn).await?;

        let mut rows = conn
            .query(
                "SELECT c.id, c.title, c.title_auto, c.created_at_ms, c.updated_at_ms, c.last_seen_at_ms,\n        COALESCE(COUNT(m.id), 0)\n   FROM conversations c\n   LEFT JOIN messages m ON m.conversation_id = c.id\n  WHERE c.archived = 0\n  GROUP BY c.id\n  ORDER BY c.updated_at_ms DESC\n  LIMIT 50;",
                (),
            )
            .await
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let title: String = row.get(1).map_err(|e| e.to_string())?;
            let title_auto_i: i64 = row.get(2).map_err(|e| e.to_string())?;
            let created_at_ms: i64 = row.get(3).map_err(|e| e.to_string())?;
            let updated_at_ms: i64 = row.get(4).map_err(|e| e.to_string())?;
            let last_seen_at_ms: i64 = row.get(5).map_err(|e| e.to_string())?;
            let message_count: i64 = row.get(6).map_err(|e| e.to_string())?;

            let has_unseen = updated_at_ms > last_seen_at_ms;
            let is_active = active_id.as_deref() == Some(id.as_str());

            out.push(ConversationSummary {
                id,
                title,
                title_auto: title_auto_i != 0,
                created_at_ms: created_at_ms.max(0) as u64,
                updated_at_ms: updated_at_ms.max(0) as u64,
                last_seen_at_ms: last_seen_at_ms.max(0) as u64,
                message_count: message_count.max(0) as u32,
                has_unseen,
                is_active,
            });
        }

        Ok(out)
    }

    pub(crate) async fn get_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationDetail, String> {
        let conn = self.connect().await?;
        let active_id = self.get_active_conversation_id_from_conn(&conn).await?;

        let mut conv_rows = conn
            .query(
                "SELECT id, title, title_auto, created_at_ms, updated_at_ms, last_seen_at_ms\n   FROM conversations\n  WHERE id = ?1 AND archived = 0\n  LIMIT 1;",
                params![conversation_id],
            )
            .await
            .map_err(|e| e.to_string())?;

        let conv_row = conv_rows
            .next()
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Conversation not found".to_string())?;

        let id: String = conv_row.get(0).map_err(|e| e.to_string())?;
        let title_str: String = conv_row.get(1).map_err(|e| e.to_string())?;
        let title_auto_i: i64 = conv_row.get(2).map_err(|e| e.to_string())?;
        let created_at_ms: i64 = conv_row.get(3).map_err(|e| e.to_string())?;
        let updated_at_ms: i64 = conv_row.get(4).map_err(|e| e.to_string())?;
        let last_seen_at_ms: i64 = conv_row.get(5).map_err(|e| e.to_string())?;

        let mut msg_rows = conn
            .query(
                "SELECT id, seq, role, content, reasoning, created_at_ms\n   FROM messages\n  WHERE conversation_id = ?1\n  ORDER BY seq ASC;",
                params![conversation_id],
            )
            .await
            .map_err(|e| e.to_string())?;

        let mut messages = Vec::new();
        while let Some(row) = msg_rows.next().await.map_err(|e| e.to_string())? {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let seq: i64 = row.get(1).map_err(|e| e.to_string())?;
            let role: String = row.get(2).map_err(|e| e.to_string())?;
            let content: String = row.get(3).map_err(|e| e.to_string())?;
            let reasoning: Option<String> = row.get(4).ok();
            let created_at_ms: i64 = row.get(5).map_err(|e| e.to_string())?;

            messages.push(ConversationMessage {
                id,
                conversation_id: conversation_id.to_string(),
                seq: seq.max(0) as u32,
                role,
                content,
                reasoning,
                created_at_ms: created_at_ms.max(0) as u64,
            });
        }

        let message_count = messages.len() as u32;
        let has_unseen = updated_at_ms > last_seen_at_ms;
        let is_active = active_id.as_deref() == Some(conversation_id);

        Ok(ConversationDetail {
            conversation: ConversationSummary {
                id,
                title: title_str,
                title_auto: title_auto_i != 0,
                created_at_ms: created_at_ms.max(0) as u64,
                updated_at_ms: updated_at_ms.max(0) as u64,
                last_seen_at_ms: last_seen_at_ms.max(0) as u64,
                message_count,
                has_unseen,
                is_active,
            },
            messages,
        })
    }

    pub(crate) async fn create_conversation(
        &self,
        title: Option<String>,
        set_active: bool,
    ) -> Result<ConversationSummary, String> {
        let id = new_id("conv");
        let now = now_ms() as i64;
        let title = title
            .as_deref()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| "新对话".to_string());

        retry_db_locked(|| async {
            let _write = self.write_permit().await?;
            let conn = self.connect().await?;
            let tx = conn.transaction().await.map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO conversations (id, title, title_auto, created_at_ms, updated_at_ms, last_seen_at_ms, archived)\nVALUES (?1, ?2, 0, ?3, ?3, ?3, 0);",
                params![id.as_str(), title.as_str(), now],
            )
            .await
            .map_err(|e| e.to_string())?;

            if set_active {
                tx.execute(
                    "INSERT INTO app_state (key, value) VALUES (?1, ?2)\nON CONFLICT(key) DO UPDATE SET value = excluded.value;",
                    params![APP_STATE_ACTIVE_CONVERSATION_ID, id.as_str()],
                )
                .await
                .map_err(|e| e.to_string())?;
            }

            tx.commit().await.map_err(|e| e.to_string())?;

            Ok(ConversationSummary {
                id: id.clone(),
                title: title.clone(),
                title_auto: false,
                created_at_ms: now.max(0) as u64,
                updated_at_ms: now.max(0) as u64,
                last_seen_at_ms: now.max(0) as u64,
                message_count: 0,
                has_unseen: false,
                is_active: set_active,
            })
        })
        .await
    }

    pub(crate) async fn set_active_conversation_id(
        &self,
        conversation_id: &str,
    ) -> Result<(), String> {
        if !self.conversation_exists(conversation_id).await? {
            return Err("Conversation not found".to_string());
        }

        retry_db_locked(|| async {
            let _write = self.write_permit().await?;
            let conn = self.connect().await?;
            conn.execute(
                "INSERT INTO app_state (key, value) VALUES (?1, ?2)\nON CONFLICT(key) DO UPDATE SET value = excluded.value;",
                params![APP_STATE_ACTIVE_CONVERSATION_ID, conversation_id],
            )
            .await
            .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
    }

    pub(crate) async fn mark_seen(&self, conversation_id: &str) -> Result<(), String> {
        retry_db_locked(|| async {
            let _write = self.write_permit().await?;
            let conn = self.connect().await?;
            conn.execute(
                "UPDATE conversations SET last_seen_at_ms = updated_at_ms WHERE id = ?1;",
                params![conversation_id],
            )
            .await
            .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
    }

    #[allow(dead_code)]
    pub(crate) async fn rename_conversation(
        &self,
        conversation_id: &str,
        title: &str,
    ) -> Result<(), String> {
        let title = title.trim();
        if title.is_empty() {
            return Err("Title is empty".to_string());
        }

        let _write = self.write_permit().await?;
        let conn = self.connect().await?;
        conn.execute(
            "UPDATE conversations SET title = ?2, title_auto = 0, updated_at_ms = updated_at_ms WHERE id = ?1;",
            params![conversation_id, title],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) async fn clear_messages(&self, conversation_id: &str) -> Result<(), String> {
        retry_db_locked(|| async {
            let _write = self.write_permit().await?;
            let conn = self.connect().await?;
            conn.execute(
                "DELETE FROM messages WHERE conversation_id = ?1;",
                params![conversation_id],
            )
            .await
            .map_err(|e| e.to_string())?;

            let now = now_ms() as i64;
            conn.execute(
                "UPDATE conversations SET updated_at_ms = ?2, last_seen_at_ms = ?2 WHERE id = ?1;",
                params![conversation_id, now],
            )
            .await
            .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
    }

    pub(crate) async fn delete_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<HistoryBootstrap, String> {
        let active_conversation_id = retry_db_locked(|| async {
            let _write = self.write_permit().await?;
            let conn = self.connect().await?;

            let mut exists_rows = conn
                .query(
                    "SELECT 1 FROM conversations WHERE id = ?1 AND archived = 0 LIMIT 1;",
                    params![conversation_id],
                )
                .await
                .map_err(|e| e.to_string())?;
            if exists_rows
                .next()
                .await
                .map_err(|e| e.to_string())?
                .is_none()
            {
                return Err("Conversation not found".to_string());
            }

            let mut active_rows = conn
                .query(
                    "SELECT value FROM app_state WHERE key = ?1 LIMIT 1;",
                    params![APP_STATE_ACTIVE_CONVERSATION_ID],
                )
                .await
                .map_err(|e| e.to_string())?;
            let mut active_id = active_rows
                .next()
                .await
                .map_err(|e| e.to_string())?
                .and_then(|row| row.get::<String>(0).ok())
                .filter(|id| !id.trim().is_empty());

            // Treat missing/invalid active IDs as absent so we can recover automatically.
            if let Some(id) = active_id.as_deref() {
                let mut valid_rows = conn
                    .query(
                        "SELECT 1 FROM conversations WHERE id = ?1 AND archived = 0 LIMIT 1;",
                        params![id],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                if valid_rows
                    .next()
                    .await
                    .map_err(|e| e.to_string())?
                    .is_none()
                {
                    active_id = None;
                }
            }

            let needs_new_active =
                active_id.as_deref() == Some(conversation_id) || active_id.is_none();

            let now = now_ms() as i64;
            let tx = conn.transaction().await.map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE conversations SET archived = 1 WHERE id = ?1;",
                params![conversation_id],
            )
            .await
            .map_err(|e| e.to_string())?;

            let next_active_id = if needs_new_active {
                let mut next_rows = tx
                    .query(
                        "SELECT id FROM conversations WHERE archived = 0 AND id <> ?1 ORDER BY updated_at_ms DESC LIMIT 1;",
                        params![conversation_id],
                    )
                    .await
                    .map_err(|e| e.to_string())?;

                let next_id = next_rows
                    .next()
                    .await
                    .map_err(|e| e.to_string())?
                    .and_then(|row| row.get::<String>(0).ok())
                    .filter(|id| !id.trim().is_empty());

                if let Some(id) = next_id {
                    id
                } else {
                    let id = new_id("conv");
                    tx.execute(
                        "INSERT INTO conversations (id, title, title_auto, created_at_ms, updated_at_ms, last_seen_at_ms, archived)\nVALUES (?1, '新对话', 0, ?2, ?2, ?2, 0);",
                        params![id.as_str(), now],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    id
                }
            } else {
                active_id.unwrap()
            };

            if needs_new_active {
                tx.execute(
                    "INSERT INTO app_state (key, value) VALUES (?1, ?2)\nON CONFLICT(key) DO UPDATE SET value = excluded.value;",
                    params![APP_STATE_ACTIVE_CONVERSATION_ID, next_active_id.as_str()],
                )
                .await
                .map_err(|e| e.to_string())?;
            }

            tx.commit().await.map_err(|e| e.to_string())?;
            Ok(next_active_id)
        })
        .await?;

        let conversations = self.list_conversations().await?;
        Ok(HistoryBootstrap {
            active_conversation_id,
            conversations,
        })
    }

    pub(crate) async fn sync_from_frontend_messages(
        &self,
        conversation_id: &str,
        messages: &[ChatMessage],
    ) -> Result<(), String> {
        retry_db_locked(|| async {
            let _write = self.write_permit().await?;
            let conn = self.connect().await?;
            let now = now_ms() as i64;

            let mut meta_rows = conn
                .query(
                    "SELECT archived FROM conversations WHERE id = ?1 LIMIT 1;",
                    params![conversation_id],
                )
                .await
                .map_err(|e| e.to_string())?;
            if let Some(row) = meta_rows.next().await.map_err(|e| e.to_string())? {
                let archived: i64 = row.get(0).map_err(|e| e.to_string())?;
                if archived != 0 {
                    return Err("Conversation is archived".to_string());
                }
            }

            // Ensure the conversation row exists even if the frontend sent an ID we haven't seen yet.
            conn.execute(
                "INSERT OR IGNORE INTO conversations (id, title, title_auto, created_at_ms, updated_at_ms, last_seen_at_ms, archived)\nVALUES (?1, '新对话', 0, ?2, ?2, ?2, 0);",
                params![conversation_id, now],
            )
            .await
            .map_err(|e| e.to_string())?;

            let tx = conn.transaction().await.map_err(|e| e.to_string())?;
            let non_system: Vec<&ChatMessage> =
                messages.iter().filter(|m| m.role != "system").collect();
            let desired_len = non_system.len() as i64;

            // Truncate any messages past the provided history (supports edit/regenerate flows).
            tx.execute(
                "DELETE FROM messages WHERE conversation_id = ?1 AND seq > ?2;",
                params![conversation_id, desired_len],
            )
            .await
            .map_err(|e| e.to_string())?;

            // Upsert messages by stable (conversation_id:seq) key.
            for (idx, m) in non_system.iter().enumerate() {
                let seq = (idx + 1) as i64;
                let id = format!("{conversation_id}:{seq}");
                tx.execute(
                    "INSERT INTO messages (id, conversation_id, seq, role, content, reasoning, created_at_ms)\nVALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)\nON CONFLICT(id) DO UPDATE SET\n  role = excluded.role,\n  content = excluded.content,\n  reasoning = CASE\n    WHEN excluded.role = 'assistant' THEN COALESCE(messages.reasoning, excluded.reasoning)\n    ELSE NULL\n  END;",
                    params![id.as_str(), conversation_id, seq, m.role.as_str(), m.content.as_str(), now],
                )
                .await
                .map_err(|e| e.to_string())?;
            }

            tx.execute(
                "UPDATE conversations SET updated_at_ms = ?2 WHERE id = ?1;",
                params![conversation_id, now],
            )
            .await
            .map_err(|e| e.to_string())?;

            tx.commit().await.map_err(|e| e.to_string())?;

            // Set title to the first user prompt when the conversation is still placeholder.
            if let Some(first_user) = messages.iter().find(|m| m.role == "user") {
                self.maybe_set_title_from_first_user_with_conn(
                    &conn,
                    conversation_id,
                    &first_user.content,
                )
                .await?;
            }

            Ok(())
        })
        .await
    }

    pub(crate) async fn append_assistant_message(
        &self,
        conversation_id: &str,
        content: String,
        reasoning: Option<String>,
    ) -> Result<(), String> {
        let conversation_id = conversation_id.to_string();
        retry_db_locked(|| {
            let conversation_id = conversation_id.clone();
            let content = content.clone();
            let reasoning = reasoning.clone();
            async move {
                let _write = self.write_permit().await?;
                let conn = self.connect().await?;

                let tx = conn.transaction().await.map_err(|e| e.to_string())?;

                let mut meta_rows = tx
                    .query(
                        "SELECT archived FROM conversations WHERE id = ?1 LIMIT 1;",
                        params![conversation_id.as_str()],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let Some(meta) = meta_rows.next().await.map_err(|e| e.to_string())? else {
                    return Err("Conversation not found".to_string());
                };
                let archived: i64 = meta.get(0).map_err(|e| e.to_string())?;
                if archived != 0 {
                    return Err("Conversation is archived".to_string());
                }

                let now = now_ms() as i64;
                tx.execute(
                    "WITH next(seq) AS (\n  SELECT COALESCE(MAX(seq), 0) + 1\n    FROM messages\n   WHERE conversation_id = ?1\n)\nINSERT INTO messages (id, conversation_id, seq, role, content, reasoning, created_at_ms)\nSELECT ?1 || ':' || next.seq, ?1, next.seq, 'assistant', ?2, ?3, ?4\n  FROM next;",
                    params![conversation_id.as_str(), content, reasoning, now],
                )
                .await
                .map_err(|e| e.to_string())?;

                tx.execute(
                    "UPDATE conversations SET updated_at_ms = ?2 WHERE id = ?1;",
                    params![conversation_id.as_str(), now],
                )
                .await
                .map_err(|e| e.to_string())?;

                tx.commit().await.map_err(|e| e.to_string())?;
                Ok(())
            }
        })
        .await?;

        self.maybe_spawn_auto_title(&conversation_id).await;
        Ok(())
    }

    async fn maybe_set_title_from_first_user_with_conn(
        &self,
        conn: &libsql::Connection,
        conversation_id: &str,
        content: &str,
    ) -> Result<(), String> {
        let mut rows = conn
            .query(
                "SELECT title, title_auto FROM conversations WHERE id = ?1 LIMIT 1;",
                params![conversation_id],
            )
            .await
            .map_err(|e| e.to_string())?;
        let Some(row) = rows.next().await.map_err(|e| e.to_string())? else {
            return Ok(());
        };

        let title_current: String = row.get(0).map_err(|e| e.to_string())?;
        let title_auto_i: i64 = row.get(1).map_err(|e| e.to_string())?;
        let is_placeholder =
            title_auto_i == 0 && (title_current.trim().is_empty() || title_current == "新对话");
        if !is_placeholder {
            return Ok(());
        }

        let next_title = truncate_title(content);
        if next_title.is_empty() {
            return Ok(());
        }

        conn.execute(
            "UPDATE conversations SET title = ?2, title_auto = 0 WHERE id = ?1;",
            params![conversation_id, next_title],
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn maybe_spawn_auto_title(&self, conversation_id: &str) {
        let store = self.clone();
        let conversation_id = conversation_id.to_string();

        tauri::async_runtime::spawn(async move {
            if let Err(err) = store
                .generate_and_set_title_if_needed(&conversation_id)
                .await
            {
                log::debug!("Auto-title skipped: {}", err);
            }
        });
    }

    async fn generate_and_set_title_if_needed(&self, conversation_id: &str) -> Result<(), String> {
        // Important: do not hold a DB connection while calling the AI model for title generation
        // (network-bound). That would reduce DB concurrency and can amplify lock contention in
        // local mode.
        let messages = {
            let conn = self.connect().await?;

            let mut meta_rows = conn
                .query(
                    "SELECT title_auto FROM conversations WHERE id = ?1 LIMIT 1;",
                    params![conversation_id],
                )
                .await
                .map_err(|e| e.to_string())?;
            let Some(meta) = meta_rows.next().await.map_err(|e| e.to_string())? else {
                return Err("Conversation not found".to_string());
            };
            let title_auto_i: i64 = meta.get(0).map_err(|e| e.to_string())?;
            if title_auto_i != 0 {
                return Err("Title already auto-generated".to_string());
            }

            let mut count_rows = conn
                .query(
                    "SELECT COALESCE(SUM(CASE WHEN role='user' THEN 1 ELSE 0 END), 0) FROM messages WHERE conversation_id = ?1;",
                    params![conversation_id],
                )
                .await
                .map_err(|e| e.to_string())?;
            let user_count: i64 = count_rows
                .next()
                .await
                .map_err(|e| e.to_string())?
                .map(|r| r.get::<i64>(0).unwrap_or(0))
                .unwrap_or(0);

            if user_count < 2 {
                return Err("Not enough turns for title generation".to_string());
            }

            let mut msg_rows = conn
                .query(
                    "SELECT id, seq, role, content, reasoning, created_at_ms\n   FROM messages\n  WHERE conversation_id = ?1\n  ORDER BY seq ASC\n  LIMIT 12;",
                    params![conversation_id],
                )
                .await
                .map_err(|e| e.to_string())?;

            let mut messages = Vec::new();
            while let Some(row) = msg_rows.next().await.map_err(|e| e.to_string())? {
                messages.push(ConversationMessage {
                    id: row.get(0).unwrap_or_default(),
                    conversation_id: conversation_id.to_string(),
                    seq: (row.get::<i64>(1).unwrap_or(0)).max(0) as u32,
                    role: row.get(2).unwrap_or_default(),
                    content: row.get(3).unwrap_or_default(),
                    reasoning: row.get(4).ok(),
                    created_at_ms: (row.get::<i64>(5).unwrap_or(0)).max(0) as u64,
                });
            }

            messages
        };

        let generated = title::generate_title(&messages).await?;
        let generated = truncate_title(&generated);

        if generated.is_empty() {
            return Err("Generated title is empty".to_string());
        }

        let _write = self.write_permit().await?;
        let conn = self.connect().await?;
        conn.execute(
            "UPDATE conversations SET title = ?2, title_auto = 1 WHERE id = ?1 AND title_auto = 0;",
            params![conversation_id, generated],
        )
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    async fn get_active_conversation_id_from_conn(
        &self,
        conn: &libsql::Connection,
    ) -> Result<Option<String>, String> {
        let mut rows = conn
            .query(
                "SELECT value FROM app_state WHERE key = ?1 LIMIT 1;",
                params![APP_STATE_ACTIVE_CONVERSATION_ID],
            )
            .await
            .map_err(|e| e.to_string())?;

        let Some(row) = rows.next().await.map_err(|e| e.to_string())? else {
            return Ok(None);
        };
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(Some(id))
    }

    async fn get_active_conversation_id(&self) -> Result<Option<String>, String> {
        let conn = self.connect().await?;
        self.get_active_conversation_id_from_conn(&conn).await
    }

    async fn conversation_exists(&self, conversation_id: &str) -> Result<bool, String> {
        let conn = self.connect().await?;
        let mut rows = conn
            .query(
                "SELECT 1 FROM conversations WHERE id = ?1 AND archived = 0 LIMIT 1;",
                params![conversation_id],
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(rows.next().await.map_err(|e| e.to_string())?.is_some())
    }
}
