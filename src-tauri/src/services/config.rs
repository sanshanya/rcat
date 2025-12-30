//! Shared configuration loading for AI/VLM services.
//!
//! Prototype note: configuration is persisted in `savedata/settings.json`.
//! We intentionally treat the savedata folder as the single source of truth.

use serde::de::Deserializer;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    OpenAI,
    DeepSeek,
    Compatible,
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    pub id: String,
    pub max_context: Option<u32>,
    pub max_output: Option<u32>,
    #[serde(default)]
    pub supports_vision: bool,
    #[serde(default)]
    pub supports_think: bool,
    pub special: Option<String>,
}

impl AiModel {
    fn from_id(id: &str) -> Self {
        let id = id.trim();
        let mut model = Self {
            id: id.to_string(),
            max_context: None,
            max_output: None,
            supports_vision: false,
            supports_think: false,
            special: None,
        };

        match id {
            "deepseek-reasoner" => model.supports_think = true,
            "gpt-4o" | "gpt-4o-mini" => model.supports_vision = true,
            _ => {}
        }

        model
    }
}

/// AI configuration for OpenAI-compatible endpoints.
#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub provider: AiProvider,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub models: Vec<AiModel>,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: AiProvider::OpenAI,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            models: vec![AiModel::from_id("gpt-4o-mini"), AiModel::from_id("gpt-4o")],
        }
    }
}

const DEFAULT_PROVIDER: AiProvider = AiProvider::DeepSeek;

fn default_base_url(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::OpenAI => "https://api.openai.com/v1",
        AiProvider::DeepSeek => "https://api.deepseek.com",
        // Sensible default: OpenAI-compatible endpoints typically follow OpenAI's `/v1` shape.
        AiProvider::Compatible => "https://api.openai.com/v1",
    }
}

fn default_model(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::OpenAI => "gpt-4o-mini",
        AiProvider::DeepSeek => "deepseek-reasoner",
        AiProvider::Compatible => "gpt-4o-mini",
    }
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

fn default_models(provider: AiProvider) -> Vec<AiModel> {
    match provider {
        AiProvider::OpenAI => vec![AiModel::from_id("gpt-4o-mini"), AiModel::from_id("gpt-4o")],
        AiProvider::DeepSeek => vec![
            AiModel::from_id("deepseek-chat"),
            AiModel::from_id("deepseek-reasoner"),
        ],
        AiProvider::Compatible => vec![AiModel::from_id(default_model(provider))],
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ai_provider: Option<AiProvider>,
    #[serde(default)]
    ai: PersistedAiSettings,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAiSettings {
    #[serde(default)]
    openai: PersistedAiProfile,
    #[serde(default)]
    deepseek: PersistedAiProfile,
    #[serde(default)]
    compatible: PersistedAiProfile,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAiProfile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(default, deserialize_with = "deserialize_models")]
    models: Vec<AiModel>,
}

fn profile(settings: &PersistedSettings, provider: AiProvider) -> &PersistedAiProfile {
    match provider {
        AiProvider::OpenAI => &settings.ai.openai,
        AiProvider::DeepSeek => &settings.ai.deepseek,
        AiProvider::Compatible => &settings.ai.compatible,
    }
}

fn profile_mut(settings: &mut PersistedSettings, provider: AiProvider) -> &mut PersistedAiProfile {
    match provider {
        AiProvider::OpenAI => &mut settings.ai.openai,
        AiProvider::DeepSeek => &mut settings.ai.deepseek,
        AiProvider::Compatible => &mut settings.ai.compatible,
    }
}

fn settings_path() -> Option<PathBuf> {
    let dir = crate::services::paths::data_dir_cached()?;
    Some(dir.join("settings.json"))
}

fn default_settings() -> PersistedSettings {
    let mut settings = PersistedSettings::default();
    settings.ai_provider = Some(DEFAULT_PROVIDER);

    for provider in [
        AiProvider::OpenAI,
        AiProvider::DeepSeek,
        AiProvider::Compatible,
    ] {
        let p = profile_mut(&mut settings, provider);
        p.base_url = Some(default_base_url(provider).to_string());
        p.model = Some(default_model(provider).to_string());
        p.api_key = None;
        p.models = default_models(provider);
    }

    settings
}

fn deserialize_models<'de, D>(deserializer: D) -> Result<Vec<AiModel>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum RawModels {
        LegacyStrings(Vec<String>),
        Objects(Vec<AiModel>),
    }

    let raw = RawModels::deserialize(deserializer)?;
    Ok(match raw {
        RawModels::LegacyStrings(ids) => ids.into_iter().map(|id| AiModel::from_id(&id)).collect(),
        RawModels::Objects(models) => models,
    })
}

