use crate::services::config::{AiConfig, AiProvider};
use crate::services::prompts;

use super::{capture_screen_text, capture_smart, list_capturable_windows};

pub(super) fn tools_schema(config: &AiConfig) -> serde_json::Value {
    // DeepSeek strict Tool Calls are enabled under `/beta` + `strict: true` schemas.
    // Allow an explicit env override for other providers during testing.
    let strict_from_env = std::env::var("AI_TOOL_STRICT")
        .ok()
        .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);

    let base = config.base_url.trim().trim_end_matches('/');
    let strict_from_base = matches!(config.provider, AiProvider::DeepSeek) && base.ends_with("/beta");

    prompts::build_vision_tools_schema(strict_from_env || strict_from_base)
}

pub(super) async fn execute_tool_call(
    name: &str,
    arguments: &serde_json::Value,
) -> Result<String, String> {
    match name {
        name if name == prompts::tool_list_windows::NAME => {
            let windows = list_capturable_windows()?;
            let formatted: Vec<(String, String, bool)> = windows
                .iter()
                .map(|w| (w.title.clone(), w.app_name.clone(), w.is_focused))
                .collect();
            Ok(prompts::format_window_list(&formatted))
        }
        name if name == prompts::tool_capture_window::NAME => {
            let window_title = arguments
                .get(prompts::tool_capture_window::PARAM_WINDOW_TITLE)
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing window_title argument".to_string())?;

            let result = capture_screen_text(Some(window_title.to_string())).await?;
            let window_name = result.window_name.unwrap_or_else(|| window_title.to_string());
            Ok(prompts::format_window_capture(&window_name, &result.text))
        }
        name if name == prompts::tool_capture_focused::NAME => {
            let result = capture_smart().await?;
            let window_name = result.window_name.unwrap_or_else(|| "未知".to_string());
            Ok(prompts::format_focused_capture(&window_name, &result.text))
        }
        _ => Err(format!("Unknown tool: {}", name)),
    }
}

