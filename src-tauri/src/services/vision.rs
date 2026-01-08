//! Tauri command surface for Vision capabilities.
//!
//! The implementation lives in `crate::plugins::vision` (treat as a crate-local plugin).

pub use crate::plugins::vision::{ScreenCaptureResult, VlmAnalysisResult, WindowInfo};

fn vision_runtime_enabled() -> bool {
    std::env::var("RCAT_VISION")
        .or_else(|_| std::env::var("VISION_ENABLED"))
        .ok()
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "y" | "on"
            )
        })
        .unwrap_or(true)
}

fn ensure_vision_enabled() -> Result<(), String> {
    if vision_runtime_enabled() {
        Ok(())
    } else {
        Err("Vision disabled".to_string())
    }
}

#[tauri::command]
pub async fn capture_screen_text(
    window_name: Option<String>,
) -> Result<ScreenCaptureResult, String> {
    ensure_vision_enabled()?;
    crate::plugins::vision::capture_screen_text(window_name).await
}

#[tauri::command]
pub async fn analyze_screen_vlm(
    prompt: String,
    window_name: Option<String>,
) -> Result<VlmAnalysisResult, String> {
    ensure_vision_enabled()?;
    crate::plugins::vision::analyze_screen_vlm(prompt, window_name).await
}

#[tauri::command]
pub fn list_capturable_windows() -> Result<Vec<WindowInfo>, String> {
    ensure_vision_enabled()?;
    crate::plugins::vision::list_capturable_windows()
}

#[tauri::command]
pub fn get_smart_window() -> Result<Option<WindowInfo>, String> {
    ensure_vision_enabled()?;
    crate::plugins::vision::get_smart_window()
}

#[tauri::command]
pub async fn capture_smart() -> Result<ScreenCaptureResult, String> {
    ensure_vision_enabled()?;
    crate::plugins::vision::capture_smart().await
}
