use image::DynamicImage;

use crate::services::config;
use crate::services::retry::RetryConfig;

use super::capture;
use super::types::{timestamp_ms, VlmAnalysisResult};

pub(crate) fn image_to_base64(image: &DynamicImage) -> Result<String, String> {
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

pub(crate) async fn analyze_screen_vlm(
    prompt: String,
    window_name: Option<String>,
) -> Result<VlmAnalysisResult, String> {
    let image = if let Some(ref pattern) = window_name {
        let (img, _) = capture::capture_window(pattern)?;
        img
    } else {
        capture::capture_screen()?
    };

    let base64_image = image_to_base64(&image)?;
    let config = config::load_ai_config();

    let model = std::env::var("AI_VISION_MODEL")
        .or_else(|_| std::env::var("LLM_VISION_MODEL"))
        .or_else(|_| std::env::var("VLM_MODEL"))
        .or_else(|_| std::env::var("LLM_MODEL"))
        .unwrap_or_else(|_| config.model.clone());

    let api_key = config.api_key;
    let base_url = config.base_url;

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
            timestamp: timestamp_ms(),
        });
    }

    Err(last_error.unwrap_or_else(|| "VLM API request failed".to_string()))
}

