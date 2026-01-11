//! Shared configuration loading for AI/VLM services.
//!
//! Prototype note: configuration is persisted in `savedata/settings.json`.
//! We intentionally treat the savedata folder as the single source of truth.

use serde::de::Deserializer;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmViewState {
    pub camera_position: [f32; 3],
    pub target: [f32; 3],
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmAvatarState {
    pub position: [f32; 3],
    pub scale: f32,
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmHudPanelPosition {
    pub x: f32,
    pub y: f32,
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmHudLayoutSettings {
    pub locked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug_panel: Option<VrmHudPanelPosition>,
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VrmFpsMode {
    Auto,
    #[serde(rename = "30")]
    Fps30,
    #[serde(rename = "60")]
    Fps60,
}

impl Default for VrmFpsMode {
    fn default() -> Self {
        Self::Auto
    }
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmMouseTrackingPart {
    pub enabled: bool,
    pub yaw_limit_deg: f32,
    pub pitch_limit_deg: f32,
    pub smoothness: f32,
    pub blend: f32,
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmSpineTrackingSettings {
    pub enabled: bool,
    pub min_yaw_deg: f32,
    pub max_yaw_deg: f32,
    pub smoothness: f32,
    pub fade_speed: f32,
    pub falloff: f32,
    pub blend: f32,
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmMouseTrackingSettings {
    pub enabled: bool,
    pub head: VrmMouseTrackingPart,
    pub spine: VrmSpineTrackingSettings,
    pub eyes: VrmMouseTrackingPart,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmEmotionMotion {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motion_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loop_motion: Option<bool>,
}

fn clamp_f32(value: f32, min: f32, max: f32) -> f32 {
    value.clamp(min, max)
}

impl VrmMouseTrackingPart {
    fn sanitize(&mut self) {
        self.yaw_limit_deg = clamp_f32(self.yaw_limit_deg, 0.0, 90.0);
        self.pitch_limit_deg = clamp_f32(self.pitch_limit_deg, 0.0, 90.0);
        self.smoothness = clamp_f32(self.smoothness, 0.0, 80.0);
        self.blend = clamp_f32(self.blend, 0.0, 1.0);
    }
}

impl VrmSpineTrackingSettings {
    fn sanitize(&mut self) {
        self.min_yaw_deg = clamp_f32(self.min_yaw_deg, -90.0, 90.0);
        self.max_yaw_deg = clamp_f32(self.max_yaw_deg, -90.0, 90.0);
        self.smoothness = clamp_f32(self.smoothness, 0.0, 120.0);
        self.fade_speed = clamp_f32(self.fade_speed, 0.0, 30.0);
        self.falloff = clamp_f32(self.falloff, 0.0, 1.0);
        self.blend = clamp_f32(self.blend, 0.0, 1.0);
    }
}

impl VrmAvatarState {
    fn sanitize(&mut self) {
        self.scale = clamp_f32(self.scale, 0.05, 10.0);
        if !self.scale.is_finite() {
            self.scale = 1.0;
        }
    }
}

impl VrmHudPanelPosition {
    fn sanitize(&mut self) {
        if !self.x.is_finite() {
            self.x = 0.0;
        }
        if !self.y.is_finite() {
            self.y = 0.0;
        }
        self.x = clamp_f32(self.x, -10000.0, 10000.0);
        self.y = clamp_f32(self.y, -10000.0, 10000.0);
    }
}

impl VrmHudLayoutSettings {
    fn sanitize(&mut self) {
        if let Some(pos) = &mut self.debug_panel {
            pos.sanitize();
        }
    }
}

impl Default for VrmHudLayoutSettings {
    fn default() -> Self {
        let mut settings = Self {
            locked: false,
            debug_panel: None,
        };
        settings.sanitize();
        settings
    }
}

impl VrmMouseTrackingSettings {
    fn sanitize(&mut self) {
        self.head.sanitize();
        self.eyes.sanitize();
        self.spine.sanitize();
    }
}

impl Default for VrmMouseTrackingSettings {
    fn default() -> Self {
        let mut settings = Self {
            enabled: true,
            head: VrmMouseTrackingPart {
                enabled: true,
                yaw_limit_deg: 45.0,
                pitch_limit_deg: 30.0,
                smoothness: 10.0,
                blend: 0.9,
            },
            spine: VrmSpineTrackingSettings {
                enabled: true,
                min_yaw_deg: -15.0,
                max_yaw_deg: 15.0,
                smoothness: 16.0,
                fade_speed: 5.0,
                falloff: 0.8,
                blend: 0.65,
            },
            eyes: VrmMouseTrackingPart {
                enabled: true,
                yaw_limit_deg: 12.0,
                pitch_limit_deg: 12.0,
                smoothness: 10.0,
                blend: 0.95,
            },
        };
        settings.sanitize();
        settings
    }
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

// ============================================================================
// Provider Configuration Table (Single Source of Truth)
// ============================================================================

/// Provider-specific defaults and behaviors.
struct ProviderSpec {
    base_url: &'static str,
    default_model: &'static str,
    default_models: &'static [&'static str],
    /// URL normalization: Some(true) = ensure `/v1`, Some(false) = strip `/v1`, None = no change
    url_suffix_v1: Option<bool>,
}

impl AiProvider {
    const fn spec(self) -> &'static ProviderSpec {
        match self {
            AiProvider::OpenAI => &ProviderSpec {
                base_url: "https://api.openai.com/v1",
                default_model: "gpt-4o-mini",
                default_models: &["gpt-4o-mini", "gpt-4o"],
                url_suffix_v1: Some(true), // OpenAI requires /v1
            },
            AiProvider::DeepSeek => &ProviderSpec {
                base_url: "https://api.deepseek.com",
                default_model: "deepseek-reasoner",
                default_models: &["deepseek-chat", "deepseek-reasoner"],
                url_suffix_v1: Some(false), // DeepSeek doesn't want /v1
            },
            AiProvider::Compatible => &ProviderSpec {
                base_url: "https://api.openai.com/v1",
                default_model: "gpt-4o-mini",
                default_models: &["gpt-4o-mini"],
                url_suffix_v1: None, // User controls URL exactly
            },
        }
    }
}

fn default_base_url(provider: AiProvider) -> &'static str {
    provider.spec().base_url
}

fn default_model(provider: AiProvider) -> &'static str {
    provider.spec().default_model
}

fn normalize_api_base(provider: AiProvider, base_url: &str) -> String {
    let mut base = base_url.trim().trim_end_matches('/').to_string();

    match provider.spec().url_suffix_v1 {
        Some(true) => {
            if !base.ends_with("/v1") {
                base.push_str("/v1");
            }
        }
        Some(false) => {
            if base.ends_with("/v1") {
                base.truncate(base.len().saturating_sub(3));
            }
        }
        None => {}
    }

    base
}

fn default_models(provider: AiProvider) -> Vec<AiModel> {
    provider
        .spec()
        .default_models
        .iter()
        .map(|id| AiModel::from_id(id))
        .collect()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ai_provider: Option<AiProvider>,
    #[serde(default)]
    ai: PersistedAiSettings,
    #[serde(default)]
    vrm: PersistedVrmSettings,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAiSettings {
    /// Provider name -> profile.
    ///
    /// `flatten` keeps the JSON shape as:
    /// `{ "ai": { "openai": {..}, "deepseek": {..} } }`
    #[serde(default, flatten)]
    profiles: BTreeMap<String, PersistedAiProfile>,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedVrmSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fps_mode: Option<VrmFpsMode>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    view_states: BTreeMap<String, VrmViewState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    avatar_states: BTreeMap<String, VrmAvatarState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    expression_bindings: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    emotion_profiles: BTreeMap<String, BTreeMap<String, VrmEmotionMotion>>,
    #[serde(default)]
    hud_layout: VrmHudLayoutSettings,
    #[serde(default)]
    mouse_tracking: VrmMouseTrackingSettings,
}

/// Get provider key for HashMap lookup
fn provider_key(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::OpenAI => "openai",
        AiProvider::DeepSeek => "deepseek",
        AiProvider::Compatible => "compatible",
    }
}

fn profile(settings: &PersistedSettings, provider: AiProvider) -> Option<&PersistedAiProfile> {
    settings.ai.profiles.get(provider_key(provider))
}

fn profile_mut(settings: &mut PersistedSettings, provider: AiProvider) -> &mut PersistedAiProfile {
    settings
        .ai
        .profiles
        .entry(provider_key(provider).to_string())
        .or_default()
}

fn settings_path() -> Option<PathBuf> {
    let dir = crate::services::paths::data_dir_cached()?;
    Some(dir.join("settings.json"))
}

fn backup_settings_path(path: &PathBuf) -> PathBuf {
    path.with_extension("json.bak")
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

fn try_read_settings(path: &PathBuf) -> Option<PersistedSettings> {
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
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
    let backup_path = backup_settings_path(&path);

    let mut settings = if let Some(settings) = try_read_settings(&path) {
        settings
    } else if let Some(settings) = try_read_settings(&backup_path) {
        let _ = save_settings(&settings);
        settings
    } else {
        let settings = default_settings();
        let _ = save_settings(&settings);
        settings
    };

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

    let backup_path = backup_settings_path(&path);

    // Make room for the atomic rename on platforms that don't support replacing existing files.
    if path.exists() {
        if backup_path.exists() {
            let _ = std::fs::remove_file(&backup_path);
        }

        if let Err(e) = std::fs::rename(&path, &backup_path) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(format!("Failed to backup settings: {e}"));
        }
    }

    match std::fs::rename(&tmp_path, &path) {
        Ok(()) => {
            if backup_path.exists() {
                let _ = std::fs::remove_file(&backup_path);
            }
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_path);
            if backup_path.exists() && !path.exists() {
                let _ = std::fs::rename(&backup_path, &path);
            }
            return Err(format!("Rename failed: {e}"));
        }
    }

    Ok(())
}

/// Load AI configuration from `savedata/settings.json` (next to the app executable).
///
/// Single source of truth: `savedata/settings.json`.
pub fn load_ai_config() -> AiConfig {
    let settings = load_settings();

    let provider = settings.ai_provider.unwrap_or(DEFAULT_PROVIDER);

    static EMPTY_PROFILE: PersistedAiProfile = PersistedAiProfile {
        base_url: None,
        api_key: None,
        model: None,
        models: Vec::new(),
    };
    let p = profile(&settings, provider).unwrap_or(&EMPTY_PROFILE);

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

#[tauri::command]
pub fn get_vrm_fps_mode() -> Option<VrmFpsMode> {
    let settings = load_settings();
    settings.vrm.fps_mode
}

#[tauri::command]
pub fn set_vrm_fps_mode(app: tauri::AppHandle, mode: VrmFpsMode) -> Result<(), String> {
    // Ensure data dir exists (and is cached) before writing settings.
    let _ = crate::services::paths::data_dir(&app)?;
    let mut settings = load_settings();
    settings.vrm.fps_mode = Some(mode);
    save_settings(&settings)?;
    Ok(())
}

#[tauri::command]
pub fn get_vrm_view_state(url: String) -> Option<VrmViewState> {
    let key = url.trim();
    if key.is_empty() {
        return None;
    }
    let settings = load_settings();
    settings.vrm.view_states.get(key).cloned()
}

#[tauri::command]
pub fn get_vrm_avatar_state(url: String) -> Option<VrmAvatarState> {
    let key = url.trim();
    if key.is_empty() {
        return None;
    }
    let settings = load_settings();
    settings.vrm.avatar_states.get(key).cloned()
}

#[tauri::command]
pub fn get_vrm_expression_bindings(url: String) -> Option<BTreeMap<String, String>> {
    let key = url.trim();
    if key.is_empty() {
        return None;
    }
    let settings = load_settings();
    settings.vrm.expression_bindings.get(key).cloned()
}

#[tauri::command]
pub fn get_vrm_emotion_profile(url: String) -> Option<BTreeMap<String, VrmEmotionMotion>> {
    let key = url.trim();
    if key.is_empty() {
        return None;
    }
    let settings = load_settings();
    settings.vrm.emotion_profiles.get(key).cloned()
}

#[tauri::command]
pub fn get_vrm_hud_layout() -> VrmHudLayoutSettings {
    let settings = load_settings();
    settings.vrm.hud_layout
}

#[tauri::command]
pub fn set_vrm_view_state(
    app: tauri::AppHandle,
    url: String,
    view_state: VrmViewState,
) -> Result<(), String> {
    // Ensure data dir exists (and is cached) before writing settings.
    let _ = crate::services::paths::data_dir(&app)?;
    let key = url.trim();
    if key.is_empty() {
        return Err("VRM url is required".to_string());
    }
    let mut settings = load_settings();
    settings
        .vrm
        .view_states
        .insert(key.to_string(), view_state);
    save_settings(&settings)?;
    Ok(())
}

#[tauri::command]
pub fn set_vrm_avatar_state(
    app: tauri::AppHandle,
    url: String,
    avatar_state: VrmAvatarState,
) -> Result<(), String> {
    // Ensure data dir exists (and is cached) before writing settings.
    let _ = crate::services::paths::data_dir(&app)?;
    let key = url.trim();
    if key.is_empty() {
        return Err("VRM url is required".to_string());
    }
    let mut settings = load_settings();
    let mut next = avatar_state;
    next.sanitize();
    settings
        .vrm
        .avatar_states
        .insert(key.to_string(), next);
    save_settings(&settings)?;
    Ok(())
}

#[tauri::command]
pub fn set_vrm_expression_bindings(
    app: tauri::AppHandle,
    url: String,
    bindings: BTreeMap<String, String>,
) -> Result<(), String> {
    // Ensure data dir exists (and is cached) before writing settings.
    let _ = crate::services::paths::data_dir(&app)?;
    let key = url.trim();
    if key.is_empty() {
        return Err("VRM url is required".to_string());
    }

    let mut next: BTreeMap<String, String> = BTreeMap::new();
    for (slot, expression) in bindings {
        let slot = slot.trim();
        let expression = expression.trim();
        if slot.is_empty() || expression.is_empty() {
            continue;
        }
        next.insert(slot.to_string(), expression.to_string());
    }

    let mut settings = load_settings();
    if next.is_empty() {
        settings.vrm.expression_bindings.remove(key);
    } else {
        settings
            .vrm
            .expression_bindings
            .insert(key.to_string(), next);
    }
    save_settings(&settings)?;
    Ok(())
}

#[tauri::command]
pub fn set_vrm_emotion_profile(
    app: tauri::AppHandle,
    url: String,
    profile: BTreeMap<String, VrmEmotionMotion>,
) -> Result<(), String> {
    // Ensure data dir exists (and is cached) before writing settings.
    let _ = crate::services::paths::data_dir(&app)?;
    let key = url.trim();
    if key.is_empty() {
        return Err("VRM url is required".to_string());
    }

    let mut next: BTreeMap<String, VrmEmotionMotion> = BTreeMap::new();
    for (emotion, mapping) in profile {
        let emotion = emotion.trim();
        if emotion.is_empty() {
            continue;
        }
        let motion_id = mapping.motion_id.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });
        if motion_id.is_none() {
            continue;
        }
        next.insert(
            emotion.to_string(),
            VrmEmotionMotion {
                motion_id,
                loop_motion: mapping.loop_motion,
            },
        );
    }

    let mut settings = load_settings();
    if next.is_empty() {
        settings.vrm.emotion_profiles.remove(key);
    } else {
        settings.vrm.emotion_profiles.insert(key.to_string(), next);
    }
    save_settings(&settings)?;
    Ok(())
}

#[tauri::command]
pub fn set_vrm_hud_layout(
    app: tauri::AppHandle,
    hud_layout: VrmHudLayoutSettings,
) -> Result<(), String> {
    // Ensure data dir exists (and is cached) before writing settings.
    let _ = crate::services::paths::data_dir(&app)?;
    let mut settings = load_settings();
    let mut next = hud_layout;
    next.sanitize();
    settings.vrm.hud_layout = next;
    save_settings(&settings)?;
    Ok(())
}

#[tauri::command]
pub fn get_vrm_mouse_tracking() -> VrmMouseTrackingSettings {
    let settings = load_settings();
    settings.vrm.mouse_tracking
}

#[tauri::command]
pub fn set_vrm_mouse_tracking(
    app: tauri::AppHandle,
    mouse_tracking: VrmMouseTrackingSettings,
) -> Result<(), String> {
    // Ensure data dir exists (and is cached) before writing settings.
    let _ = crate::services::paths::data_dir(&app)?;
    let mut settings = load_settings();
    let mut next = mouse_tracking;
    next.sanitize();
    settings.vrm.mouse_tracking = next;
    save_settings(&settings)?;
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

    #[test]
    fn test_deserialize_profiles_map_from_legacy_shape() {
        // Legacy JSON shape stored per-provider profiles directly under `ai`.
        // With `#[serde(flatten)]` this should deserialize into `ai.profiles` without
        // any explicit migration step.
        let json = r#"
        {
          "aiProvider": "deepseek",
          "ai": {
            "openai": {
              "baseUrl": "https://api.openai.com/v1",
              "apiKey": "sk-test",
              "model": "gpt-4o-mini",
              "models": ["gpt-4o-mini"]
            },
            "deepseek": {
              "baseUrl": "https://api.deepseek.com",
              "model": "deepseek-chat",
              "models": ["deepseek-chat", "deepseek-reasoner"]
            }
          }
        }
        "#;

        let settings: PersistedSettings = serde_json::from_str(json).expect("deserialize");
        let openai = settings.ai.profiles.get("openai").expect("openai profile");
        assert_eq!(openai.base_url.as_deref(), Some("https://api.openai.com/v1"));
        assert_eq!(openai.model.as_deref(), Some("gpt-4o-mini"));
        assert_eq!(openai.models.len(), 1);
        assert_eq!(openai.models[0].id, "gpt-4o-mini");

        let deepseek = settings.ai.profiles.get("deepseek").expect("deepseek profile");
        assert_eq!(deepseek.base_url.as_deref(), Some("https://api.deepseek.com"));
        assert_eq!(deepseek.model.as_deref(), Some("deepseek-chat"));
        assert_eq!(deepseek.models.len(), 2);
    }
}
