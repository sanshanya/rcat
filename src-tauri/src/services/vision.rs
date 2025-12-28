//! Tauri command surface for Vision capabilities.
//!
//! The implementation lives in `crate::plugins::vision` (treat as a crate-local plugin).

pub use crate::plugins::vision::{ScreenCaptureResult, VlmAnalysisResult, WindowInfo};

#[tauri::command]
pub async fn capture_screen_text(
    window_name: Option<String>,
) -> Result<ScreenCaptureResult, String> {
    crate::plugins::vision::capture_screen_text(window_name).await
}

#[tauri::command]
pub async fn analyze_screen_vlm(
    prompt: String,
    window_name: Option<String>,
) -> Result<VlmAnalysisResult, String> {
    crate::plugins::vision::analyze_screen_vlm(prompt, window_name).await
}

#[tauri::command]
pub fn list_capturable_windows() -> Result<Vec<WindowInfo>, String> {
    crate::plugins::vision::list_capturable_windows()
}

#[tauri::command]
pub fn get_smart_window() -> Result<Option<WindowInfo>, String> {
    crate::plugins::vision::get_smart_window()
}

#[tauri::command]
pub async fn capture_smart() -> Result<ScreenCaptureResult, String> {
    crate::plugins::vision::capture_smart().await
}

