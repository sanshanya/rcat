use serde::Deserialize;

use crate::windows::panel_window::{open_capsule as open_capsule_window, OpenCapsuleParams};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCapsuleArgs {
    pub tab: Option<String>,
    pub anchor_x: i32,
    pub anchor_y: i32,
}

#[tauri::command]
pub fn open_capsule(
    app: tauri::AppHandle,
    args: OpenCapsuleArgs,
) -> Result<(), String> {
    let tab = args.tab.unwrap_or_else(|| "chat".to_string());
    open_capsule_window(
        &app,
        OpenCapsuleParams {
            tab,
            anchor_x: args.anchor_x,
            anchor_y: args.anchor_y,
        },
    )
    .map_err(|e| e.to_string())
}
