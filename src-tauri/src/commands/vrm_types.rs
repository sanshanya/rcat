use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmCommandPayload {
    #[serde(rename = "type")]
    pub command_type: String,
    #[serde(flatten)]
    pub data: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmMotionSnapshot {
    pub id: Option<String>,
    pub playing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmEmotionSnapshot {
    pub id: String,
    pub intensity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrmStateSnapshot {
    pub tool_mode: String,
    pub fps_mode: Value,
    pub mouse_tracking: Value,
    pub hud_layout: Value,
    pub motion: VrmMotionSnapshot,
    pub emotion: VrmEmotionSnapshot,
}

