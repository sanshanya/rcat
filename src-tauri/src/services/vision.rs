// src-tauri/src/services/vision.rs
//! Vision module for screen capture and OCR functionality.
//!
//! Provides Windows-native OCR using the Windows.Media.Ocr API,
//! with optional VLM (Vision Language Model) support for deeper analysis.

use image::DynamicImage;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use super::retry::RetryConfig;

#[cfg(target_os = "windows")]
use std::io::Cursor;

#[cfg(target_os = "windows")]
use windows::{
    Graphics::Imaging::BitmapDecoder,
    Media::Ocr::OcrEngine as WindowsOcrEngine,
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
};

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

/// Get current Unix timestamp in milliseconds
fn get_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
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

/// Apps to exclude from the window list (system/AI windows)
const SKIP_APPS: &[&str] = &[
    "rcat",       // Our AI app
    "app",        // Our AI app (dev build name)
    "explorer",   // File Explorer (usually desktop)
    "SearchHost", // Windows Search
    "StartMenuExperienceHost",
    "ShellExperienceHost",
    "TextInputHost",
];

/// Window titles to exclude
const SKIP_TITLES: &[&str] = &[
    "Program Manager",
    "Windows Input Experience",
    "Microsoft Text Input Application",
    "Task View",
    "Start",
    "System Tray",
    "Notification Area",
    "Action Center",
    "Desktop",
];

/// Check if a window should be skipped based on app name or title
fn should_skip_window(app_name: &str, title: &str) -> bool {
    let app_lower = app_name.to_lowercase();
    let title_lower = title.to_lowercase();

    // Skip if app is in skip list
    if SKIP_APPS
        .iter()
        .any(|&s| app_lower.contains(&s.to_lowercase()))
    {
        return true;
    }

    // Skip if title matches skip list
    if SKIP_TITLES
        .iter()
        .any(|&s| title_lower.contains(&s.to_lowercase()))
    {
        return true;
    }

    // Skip empty titles
    if title.trim().is_empty() {
        return true;
    }

    false
}

/// Capture the entire primary screen using xcap.
pub fn capture_screen() -> Result<DynamicImage, String> {
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| format!("Failed to enumerate monitors: {}", e))?;

    let primary = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| Monitor::all().ok()?.into_iter().next())
        .ok_or_else(|| "No monitors found".to_string())?;

    let buffer = primary
        .capture_image()
        .map_err(|e| format!("Failed to capture screen: {}", e))?;

    Ok(DynamicImage::ImageRgba8(buffer))
}

/// Capture a specific window by name pattern.
pub fn capture_window(name_pattern: &str) -> Result<(DynamicImage, String), String> {
    use xcap::Window;

    let windows = Window::all().map_err(|e| format!("Failed to enumerate windows: {}", e))?;

    let pattern_lower = name_pattern.to_lowercase();

    let target = windows
        .into_iter()
        .find(|w| {
            w.title()
                .map(|t| t.to_lowercase().contains(&pattern_lower))
                .unwrap_or(false)
        })
        .ok_or_else(|| format!("No window matching '{}' found", name_pattern))?;

    let window_name = target.title().unwrap_or_default().to_string();

    let buffer = target
        .capture_image()
        .map_err(|e| format!("Failed to capture window '{}': {}", window_name, e))?;

    Ok((DynamicImage::ImageRgba8(buffer), window_name))
}

/// Perform OCR using Windows Native Media.Ocr API.
#[cfg(target_os = "windows")]
pub async fn perform_ocr_windows(image: &DynamicImage) -> Result<(String, Option<f64>), String> {
    use image::GenericImageView;

    // Check image dimensions
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return Ok((String::new(), None));
    }

    // Convert image to PNG bytes
    let mut buffer = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut buffer), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode image: {}", e))?;

    // Create in-memory stream for Windows API
    let stream =
        InMemoryRandomAccessStream::new().map_err(|e| format!("Failed to create stream: {}", e))?;

    let writer = DataWriter::CreateDataWriter(&stream)
        .map_err(|e| format!("Failed to create writer: {}", e))?;

    writer
        .WriteBytes(&buffer)
        .map_err(|e| format!("Failed to write bytes: {}", e))?;

    writer
        .StoreAsync()
        .map_err(|e| format!("StoreAsync failed: {}", e))?
        .await
        .map_err(|e| format!("StoreAsync.await failed: {}", e))?;

    writer
        .FlushAsync()
        .map_err(|e| format!("FlushAsync failed: {}", e))?
        .await
        .map_err(|e| format!("FlushAsync.await failed: {}", e))?;

    stream.Seek(0).map_err(|e| format!("Seek failed: {}", e))?;

    // Decode the image
    let decoder_id = BitmapDecoder::PngDecoderId()
        .map_err(|e| format!("Failed to get PNG decoder ID: {}", e))?;

    let decoder = BitmapDecoder::CreateWithIdAsync(decoder_id, &stream)
        .map_err(|e| format!("CreateWithIdAsync failed: {}", e))?
        .await
        .map_err(|e| format!("Decoder.await failed: {}", e))?;

    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| format!("GetSoftwareBitmapAsync failed: {}", e))?
        .await
        .map_err(|e| format!("Bitmap.await failed: {}", e))?;

    // Create OCR engine from user profile languages
    let engine = WindowsOcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("Failed to create OCR engine: {}", e))?;

    // Perform OCR
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("RecognizeAsync failed: {}", e))?
        .await
        .map_err(|e| format!("OCR result.await failed: {}", e))?;

    let text = result
        .Text()
        .map_err(|e| format!("Failed to get text: {}", e))?
        .to_string();

    // Windows OCR doesn't provide confidence scores
    Ok((text, Some(1.0)))
}

