// src-tauri/src/services/mod.rs
pub mod ai;
pub mod config;
pub mod cursor;
pub mod history;
pub(crate) mod paths;
pub mod prompts;
pub mod retry;
#[cfg(feature = "vision")]
pub mod vision;
pub mod voice;
pub mod voice_conversation;
