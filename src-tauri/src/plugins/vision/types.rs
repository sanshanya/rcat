use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Result of a screen capture and OCR operation.
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenCaptureResult {
    /// Extracted text from the screen
    pub text: String,
    /// OCR confidence score (0.0 - 1.0), None if not available
    pub confidence: Option<f64>,
    /// Unix timestamp in milliseconds when the capture was taken
    pub timestamp: u64,
    /// Window name that was captured (if specific window)
    pub window_name: Option<String>,
}

/// VLM analysis result
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VlmAnalysisResult {
    /// Analysis result from the VLM
    pub content: String,
    /// Unix timestamp in milliseconds
    pub timestamp: u64,
}

/// Detailed window metadata for smart selection.
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    /// Window title
    pub title: String,
    /// Application name (e.g., "Code", "chrome", "explorer")
    pub app_name: String,
    /// Process ID
    pub pid: u32,
    /// Whether this window is currently focused
    pub is_focused: bool,
    /// Z-order index (0 = topmost, higher = further back)
    pub z_index: usize,
    /// Whether this window is minimized
    pub is_minimized: bool,
}

pub(crate) fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