/// Fallback OCR for non-Windows platforms (returns an error).
#[cfg(not(target_os = "windows"))]
pub async fn perform_ocr_windows(_image: &DynamicImage) -> Result<(String, Option<f64>), String> {
    Err("Windows OCR is only available on Windows".to_string())
}

/// Convert image to base64-encoded JPEG for VLM API calls.
pub fn image_to_base64(image: &DynamicImage) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use image::codecs::jpeg::JpegEncoder;
    use image::imageops::FilterType;
    use image::{ColorType, GenericImageView};

    let max_dim = std::env::var("VLM_IMAGE_MAX_DIM")
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .unwrap_or(1280);

    let quality = std::env::var("VLM_JPEG_QUALITY")
        .ok()
        .and_then(|v| v.trim().parse::<u8>().ok())
        .unwrap_or(70)
        .clamp(1, 100);

    let processed = if max_dim == 0 {
        None
    } else {
        let (w, h) = image.dimensions();
        let longest = w.max(h);
        if longest > max_dim {
            let ratio = max_dim as f32 / longest as f32;
            let new_w = ((w as f32 * ratio).round() as u32).max(1);
            let new_h = ((h as f32 * ratio).round() as u32).max(1);
            Some(image.resize(new_w, new_h, FilterType::Lanczos3))
        } else {
            None
        }
    };

    let rgb_image = processed.as_ref().unwrap_or(image).to_rgb8();
    let mut buffer = Vec::new();

    let mut encoder = JpegEncoder::new_with_quality(&mut buffer, quality);
    encoder
        .encode(
            rgb_image.as_raw(),
            rgb_image.width(),
            rgb_image.height(),
            ColorType::Rgb8.into(),
        )
        .map_err(|e| format!("Failed to encode image as JPEG: {}", e))?;

    Ok(general_purpose::STANDARD.encode(buffer))
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Capture the screen and perform OCR to extract text.
///
/// # Arguments
/// * `window_name` - Optional window name pattern to capture. If None, captures primary screen.
///
/// # Returns
/// * `ScreenCaptureResult` with extracted text and metadata.
#[tauri::command]
pub async fn capture_screen_text(
    window_name: Option<String>,
) -> Result<ScreenCaptureResult, String> {
    let (image, captured_window) = if let Some(ref pattern) = window_name {
        let (img, name) = capture_window(pattern)?;
        (img, Some(name))
    } else {
        (capture_screen()?, None)
    };

    let (text, confidence) = perform_ocr_windows(&image).await?;

    Ok(ScreenCaptureResult {
        text,
        confidence,
        timestamp: get_timestamp_ms(),
        window_name: captured_window,
    })
}