fn normalize_models(models: Vec<AiModel>) -> Vec<AiModel> {
    let mut out: Vec<AiModel> = Vec::new();
    for mut m in models {
        let id = m.id.trim();
        if id.is_empty() {
            continue;
        }
        if out.iter().any(|existing| existing.id == id) {
            continue;
        }

        m.id = id.to_string();

        if let Some(v) = m.max_context {
            if v == 0 {
                m.max_context = None;
            }
        }
        if let Some(v) = m.max_output {
            if v == 0 {
                m.max_output = None;
            }
        }
        if let Some(s) = m.special.as_deref() {
            let s = s.trim();
            if s.is_empty() {
                m.special = None;
            } else if Some(s) != m.special.as_deref() {
                m.special = Some(s.to_string());
            }
        }

        out.push(m);
    }
    out
}

fn normalize_settings(settings: &mut PersistedSettings) -> bool {
    let mut changed = false;

    if settings.ai_provider.is_none() {
        settings.ai_provider = Some(DEFAULT_PROVIDER);
        changed = true;
    }

    for provider in [
        AiProvider::OpenAI,
        AiProvider::DeepSeek,
        AiProvider::Compatible,
    ] {
        let p = profile_mut(settings, provider);

        let base = p.base_url.as_deref().unwrap_or("").trim();
        if base.is_empty() {
            p.base_url = Some(default_base_url(provider).to_string());
            changed = true;
        } else {
            let normalized = normalize_api_base(provider, base);
            if Some(normalized.as_str()) != p.base_url.as_deref() {
                p.base_url = Some(normalized);
                changed = true;
            }
        }

        let model = p.model.as_deref().unwrap_or("").trim();
        if model.is_empty() {
            p.model = Some(default_model(provider).to_string());
            changed = true;
        }

        let models = normalize_models(std::mem::take(&mut p.models));
        let mut models = if models.is_empty() {
            changed = true;
            default_models(provider)
        } else {
            models
        };

        let selected = p.model.as_deref().unwrap_or(default_model(provider)).trim();
        if !selected.is_empty() && !models.iter().any(|m| m.id == selected) {
            models.insert(0, AiModel::from_id(selected));
            changed = true;
        }

        p.models = models;

        if let Some(key) = p.api_key.as_deref() {
            if key.trim().is_empty() {
                p.api_key = None;
                changed = true;
            }
        }
    }

    changed
}

fn load_settings() -> PersistedSettings {
    let Some(path) = settings_path() else {
        return default_settings();
    };
    let Ok(contents) = std::fs::read_to_string(&path) else {
        let settings = default_settings();
        let _ = save_settings(&settings);
        return settings;
    };
    let mut settings: PersistedSettings = serde_json::from_str(&contents).unwrap_or_else(|_| {
        let settings = default_settings();
        let _ = save_settings(&settings);
        settings
    });

    if normalize_settings(&mut settings) {
        let _ = save_settings(&settings);
    }

    settings
}

fn save_settings(settings: &PersistedSettings) -> Result<(), String> {
    let Some(path) = settings_path() else {
        return Err("Data dir is not initialized".to_string());
    };

    let Some(parent) = path.parent() else {
        return Err("Invalid settings path".to_string());
    };
    std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create data dir: {e}"))?;

    let serialized =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Serialize failed: {e}"))?;

    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, serialized).map_err(|e| format!("Write failed: {e}"))?;
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    std::fs::rename(&tmp_path, &path).map_err(|e| format!("Rename failed: {e}"))?;

    Ok(())
}

