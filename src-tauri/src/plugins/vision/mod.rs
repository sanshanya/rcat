//! Vision "plugin" (crate-local module).
//!
//! - Provides screen/window capture + OCR + optional VLM analysis.
//! - Exposes helper entrypoints for AI tool-calls without coupling AI code to
//!   Tauri command modules.

mod ai_tools;
mod capture;
mod ocr;
mod types;
mod vlm;

pub use types::{ScreenCaptureResult, VlmAnalysisResult, WindowInfo};

pub(crate) fn ai_tools_schema(config: &crate::services::config::AiConfig) -> serde_json::Value {
    ai_tools::tools_schema(config)
}

pub(crate) async fn execute_ai_tool_call(
    name: &str,
    arguments: &serde_json::Value,
) -> Result<String, String> {
    ai_tools::execute_tool_call(name, arguments).await
}

pub(crate) async fn capture_screen_text(
    window_name: Option<String>,
) -> Result<ScreenCaptureResult, String> {
    let (image, captured_window) = if let Some(ref pattern) = window_name {
        let (img, name) = capture::capture_window(pattern)?;
        (img, Some(name))
    } else {
        (capture::capture_screen()?, None)
    };

    let (text, confidence) = ocr::perform_ocr(&image).await?;

    Ok(ScreenCaptureResult {
        text,
        confidence,
        timestamp: types::timestamp_ms(),
        window_name: captured_window,
    })
}

pub(crate) async fn analyze_screen_vlm(
    prompt: String,
    window_name: Option<String>,
) -> Result<VlmAnalysisResult, String> {
    vlm::analyze_screen_vlm(prompt, window_name).await
}

pub(crate) fn list_capturable_windows() -> Result<Vec<WindowInfo>, String> {
    capture::list_capturable_windows()
}

pub(crate) fn get_smart_window() -> Result<Option<WindowInfo>, String> {
    capture::get_smart_window()
}

pub(crate) async fn capture_smart() -> Result<ScreenCaptureResult, String> {
    let (image, window_name) = capture::capture_smart_image()?;
    let (text, confidence) = ocr::perform_ocr(&image).await?;

    Ok(ScreenCaptureResult {
        text,
        confidence,
        timestamp: types::timestamp_ms(),
        window_name: Some(window_name),
    })
}