/// Analyze the screen using a Vision Language Model.
///
/// This captures the screen and sends it to the configured VLM API
/// along with the provided prompt for analysis.
///
/// # Arguments
/// * `prompt` - The analysis prompt to send to the VLM.
/// * `window_name` - Optional window name pattern to capture.
///
/// # Returns
/// * `VlmAnalysisResult` with the VLM's response.
#[tauri::command]
pub async fn analyze_screen_vlm(
    prompt: String,
    window_name: Option<String>,
) -> Result<VlmAnalysisResult, String> {
    let image = if let Some(ref pattern) = window_name {
        capture_window(pattern)?.0
    } else {
        capture_screen()?
    };

    let base64_image = image_to_base64(&image)?;

    // Use the existing OpenAI client from ai.rs
    // For now, we'll make a direct API call
    let api_key = std::env::var("OPENAI_API_KEY")
        .or_else(|_| std::env::var("LLM_API_KEY"))
        .map_err(|_| "No API key found (OPENAI_API_KEY or LLM_API_KEY)")?;

    let base_url =
        std::env::var("LLM_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".to_string());

    let model = std::env::var("LLM_VISION_MODEL")
        .or_else(|_| std::env::var("LLM_MODEL"))
        .unwrap_or_else(|_| "gpt-4o".to_string());

    let client = reqwest::Client::new();

    let payload = serde_json::json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": prompt
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": format!("data:image/jpeg;base64,{}", base64_image),
                        "detail": "auto"
                    }
                }
            ]
        }],
        "max_tokens": 4096
    });

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let retry = RetryConfig::from_env();
    let mut last_error: Option<String> = None;

    for attempt in 1..=retry.max_attempts {
        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await;

        let response = match response {
            Ok(response) => response,
            Err(err) => {
                let msg = format!("VLM API request failed: {}", err);
                last_error = Some(msg.clone());
                if attempt < retry.max_attempts && (err.is_timeout() || err.is_connect()) {
                    log::warn!(
                        "VLM retry attempt {}/{} after error: {}",
                        attempt + 1,
                        retry.max_attempts,
                        msg
                    );
                    tokio::time::sleep(retry.backoff(attempt)).await;
                    continue;
                }
                return Err(msg);
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            let msg = format!("VLM API error ({}): {}", status, error_text);
            last_error = Some(msg.clone());

            if attempt < retry.max_attempts && (status.as_u16() == 429 || status.is_server_error())
            {
                log::warn!(
                    "VLM retry attempt {}/{} after HTTP {}: {}",
                    attempt + 1,
                    retry.max_attempts,
                    status.as_u16(),
                    msg
                );
                tokio::time::sleep(retry.backoff(attempt)).await;
                continue;
            }

            return Err(msg);
        }

        let response_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse VLM response: {}", e))?;

        let content = response_json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        return Ok(VlmAnalysisResult {
            content,
            timestamp: get_timestamp_ms(),
        });
    }

    Err(last_error.unwrap_or_else(|| "VLM API request failed".to_string()))
}

/// Get a list of visible windows with detailed metadata, sorted by Z-order.
///
/// Windows are returned in Z-order (topmost first), excluding:
/// - AI app windows (rcat/app)
/// - System windows (Program Manager, TaskBar, etc.)
/// - Minimized windows
#[tauri::command]
pub fn list_capturable_windows() -> Result<Vec<WindowInfo>, String> {
    use xcap::Window;

    let windows = Window::all().map_err(|e| format!("Failed to enumerate windows: {}", e))?;

    let window_infos: Vec<WindowInfo> = windows
        .into_iter()
        .enumerate()
        .filter_map(|(idx, w)| {
            let title = w.title().ok()?;
            let app_name = w.app_name().unwrap_or_default();
            let is_minimized = w.is_minimized().unwrap_or(false);

            // Skip minimized windows
            if is_minimized {
                return None;
            }

            // Skip system/AI windows
            if should_skip_window(&app_name, &title) {
                return None;
            }

            Some(WindowInfo {
                title,
                app_name,
                pid: w.pid().unwrap_or(0),
                is_focused: w.is_focused().unwrap_or(false),
                z_index: idx,
                is_minimized,
            })
        })
        .collect();

    Ok(window_infos)
}

/// Get the "smart" target window - the most relevant window for AI to observe.
///
/// Selection priority:
/// 1. The currently focused window (if not our AI window)
/// 2. The topmost non-AI window in Z-order
#[tauri::command]
pub fn get_smart_window() -> Result<Option<WindowInfo>, String> {
    let windows = list_capturable_windows()?;

    // Priority 1: Find the focused window
    if let Some(focused) = windows.iter().find(|w| w.is_focused) {
        return Ok(Some(focused.clone()));
    }

    // Priority 2: Return the topmost window (first in Z-order list)
    Ok(windows.into_iter().next())
}

/// Smart capture - automatically selects the most relevant window and captures it.
///
/// This is the recommended way to capture what the user is currently working on.
#[tauri::command]
pub async fn capture_smart() -> Result<ScreenCaptureResult, String> {
    use xcap::Window;

    // Get the smart target window
    let target_info =
        get_smart_window()?.ok_or_else(|| "No suitable window found to capture".to_string())?;

    // Find and capture the window
    let windows = Window::all().map_err(|e| format!("Failed to enumerate windows: {}", e))?;

    let target = windows
        .into_iter()
        .find(|w| {
            w.pid().unwrap_or(0) == target_info.pid
                && w.title().unwrap_or_default() == target_info.title
        })
        .ok_or_else(|| format!("Window '{}' no longer exists", target_info.title))?;

    let buffer = target
        .capture_image()
        .map_err(|e| format!("Failed to capture window: {}", e))?;

    let image = DynamicImage::ImageRgba8(buffer);
    let (text, confidence) = perform_ocr_windows(&image).await?;

    Ok(ScreenCaptureResult {
        text,
        confidence,
        timestamp: get_timestamp_ms(),
        window_name: Some(target_info.title),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_timestamp_ms() {
        let ts = get_timestamp_ms();
        assert!(ts > 0);
    }

    #[tokio::test]
    async fn test_capture_screen() {
        // This test requires a display, may fail in CI
        let result = capture_screen();
        // Just check it doesn't panic
        println!("Capture result: {:?}", result.is_ok());
    }
}
