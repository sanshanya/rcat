//! Shared configuration loading for AI/VLM services.
//!
//! The frontend should never receive secrets; `AiPublicConfig` is safe to expose.

use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    OpenAI,
    DeepSeek,
    Compatible,
}

/// AI configuration for OpenAI-compatible endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub provider: AiProvider,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: AiProvider::OpenAI,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
        }
    }
}

fn infer_provider(base_url: &str) -> AiProvider {
    let base = base_url.trim().to_ascii_lowercase();
    if base.contains("api.deepseek.com") {
        return AiProvider::DeepSeek;
    }
    if base.contains("api.openai.com") {
        return AiProvider::OpenAI;
    }
    AiProvider::Compatible
}

fn normalize_api_base(provider: AiProvider, base_url: &str) -> String {
    let mut base = base_url.trim().trim_end_matches('/').to_string();

    match provider {
        AiProvider::OpenAI => {
            if !base.ends_with("/v1") {
                base.push_str("/v1");
            }
        }
        AiProvider::DeepSeek => {
            if base.ends_with("/v1") {
                base.truncate(base.len().saturating_sub(3));
            }
        }
        AiProvider::Compatible => {}
    }

    base
}

/// Load AI configuration from `.env`/environment.
///
/// Reads:
/// - `AI_BASE_URL` (fallback: `LLM_BASE_URL`)
/// - `AI_PROVIDER` (fallback: `LLM_PROVIDER`)
/// - `AI_API_KEY` (fallback: `OPENAI_API_KEY`, `LLM_API_KEY`)
/// - `AI_MODEL` (fallback: `LLM_MODEL`)
pub fn load_ai_config() -> AiConfig {
    let _ = dotenvy::dotenv();

    let base_url = std::env::var("AI_BASE_URL")
        .or_else(|_| std::env::var("LLM_BASE_URL"))
        .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());

    let provider = match std::env::var("AI_PROVIDER")
        .or_else(|_| std::env::var("LLM_PROVIDER"))
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "openai" => AiProvider::OpenAI,
        "deepseek" => AiProvider::DeepSeek,
        "compatible" | "openai-compatible" | "openai_compatible" => AiProvider::Compatible,
        _ => infer_provider(&base_url),
    };

    AiConfig {
        provider,
        base_url: normalize_api_base(provider, &base_url),
        api_key: std::env::var("AI_API_KEY")
            .or_else(|_| std::env::var("OPENAI_API_KEY"))
            .or_else(|_| std::env::var("LLM_API_KEY"))
            .unwrap_or_default(),
        model: std::env::var("AI_MODEL")
            .or_else(|_| std::env::var("LLM_MODEL"))
            .unwrap_or_else(|_| "gpt-4o-mini".to_string()),
    }
}

/// Public AI configuration returned to the frontend (secrets omitted).
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPublicConfig {
    pub provider: AiProvider,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

/// Get backend AI configuration without exposing secrets.
#[tauri::command]
pub fn get_ai_public_config() -> AiPublicConfig {
    let config = load_ai_config();
    AiPublicConfig {
        provider: config.provider,
        base_url: config.base_url,
        model: config.model,
        has_api_key: !config.api_key.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_provider() {
        assert!(matches!(
            infer_provider("https://api.deepseek.com"),
            AiProvider::DeepSeek
        ));
        assert!(matches!(
            infer_provider("https://api.deepseek.com/beta"),
            AiProvider::DeepSeek
        ));
        assert!(matches!(
            infer_provider("https://api.openai.com/v1"),
            AiProvider::OpenAI
        ));
        assert!(matches!(
            infer_provider("https://unknown.com/v1"),
            AiProvider::Compatible
        ));
    }

    #[test]
    fn test_normalize_api_base() {
        assert_eq!(
            normalize_api_base(AiProvider::OpenAI, "https://api.openai.com"),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            normalize_api_base(AiProvider::OpenAI, "https://api.openai.com/v1"),
            "https://api.openai.com/v1"
        );

        assert_eq!(
            normalize_api_base(AiProvider::DeepSeek, "https://api.deepseek.com/v1"),
            "https://api.deepseek.com"
        );
        assert_eq!(
            normalize_api_base(AiProvider::DeepSeek, "https://api.deepseek.com"),
            "https://api.deepseek.com"
        );

        assert_eq!(
            normalize_api_base(AiProvider::Compatible, "https://other.com/v1"),
            "https://other.com/v1"
        );
    }
}