/// Load AI configuration from `savedata/settings.json` (next to the app executable).
///
/// Single source of truth: `savedata/settings.json`.
pub fn load_ai_config() -> AiConfig {
    let settings = load_settings();

    let provider = settings.ai_provider.unwrap_or(DEFAULT_PROVIDER);

    let p = profile(&settings, provider);

    let base_url = p.base_url.as_deref().unwrap_or(default_base_url(provider));

    let model = p.model.as_deref().unwrap_or(default_model(provider));

    let api_key = p.api_key.clone().unwrap_or_default();
    let models = if p.models.is_empty() {
        default_models(provider)
    } else {
        p.models.clone()
    };

    AiConfig {
        provider,
        base_url: normalize_api_base(provider, base_url),
        api_key,
        model: model.to_string(),
        models,
    }
}

#[tauri::command]
pub fn get_ai_config() -> AiConfig {
    load_ai_config()
}

/// Persist the preferred AI provider.
#[tauri::command]
pub fn set_ai_provider(app: tauri::AppHandle, provider: AiProvider) -> Result<AiConfig, String> {
    // Ensure data dir exists (and is cached) before writing settings.
    let _ = crate::services::paths::data_dir(&app)?;

    let mut settings = load_settings();
    settings.ai_provider = Some(provider);
    let p = profile_mut(&mut settings, provider);
    if p.base_url.is_none() {
        p.base_url = Some(default_base_url(provider).to_string());
    }
    if p.model.is_none() {
        p.model = Some(default_model(provider).to_string());
    }
    if p.models.is_empty() {
        p.models = default_models(provider);
    }
    if let Some(model) = p.model.as_deref() {
        let model = model.trim();
        if !model.is_empty() && !p.models.iter().any(|m| m.id == model) {
            p.models.insert(0, AiModel::from_id(model));
        }
    }
    save_settings(&settings)?;
    Ok(get_ai_config())
}

/// Persist per-provider overrides (base URL, model, API key).
///
/// - `base_url` / `model` may be empty (will be replaced with defaults).
/// - `api_key` may be empty (clears the key).
#[tauri::command]
pub fn set_ai_profile(
    app: tauri::AppHandle,
    provider: AiProvider,
    base_url: String,
    model: String,
    api_key: String,
    models: Vec<AiModel>,
) -> Result<AiConfig, String> {
    // Ensure data dir exists (and is cached) before writing settings.
    let _ = crate::services::paths::data_dir(&app)?;

    let mut settings = load_settings();
    settings.ai_provider = Some(provider);

    let p = profile_mut(&mut settings, provider);

    let base = base_url.trim();
    p.base_url = Some(if base.is_empty() {
        default_base_url(provider).to_string()
    } else {
        normalize_api_base(provider, base)
    });

    let model = model.trim();
    p.model = Some(if model.is_empty() {
        default_model(provider).to_string()
    } else {
        model.to_string()
    });

    let key = api_key.trim();
    p.api_key = if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    };

    let mut models = normalize_models(models);
    if models.is_empty() {
        models = default_models(provider);
    }
    let selected = p.model.as_deref().unwrap_or(default_model(provider)).trim();
    if !selected.is_empty() && !models.iter().any(|m| m.id == selected) {
        models.insert(0, AiModel::from_id(selected));
    }
    p.models = models;

    save_settings(&settings)?;
    Ok(get_ai_config())
}

/// Test a profile without persisting it.
#[tauri::command]
pub async fn test_ai_profile(
    provider: AiProvider,
    base_url: String,
    model: String,
    api_key: String,
) -> Result<(), String> {
    use async_openai::{config::OpenAIConfig, Client};
    use serde_json::Value as JsonValue;

    let key = api_key.trim();
    if key.is_empty() {
        return Err("API key is required".to_string());
    }

    let model = model.trim();
    if model.is_empty() {
        return Err("Model is required".to_string());
    }

    let base = base_url.trim();
    if base.is_empty() {
        return Err("Base URL is required".to_string());
    }

    let openai_config = OpenAIConfig::new()
        .with_api_base(normalize_api_base(provider, base))
        .with_api_key(key.to_string());
    let client = Client::with_config(openai_config);

    let request = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "user", "content": "ping" }
        ],
        "stream": false,
        "max_tokens": 1
    });

    let response: JsonValue = client
        .chat()
        .create_byot::<_, JsonValue>(&request)
        .await
        .map_err(|e| e.to_string())?;

    let has_choice = response.get("choices").and_then(|c| c.get(0)).is_some();
    if !has_choice {
        return Err("No choices returned".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
